import {
  ExtractedFactKind,
  ExtractedFactStatus,
  Prisma,
  UserFactSource,
  prisma
} from "@portfolio/db";
import type { LlmProvider } from "./llm/types";

// ---------------------------------------------------------------------------
// Conversational fact extraction.
//
// Runs AFTER every chat turn (fire-and-forget). Looks at the user message +
// assistant reply and detects things worth remembering. High-confidence /
// low-stakes items auto-apply; everything else is staged for review.
//
// Guardrails (in order of importance):
// 1. Fact-key allowlist — no open-ended key writes, no prompt injection.
// 2. Evidence substring match — extractor must quote the user verbatim
//    (or near-verbatim); prevents hallucinated facts.
// 3. Dedup — same fact/goal with same value in the last 24h = skip.
// 4. Contradiction detection — existing fact with different value forces
//    `staged` status; never silently overwrites.
// 5. Trivial-turn skip — very short turns / pure data queries don't
//    trigger extraction at all.
//
// All extractions write an ExtractedFact row for the audit log, even
// rejected/skipped ones (with status=rejected and a reason).
// ---------------------------------------------------------------------------

/**
 * Whitelisted fact keys. If an extractor emits any other key it's rejected.
 * Keep this list short and growable — adding a key is a deliberate choice.
 * Goal keys are NOT here; goals have their own validation.
 */
export const ALLOWED_FACT_KEYS = new Set<string>([
  // Household
  "marital_status",
  "dependents",
  "household_size",
  "state",
  "filing_status",
  // Income
  "annual_income",
  "biweekly_net_pay",
  "employer",
  "employer_match_pct",
  "stock_comp",
  // Tax
  "marginal_tax_bracket",
  "effective_tax_rate",
  // Obligations / assets
  "mortgage_balance",
  "mortgage_rate",
  "rent_monthly",
  "student_loan_balance",
  "student_loan_rate",
  "other_debt_balance",
  "home_value",
  // Risk / strategy
  "risk_tolerance",
  "target_retirement_age",
  "target_retirement_balance",
  "investment_horizon_years",
  "emergency_fund_months_target"
]);

/**
 * Goal keys are slug-style strings (e.g. "house_down_payment",
 * "emergency_fund", "car_fund", "vacation_2026"). We allow any slug that
 * passes this regex; free-form but bounded.
 */
const GOAL_KEY_REGEX = /^[a-z][a-z0-9_]{2,40}$/;

/** Stakes tiers — drive auto-apply policy. */
export type StakesLevel = "low" | "medium" | "high";

/** What the extractor LLM returns for each thing it found. */
export type RawExtraction = {
  kind: "fact" | "goal" | "goal_progress" | "obligation" | "revert";
  factKey?: string;
  goalKey?: string;
  newValue: unknown;
  confidence: number; // 0.0–1.0
  evidence: string; // verbatim quote or tight paraphrase of user message
  reasoning?: string;
  stakesLevel: StakesLevel;
};

/** Per-user snapshot given to the extractor so it doesn't duplicate work. */
export type ProfileSnapshot = {
  facts: Array<{
    factKey: string;
    factValue: unknown;
    source: string;
    /** Document title when source is "import" and we can resolve it. */
    sourceDocumentTitle?: string | null;
  }>;
  activeGoals: Array<{ goalKey: string; label: string; targetValue: string | null; targetDate: string | null }>;
};

/** Output of runFactExtractor. */
export type ExtractionResult = {
  skipped: boolean;
  skipReason?: string;
  accepted: number;
  autoApplied: number;
  staged: number;
  rejected: number;
  extractions: Array<{
    id: string;
    kind: string;
    key: string | null;
    status: string;
    summary: string;
  }>;
};

/** Low-effort pre-filter: does this user message plausibly carry a fact? */
export function isTurnWorthExtracting(userMessage: string): {
  worth: boolean;
  reason: string;
} {
  const trimmed = userMessage.trim();
  if (trimmed.length < 15) return { worth: false, reason: "too short" };
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4) return { worth: false, reason: "too few words" };

  // Heuristic: if none of these patterns appear, it's probably a pure query
  // ("what's my balance", "show me transactions"). Extractor still runs if
  // ANY of the personal-signal keywords are present.
  const signalRe =
    /\b(i|i'm|im|i am|we|we're|we are|our|my|us|me|want|plan|planning|saving|save for|goal|target|aim|retire|bracket|earn|make|income|married|single|kids?|children|dependents?|state|florida|wa|california|ny|tx|mortgage|rent|renting|own|house|apartment|student loan|debt|401k|401\(k\)|ira|roth|hsa|taxable|brokerage|risk|aggressive|conservative|moderate|employer|job|work|salary|paycheck|bonus|rsu|stock)\b/i;
  if (!signalRe.test(trimmed)) {
    return { worth: false, reason: "no personal signals" };
  }
  return { worth: true, reason: "ok" };
}

/** Validate that the LLM's `evidence` actually appears in the source text. */
export function evidenceMatchesSource(
  evidence: string,
  source: string
): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s%$.]/g, "").replace(/\s+/g, " ").trim();
  const e = norm(evidence);
  const s = norm(source);
  if (!e || e.length < 4) return false;
  // Try substring match on full evidence first.
  if (s.includes(e)) return true;
  // Fuzzy-ish: at least 60% of evidence words must appear in source (order
  // not required). This handles paraphrasing like "make 180 grand" vs
  // evidence "makes $180,000/yr".
  const eWords = e.split(/\s+/).filter((w) => w.length >= 3);
  if (eWords.length === 0) return false;
  const hits = eWords.filter((w) => s.includes(w)).length;
  return hits / eWords.length >= 0.6;
}

/**
 * Get a compact snapshot of what we already know about the user. Used as
 * extractor context so it doesn't duplicate facts/goals.
 */
export async function getProfileSnapshot(
  userId: string
): Promise<ProfileSnapshot> {
  const [facts, goals] = await Promise.all([
    prisma.userFact.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 25
    }),
    prisma.userGoal.findMany({
      where: { userId, isActive: true },
      orderBy: { updatedAt: "desc" },
      take: 15
    })
  ]);

  // For facts sourced from imports (documents), look up the most recent
  // document whose extraction produced this factKey — that's the source
  // we'll attribute it to in the primer.
  const importKeys = facts
    .filter((f) => f.source === "import")
    .map((f) => f.factKey);
  const docTitleByKey = new Map<string, string>();
  if (importKeys.length > 0) {
    const extractions = await prisma.extractedFact.findMany({
      where: {
        userId,
        factKey: { in: importKeys },
        status: "confirmed",
        userDocumentId: { not: null }
      },
      orderBy: { appliedAt: "desc" },
      include: { document: { select: { title: true } } }
    });
    for (const ex of extractions) {
      if (!ex.factKey) continue;
      if (!docTitleByKey.has(ex.factKey) && ex.document) {
        docTitleByKey.set(ex.factKey, ex.document.title);
      }
    }
  }

  return {
    facts: facts.map((f) => ({
      factKey: f.factKey,
      factValue: f.factValue,
      source: f.source,
      sourceDocumentTitle:
        f.source === "import" ? docTitleByKey.get(f.factKey) ?? null : null
    })),
    activeGoals: goals.map((g) => ({
      goalKey: g.goalKey,
      label: g.label,
      targetValue:
        g.targetValueCents === null
          ? null
          : (Number(g.targetValueCents) / 100).toFixed(2),
      targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null
    }))
  };
}

// ---------------------------------------------------------------------------
// Prompt for the extractor LLM
// ---------------------------------------------------------------------------

const EXTRACTOR_SYSTEM_INSTRUCTION = `
You are a fact extractor for a personal finance advisor. Given a user+assistant
exchange, your job is to detect things the user stated that are worth
remembering for future conversations: personal facts, financial obligations,
and goal commitments.

OUTPUT FORMAT: a single JSON object with an "extractions" array. No prose.

Each extraction MUST include:
  - kind: "fact" | "goal" | "goal_progress" | "obligation" | "revert"
  - factKey: one of the allowed keys (for kind=fact/obligation)
  - goalKey: snake_case slug (for kind=goal/goal_progress)
  - newValue: the structured value (number / string / object depending on key)
  - confidence: 0.0 to 1.0 — how sure you are the user stated this directly
  - evidence: a short verbatim quote from the user's message (required)
  - reasoning: 1-sentence rationale (optional)
  - stakesLevel: "low" | "medium" | "high"

HARD RULES (violating these means your extraction will be rejected):
1. Evidence MUST be text that actually appears in the user's message.
   Quote them verbatim or near-verbatim. Do not paraphrase loosely.
2. Only use factKey values from the ALLOWED_FACT_KEYS list — other keys
   will be rejected.
3. If the user is correcting or changing something they previously said,
   emit a "revert" kind referencing the prior factKey/goalKey.
4. If the user is vague or hypothetical ("I might retire early"), skip it.
   Only extract definitive statements ("I plan to retire at 55").
5. If the user is asking a question (not stating a fact), emit nothing.

STAKES LEVELS:
  - low:    state, dependents, marital_status, household_size — safe to auto-apply
  - medium: income, bracket, risk_tolerance, rates, balances — auto-apply if
            high confidence AND no contradiction with existing profile
  - high:   any goal (always stage for confirmation), revert (always stage)

ALLOWED_FACT_KEYS: [
  "marital_status","dependents","household_size","state","filing_status",
  "annual_income","biweekly_net_pay","employer","employer_match_pct","stock_comp",
  "marginal_tax_bracket","effective_tax_rate",
  "mortgage_balance","mortgage_rate","rent_monthly","student_loan_balance",
  "student_loan_rate","other_debt_balance","home_value",
  "risk_tolerance","target_retirement_age","target_retirement_balance",
  "investment_horizon_years","emergency_fund_months_target"
]

EXAMPLES of GOOD extractions:
  - User: "I make about 180k and I'm in Washington state." →
      [{kind:"fact", factKey:"annual_income", newValue:180000,
        confidence:0.92, evidence:"I make about 180k", stakesLevel:"medium"},
       {kind:"fact", factKey:"state", newValue:"WA",
        confidence:0.98, evidence:"I'm in Washington state", stakesLevel:"low"}]
  - User: "We want to buy a house in 3 years, probably need 100k down." →
      [{kind:"goal", goalKey:"house_down_payment",
        newValue:{label:"House down payment", targetValueCents:10000000,
                  targetDate:"2029-05-01"},
        confidence:0.86,
        evidence:"buy a house in 3 years, probably need 100k down",
        stakesLevel:"high"}]

EXAMPLES of what NOT to extract:
  - "What's my current balance?" → NOTHING (pure query)
  - "I might want to retire early someday" → NOTHING (vague, hypothetical)
  - "I heard 401(k) matches are good" → NOTHING (no fact about THIS user)

If nothing is worth extracting, return: { "extractions": [] }
`.trim();

function buildExtractorUserTurn(input: {
  userMessage: string;
  assistantReply: string;
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>;
  profile: ProfileSnapshot;
}): string {
  return [
    "=== CURRENT USER PROFILE (avoid re-extracting things already here) ===",
    `FACTS: ${
      input.profile.facts.length === 0
        ? "(none)"
        : JSON.stringify(input.profile.facts)
    }`,
    `ACTIVE GOALS: ${
      input.profile.activeGoals.length === 0
        ? "(none)"
        : JSON.stringify(input.profile.activeGoals)
    }`,
    "",
    "=== RECENT HISTORY (context only — do NOT extract from these) ===",
    input.recentHistory
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n") || "(none)",
    "",
    "=== LATEST EXCHANGE (extract facts/goals from the USER message) ===",
    `USER: ${input.userMessage}`,
    `ASSISTANT: ${input.assistantReply}`,
    "",
    "Return a JSON object with an 'extractions' array. Empty array is fine.",
    "Remember: evidence must quote or paraphrase the USER message verbatim."
  ].join("\n");
}

const EXTRACTOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    extractions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          factKey: { type: ["string", "null"] },
          goalKey: { type: ["string", "null"] },
          newValue: {},
          confidence: { type: "number" },
          evidence: { type: "string" },
          reasoning: { type: ["string", "null"] },
          stakesLevel: { type: "string" }
        },
        required: ["kind", "newValue", "confidence", "evidence", "stakesLevel"],
        additionalProperties: true
      }
    }
  },
  required: ["extractions"],
  additionalProperties: false
};

// ---------------------------------------------------------------------------
// Main extractor entry point
// ---------------------------------------------------------------------------

export async function runFactExtractor(input: {
  userId: string;
  userMessage: string;
  assistantReply: string;
  recentHistory: Array<{ role: "user" | "assistant"; content: string }>;
  sessionId?: string | null;
  chatMessageId?: string | null;
  provider: LlmProvider;
}): Promise<ExtractionResult> {
  const preCheck = isTurnWorthExtracting(input.userMessage);
  if (!preCheck.worth) {
    return {
      skipped: true,
      skipReason: preCheck.reason,
      accepted: 0,
      autoApplied: 0,
      staged: 0,
      rejected: 0,
      extractions: []
    };
  }

  const profile = await getProfileSnapshot(input.userId);
  const userTurn = buildExtractorUserTurn({
    userMessage: input.userMessage,
    assistantReply: input.assistantReply,
    recentHistory: input.recentHistory.slice(-6),
    profile
  });

  // Fire the LLM with structured output.
  let llmResponse;
  try {
    llmResponse = await input.provider.generate({
      systemPrompt: EXTRACTOR_SYSTEM_INSTRUCTION,
      messages: [{ role: "user", content: userTurn }],
      responseSchema: EXTRACTOR_RESPONSE_SCHEMA,
      temperature: 0.1,
      timeoutMs: 12_000
    });
  } catch (err) {
    // Extractor failures are silent — chat response already shipped.
    console.warn("[extractor] LLM call failed:", err);
    return {
      skipped: true,
      skipReason: "llm_error",
      accepted: 0,
      autoApplied: 0,
      staged: 0,
      rejected: 0,
      extractions: []
    };
  }

  // Parse JSON
  let parsed: { extractions: RawExtraction[] };
  try {
    if (!llmResponse.text) throw new Error("empty text");
    parsed = JSON.parse(llmResponse.text) as { extractions: RawExtraction[] };
    if (!parsed || !Array.isArray(parsed.extractions)) {
      throw new Error("missing extractions array");
    }
  } catch (err) {
    console.warn("[extractor] parse error:", err, "raw:", llmResponse.text?.slice(0, 500));
    return {
      skipped: true,
      skipReason: "parse_error",
      accepted: 0,
      autoApplied: 0,
      staged: 0,
      rejected: 0,
      extractions: []
    };
  }

  const summary: ExtractionResult = {
    skipped: false,
    accepted: 0,
    autoApplied: 0,
    staged: 0,
    rejected: 0,
    extractions: []
  };

  for (const raw of parsed.extractions) {
    try {
      const processed = await processExtraction({
        raw,
        userId: input.userId,
        userMessage: input.userMessage,
        sessionId: input.sessionId ?? null,
        chatMessageId: input.chatMessageId ?? null,
        profile
      });
      summary.extractions.push({
        id: processed.id,
        kind: processed.kind,
        key: processed.key,
        status: processed.status,
        summary: processed.summary
      });
      if (processed.status === "rejected") summary.rejected += 1;
      else if (processed.status === "auto_applied") {
        summary.autoApplied += 1;
        summary.accepted += 1;
      } else if (processed.status === "staged") {
        summary.staged += 1;
        summary.accepted += 1;
      }
    } catch (err) {
      console.warn("[extractor] process error:", err);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Per-extraction processing: validate, decide auto-apply vs stage, persist.
// ---------------------------------------------------------------------------

type ProcessedExtraction = {
  id: string;
  kind: string;
  key: string | null;
  status: string;
  summary: string;
};

async function processExtraction(args: {
  raw: RawExtraction;
  userId: string;
  userMessage: string;
  sessionId: string | null;
  chatMessageId: string | null;
  profile: ProfileSnapshot;
}): Promise<ProcessedExtraction> {
  const { raw, userId, userMessage, sessionId, chatMessageId, profile } = args;

  // ---- Validation ---------------------------------------------------------
  const kind = raw.kind as ExtractedFactKind;
  if (
    !["fact", "goal", "goal_progress", "obligation", "revert"].includes(kind)
  ) {
    return logRejected(args, "invalid kind", null, null);
  }
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
    return logRejected(args, "invalid confidence", null, null);
  }
  if (!raw.evidence || raw.evidence.length < 4) {
    return logRejected(args, "missing evidence", null, null);
  }
  // Evidence substring validation — blocks hallucinated facts.
  if (!evidenceMatchesSource(raw.evidence, userMessage)) {
    return logRejected(
      args,
      "evidence not in user message",
      raw.factKey ?? null,
      raw.goalKey ?? null
    );
  }

  let factKey: string | null = null;
  let goalKey: string | null = null;

  if (kind === "fact" || kind === "obligation") {
    factKey = raw.factKey ?? null;
    if (!factKey || !ALLOWED_FACT_KEYS.has(factKey)) {
      return logRejected(args, "disallowed factKey", factKey, null);
    }
  } else if (kind === "goal" || kind === "goal_progress") {
    goalKey = raw.goalKey ?? null;
    if (!goalKey || !GOAL_KEY_REGEX.test(goalKey)) {
      return logRejected(args, "invalid goalKey", null, goalKey);
    }
  } else if (kind === "revert") {
    factKey = raw.factKey ?? null;
    goalKey = raw.goalKey ?? null;
    if (!factKey && !goalKey) {
      return logRejected(args, "revert missing target", null, null);
    }
  }

  // ---- Dedup: same key + same value within 24h ----------------------------
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentSame = await prisma.extractedFact.findFirst({
    where: {
      userId,
      kind,
      factKey,
      goalKey,
      createdAt: { gte: since },
      status: { in: ["auto_applied", "staged", "confirmed"] }
    }
  });
  if (recentSame) {
    const sameValue =
      JSON.stringify(recentSame.newValue) === JSON.stringify(raw.newValue);
    if (sameValue) {
      return logRejected(args, "dedup: already extracted recently", factKey, goalKey);
    }
  }

  // ---- Contradiction: existing fact/goal with different value -------------
  let previousValue: unknown = null;
  let isContradiction = false;

  if (kind === "fact" || kind === "obligation") {
    const existing = profile.facts.find((f) => f.factKey === factKey);
    if (existing) {
      previousValue = existing.factValue;
      const same =
        JSON.stringify(existing.factValue) === JSON.stringify(raw.newValue);
      if (!same) isContradiction = true;
    }
  } else if (kind === "goal_progress" || kind === "goal") {
    const existing = profile.activeGoals.find((g) => g.goalKey === goalKey);
    if (existing) {
      previousValue = existing;
      // Goals are complex objects; any difference counts as contradiction
      // for stakes purposes. goal kind is always high-stakes anyway.
      isContradiction = true;
    }
  }

  // ---- Auto-apply policy --------------------------------------------------
  // - low stakes, confidence ≥ 0.8, no contradiction: auto-apply
  // - medium stakes, confidence ≥ 0.85, no contradiction: auto-apply
  // - high stakes: always stage
  // - any contradiction: stage (even low stakes)
  const stakes = (raw.stakesLevel ?? "medium") as StakesLevel;
  let shouldAutoApply = false;
  if (!isContradiction && kind !== "revert") {
    if (stakes === "low" && raw.confidence >= 0.8) shouldAutoApply = true;
    else if (stakes === "medium" && raw.confidence >= 0.85) shouldAutoApply = true;
    // High stakes + goal + revert never auto-apply.
  }

  // ---- Persist ExtractedFact row ------------------------------------------
  const statusForWrite: ExtractedFactStatus = shouldAutoApply
    ? "auto_applied"
    : "staged";

  const created = await prisma.extractedFact.create({
    data: {
      userId,
      sessionId,
      chatMessageId,
      kind,
      status: statusForWrite,
      factKey,
      goalKey,
      newValue: normalizeJson(raw.newValue),
      previousValue: normalizeJsonNullable(previousValue),
      confidence: raw.confidence,
      evidence: raw.evidence,
      reasoning: raw.reasoning ?? null,
      stakesLevel: stakes,
      appliedAt: shouldAutoApply ? new Date() : null
    }
  });

  // ---- If auto-applied, write the actual UserFact / UserGoal row ---------
  if (shouldAutoApply) {
    try {
      await applyExtraction({
        userId,
        kind,
        factKey,
        goalKey,
        newValue: raw.newValue
      });
    } catch (err) {
      console.warn("[extractor] auto-apply failed, rolling back to staged:", err);
      await prisma.extractedFact.update({
        where: { id: created.id },
        data: { status: "staged", appliedAt: null }
      });
      return {
        id: created.id,
        kind,
        key: factKey ?? goalKey,
        status: "staged",
        summary: summarizeExtraction(raw)
      };
    }
  }

  return {
    id: created.id,
    kind,
    key: factKey ?? goalKey,
    status: statusForWrite,
    summary: summarizeExtraction(raw)
  };
}

/**
 * Write the actual UserFact / UserGoal row for an auto-applied extraction.
 */
async function applyExtraction(args: {
  userId: string;
  kind: ExtractedFactKind;
  factKey: string | null;
  goalKey: string | null;
  newValue: unknown;
  /**
   * When this extraction came from an uploaded document, pass "import"
   * so the produced UserFact reflects its document provenance (shown in
   * specialist primer as "source: <doc title>").
   */
  source?: UserFactSource;
}): Promise<void> {
  const { userId, kind, factKey, goalKey, newValue } = args;
  const source: UserFactSource = args.source ?? "conversation";

  if (kind === "fact" || kind === "obligation") {
    if (!factKey) throw new Error("missing factKey");
    await prisma.userFact.upsert({
      where: { userId_factKey: { userId, factKey } },
      update: {
        factValue: normalizeJson(newValue),
        source,
        updatedAt: new Date()
      },
      create: {
        userId,
        factKey,
        factValue: normalizeJson(newValue),
        source
      }
    });
    return;
  }

  if (kind === "goal" || kind === "goal_progress") {
    if (!goalKey) throw new Error("missing goalKey");
    const value = newValue as {
      label?: string;
      targetValueCents?: number | null;
      targetDate?: string | null;
      commitment?: string | null;
    };
    const label = (value.label ?? goalKey).slice(0, 200);
    const targetValueCents =
      typeof value.targetValueCents === "number"
        ? BigInt(value.targetValueCents)
        : null;
    const targetDate = value.targetDate ? new Date(value.targetDate) : null;

    await prisma.userGoal.upsert({
      where: { userId_goalKey: { userId, goalKey } },
      update: {
        label,
        targetValueCents,
        targetDate,
        commitment: value.commitment ?? null,
        isActive: true,
        updatedAt: new Date()
      },
      create: {
        userId,
        goalKey,
        label,
        targetValueCents,
        targetDate,
        commitment: value.commitment ?? null,
        isActive: true
      }
    });
    return;
  }

  if (kind === "revert") {
    // Revert is never auto-applied, so this shouldn't fire. Defensive:
    throw new Error("revert kind cannot be auto-applied");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeJson(value: unknown): Prisma.InputJsonValue {
  // Prisma's Json columns accept JS objects but we round-trip through JSON
  // to ensure Dates / BigInts / other odd types become safe primitives.
  // Always returns a valid InputJsonValue (never null — callers use this
  // for new values; for nullable columns, conditionally pass JsonNull).
  if (value === null || value === undefined) {
    return {} as Prisma.InputJsonValue;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return String(value);
  }
}

function normalizeJsonNullable(
  value: unknown
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return String(value);
  }
}

async function logRejected(
  args: {
    raw: RawExtraction;
    userId: string;
    sessionId: string | null;
    chatMessageId: string | null;
  },
  reason: string,
  factKey: string | null,
  goalKey: string | null
): Promise<ProcessedExtraction> {
  const row = await prisma.extractedFact.create({
    data: {
      userId: args.userId,
      sessionId: args.sessionId,
      chatMessageId: args.chatMessageId,
      kind: "fact",
      status: "rejected",
      factKey,
      goalKey,
      newValue: normalizeJson(args.raw.newValue),
      confidence: args.raw.confidence ?? 0,
      evidence: args.raw.evidence ?? "",
      reasoning: `rejected: ${reason}`,
      stakesLevel: args.raw.stakesLevel ?? "low"
    }
  });
  return {
    id: row.id,
    kind: args.raw.kind ?? "unknown",
    key: factKey ?? goalKey,
    status: "rejected",
    summary: `rejected: ${reason}`
  };
}

function summarizeExtraction(raw: RawExtraction): string {
  const target = raw.factKey ?? raw.goalKey ?? raw.kind;
  const value =
    typeof raw.newValue === "object"
      ? JSON.stringify(raw.newValue).slice(0, 80)
      : String(raw.newValue).slice(0, 80);
  return `${target} = ${value}`;
}

// ---------------------------------------------------------------------------
// User-facing operations (for /context UI)
// ---------------------------------------------------------------------------

export async function listRecentExtractions(userId: string, limit = 30) {
  const rows = await prisma.extractedFact.findMany({
    where: {
      userId,
      status: { in: ["auto_applied", "staged", "confirmed", "reverted"] }
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  return rows;
}

export async function confirmStagedExtraction(input: {
  userId: string;
  id: string;
}) {
  const row = await prisma.extractedFact.findUnique({
    where: { id: input.id }
  });
  if (!row || row.userId !== input.userId) throw new Error("not found");
  if (row.status !== "staged") throw new Error("not staged");

  await applyExtraction({
    userId: row.userId,
    kind: row.kind as ExtractedFactKind,
    factKey: row.factKey,
    goalKey: row.goalKey,
    newValue: row.newValue,
    // Document-sourced extractions get source=import so the specialist
    // primer can show provenance ("source: 2024 W-2").
    source: row.userDocumentId ? ("import" as UserFactSource) : undefined
  });
  await prisma.extractedFact.update({
    where: { id: row.id },
    data: { status: "confirmed", appliedAt: new Date() }
  });
}

export async function rejectStagedExtraction(input: {
  userId: string;
  id: string;
}) {
  const row = await prisma.extractedFact.findUnique({
    where: { id: input.id }
  });
  if (!row || row.userId !== input.userId) throw new Error("not found");
  await prisma.extractedFact.update({
    where: { id: row.id },
    data: { status: "rejected" }
  });
}

export async function revertAppliedExtraction(input: {
  userId: string;
  id: string;
}) {
  const row = await prisma.extractedFact.findUnique({
    where: { id: input.id }
  });
  if (!row || row.userId !== input.userId) throw new Error("not found");
  if (row.status !== "auto_applied" && row.status !== "confirmed") {
    throw new Error("not revertable");
  }

  // Restore previous value, or delete if there was none.
  if (row.kind === "fact" || row.kind === "obligation") {
    if (!row.factKey) throw new Error("missing factKey");
    if (row.previousValue === null) {
      await prisma.userFact.deleteMany({
        where: { userId: row.userId, factKey: row.factKey }
      });
    } else {
      const restored = normalizeJson(row.previousValue);
      await prisma.userFact.upsert({
        where: {
          userId_factKey: { userId: row.userId, factKey: row.factKey }
        },
        update: { factValue: restored },
        create: {
          userId: row.userId,
          factKey: row.factKey,
          factValue: restored,
          source: "conversation" as UserFactSource
        }
      });
    }
  } else if (row.kind === "goal" || row.kind === "goal_progress") {
    if (!row.goalKey) throw new Error("missing goalKey");
    if (row.previousValue === null) {
      await prisma.userGoal.deleteMany({
        where: { userId: row.userId, goalKey: row.goalKey }
      });
    } else {
      // Can't easily "restore" a prior goal snapshot without more data;
      // just mark inactive and let the user re-enter it. Simpler.
      await prisma.userGoal.updateMany({
        where: { userId: row.userId, goalKey: row.goalKey },
        data: { isActive: false }
      });
    }
  }

  await prisma.extractedFact.update({
    where: { id: row.id },
    data: { status: "reverted", revertedAt: new Date() }
  });
}

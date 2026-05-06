import { prisma } from "@portfolio/db";
import {
  CandidateLessonStatus,
  LessonKind,
  LessonTopic
} from "@portfolio/db";
import { z } from "zod";
import { getOrCreateDefaultUser } from "./user";
import type { LlmProvider } from "./llm/types";

/**
 * Agentic memory & lessons layer.
 *
 * Two tables:
 *   - CandidateLesson: staged patterns awaiting review (mechanical output)
 *   - AgentLesson: graduated lessons the advisor reads during future turns
 *
 * Pipelines:
 *   - stageCandidateLessons(provider): reads recent RecommendationRuns,
 *     clusters them via the judge LLM, writes CandidateLessons.
 *   - graduateCandidate(id, rationale): promotes to AgentLesson.
 *   - listLessonsForTopic(topic?): retrieval for specialist context.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CandidateLessonSnapshot = {
  id: string;
  kind: LessonKind;
  topic: LessonTopic;
  patternSummary: string;
  evidenceRunIds: string[];
  clusterStrength: number;
  status: CandidateLessonStatus;
  rationale: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type AgentLessonSnapshot = {
  id: string;
  kind: LessonKind;
  topic: LessonTopic;
  patternSummary: string;
  actionOrCaveat: string;
  evidenceRunIds: string[];
  relevanceKeywords: string[];
  timesApplied: number;
  lastAppliedAt: string | null;
  graduatedAt: string;
};

type StageCandidatesResult = {
  ok: boolean;
  candidatesCreated: number;
  candidatesSkipped: number;
  runsConsidered: number;
  error?: string;
  rawClusteringText?: string;
};

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function serializeCandidate(candidate: {
  id: string;
  kind: LessonKind;
  topic: LessonTopic;
  patternSummary: string;
  evidenceRunIds: unknown;
  clusterStrength: number;
  status: CandidateLessonStatus;
  rationale: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): CandidateLessonSnapshot {
  return {
    id: candidate.id,
    kind: candidate.kind,
    topic: candidate.topic,
    patternSummary: candidate.patternSummary,
    evidenceRunIds: asStringArray(candidate.evidenceRunIds),
    clusterStrength: candidate.clusterStrength,
    status: candidate.status,
    rationale: candidate.rationale,
    reviewedAt: candidate.reviewedAt?.toISOString() ?? null,
    createdAt: candidate.createdAt.toISOString()
  };
}

function serializeLesson(lesson: {
  id: string;
  kind: LessonKind;
  topic: LessonTopic;
  patternSummary: string;
  actionOrCaveat: string;
  evidenceRunIds: unknown;
  relevanceKeywords: unknown;
  timesApplied: number;
  lastAppliedAt: Date | null;
  graduatedAt: Date;
}): AgentLessonSnapshot {
  return {
    id: lesson.id,
    kind: lesson.kind,
    topic: lesson.topic,
    patternSummary: lesson.patternSummary,
    actionOrCaveat: lesson.actionOrCaveat,
    evidenceRunIds: asStringArray(lesson.evidenceRunIds),
    relevanceKeywords: asStringArray(lesson.relevanceKeywords),
    timesApplied: lesson.timesApplied,
    lastAppliedAt: lesson.lastAppliedAt?.toISOString() ?? null,
    graduatedAt: lesson.graduatedAt.toISOString()
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listPendingCandidates(): Promise<CandidateLessonSnapshot[]> {
  const user = await getOrCreateDefaultUser();
  const rows = await prisma.candidateLesson.findMany({
    where: { userId: user.id, status: CandidateLessonStatus.pending },
    orderBy: [{ clusterStrength: "desc" }, { createdAt: "desc" }]
  });
  return rows.map(serializeCandidate);
}

export async function listAllCandidates(
  filter?: CandidateLessonStatus
): Promise<CandidateLessonSnapshot[]> {
  const user = await getOrCreateDefaultUser();
  const rows = await prisma.candidateLesson.findMany({
    where: {
      userId: user.id,
      ...(filter ? { status: filter } : {})
    },
    orderBy: [{ createdAt: "desc" }]
  });
  return rows.map(serializeCandidate);
}

export async function listAgentLessons(
  topic?: LessonTopic
): Promise<AgentLessonSnapshot[]> {
  const user = await getOrCreateDefaultUser();
  const rows = await prisma.agentLesson.findMany({
    where: {
      userId: user.id,
      ...(topic ? { topic } : {})
    },
    orderBy: [{ graduatedAt: "desc" }]
  });
  return rows.map(serializeLesson);
}

export async function graduateCandidate(
  candidateId: string,
  rationale: string
): Promise<AgentLessonSnapshot> {
  if (!rationale.trim()) {
    throw new Error("rationale is required to graduate a candidate lesson");
  }
  const user = await getOrCreateDefaultUser();
  const candidate = await prisma.candidateLesson.findFirst({
    where: { id: candidateId, userId: user.id }
  });
  if (!candidate) {
    throw new Error(`candidate lesson ${candidateId} not found`);
  }
  if (candidate.status !== CandidateLessonStatus.pending) {
    throw new Error(
      `candidate lesson ${candidateId} is ${candidate.status}, expected pending`
    );
  }

  // Derive a short "actionOrCaveat" from the pattern — the pattern itself
  // describes *what we saw*, we need to also state *what the advisor should do*.
  // Simple heuristic: prefix with "Therefore, ..."; the human reviewer can
  // supply a richer rationale via the rationale field.
  const actionOrCaveat =
    candidate.kind === LessonKind.preference
      ? `Respect this user preference in future answers: ${candidate.patternSummary}`
      : `Apply this advice lesson in future answers: ${candidate.patternSummary}`;

  // Seed relevance keywords from the pattern summary + topic.
  const relevanceKeywords = deriveKeywords(candidate.patternSummary, candidate.topic);

  const [, lesson] = await prisma.$transaction([
    prisma.candidateLesson.update({
      where: { id: candidate.id },
      data: {
        status: CandidateLessonStatus.graduated,
        rationale,
        reviewedAt: new Date()
      }
    }),
    prisma.agentLesson.create({
      data: {
        userId: user.id,
        kind: candidate.kind,
        topic: candidate.topic,
        patternSummary: candidate.patternSummary,
        actionOrCaveat,
        evidenceRunIds: candidate.evidenceRunIds ?? [],
        relevanceKeywords,
        rationale,
        candidateLessonId: candidate.id
      }
    })
  ]);
  return serializeLesson(lesson);
}

export async function rejectCandidate(
  candidateId: string,
  rationale: string
): Promise<CandidateLessonSnapshot> {
  if (!rationale.trim()) {
    throw new Error("rationale is required to reject a candidate lesson");
  }
  const user = await getOrCreateDefaultUser();
  const candidate = await prisma.candidateLesson.findFirst({
    where: { id: candidateId, userId: user.id }
  });
  if (!candidate) {
    throw new Error(`candidate lesson ${candidateId} not found`);
  }
  if (candidate.status !== CandidateLessonStatus.pending) {
    throw new Error(
      `candidate lesson ${candidateId} is ${candidate.status}, expected pending`
    );
  }
  const updated = await prisma.candidateLesson.update({
    where: { id: candidate.id },
    data: {
      status: CandidateLessonStatus.rejected,
      rationale,
      reviewedAt: new Date()
    }
  });
  return serializeCandidate(updated);
}

/**
 * Mark a graduated lesson as applied. Used by specialists to track which
 * lessons are still useful (unused lessons are candidates for pruning).
 */
export async function noteLessonApplied(lessonId: string): Promise<void> {
  try {
    await prisma.agentLesson.update({
      where: { id: lessonId },
      data: {
        timesApplied: { increment: 1 },
        lastAppliedAt: new Date()
      }
    });
  } catch {
    // Swallow; noteLessonApplied is best-effort telemetry.
  }
}

// ---------------------------------------------------------------------------
// Retrieval for specialist context
// ---------------------------------------------------------------------------

/**
 * Fetch graduated lessons relevant to the given topic. If no topic, returns
 * all lessons sorted by recency (capped). Used by the get_user_lessons tool
 * and by specialists at turn-start to augment their system prompt.
 */
export async function getRelevantLessons(options?: {
  topic?: LessonTopic;
  limit?: number;
}): Promise<AgentLessonSnapshot[]> {
  const user = await getOrCreateDefaultUser();
  const limit = Math.max(1, Math.min(options?.limit ?? 8, 20));
  const rows = await prisma.agentLesson.findMany({
    where: {
      userId: user.id,
      ...(options?.topic ? { topic: options.topic } : {})
    },
    orderBy: [{ graduatedAt: "desc" }],
    take: limit
  });
  return rows.map(serializeLesson);
}

function deriveKeywords(patternSummary: string, topic: LessonTopic): string[] {
  // Simple heuristic: lowercase non-stopword tokens from the pattern, plus topic.
  const STOPWORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "user",
    "users",
    "when",
    "prefers",
    "prefer",
    "to",
    "is",
    "for",
    "of",
    "in",
    "on",
    "at",
    "that",
    "this",
    "with",
    "about"
  ]);
  const tokens = patternSummary
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return Array.from(new Set([topic as string, ...tokens])).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Clustering / staging
// ---------------------------------------------------------------------------

const clusteringResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        kind: z.enum(["preference", "advice_lesson"]),
        topic: z.enum([
          "tax",
          "retirement",
          "spending",
          "portfolio",
          "goals",
          "general"
        ]),
        patternSummary: z.string().min(10).max(400),
        evidenceRunIds: z.array(z.string()).min(1).max(10),
        clusterStrength: z.number().int().min(1).max(100)
      })
    )
    .max(6)
});

const clusteringSystemPrompt = `
You analyze recent personal-finance advisor transcripts to identify recurring patterns that might become graduated lessons for future turns.

Your job is NARROW:
  - Read the compact digests of recent RecommendationRuns.
  - Identify patterns that recur across ≥3 runs. Ignore one-offs.
  - For each pattern, decide if it's a "preference" (how the user likes advice delivered) or an "advice_lesson" (a rubric the advisor should apply in similar situations).
  - Return structured JSON with {kind, topic, patternSummary, evidenceRunIds, clusterStrength}.

Do NOT:
  - Invent patterns that aren't supported by ≥3 runs.
  - Make judgment calls about what the user "should" do; that's for the advisor.
  - Return more than 6 candidates per pass.
  - Include evidence run ids that don't appear in the input.

If no patterns recur strongly, return {candidates: []}.

Output strict JSON only, no code fences.
`.trim();

const clusteringJsonSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["preference", "advice_lesson"] },
          topic: {
            type: "string",
            enum: [
              "tax",
              "retirement",
              "spending",
              "portfolio",
              "goals",
              "general"
            ]
          },
          patternSummary: { type: "string" },
          evidenceRunIds: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
            maxItems: 10
          },
          clusterStrength: { type: "integer", minimum: 1, maximum: 100 }
        },
        required: [
          "kind",
          "topic",
          "patternSummary",
          "evidenceRunIds",
          "clusterStrength"
        ]
      }
    }
  },
  required: ["candidates"]
};

type RunDigest = {
  id: string;
  createdAt: string;
  status: string;
  tier: string | null;
  specialists: string[];
  userMessage: string;
  answer: string | null;
  toolsCalled: string[];
};

function buildRunDigests(
  rows: Array<{
    id: string;
    createdAt: Date;
    status: string;
    inputSnapshot: unknown;
    outputPayload: unknown;
  }>
): RunDigest[] {
  return rows.map((row) => {
    const input = (row.inputSnapshot ?? {}) as {
      mode?: string;
      message?: string;
      routerTier?: string;
      specialistsInvoked?: string[];
    };
    const output = (row.outputPayload ?? {}) as {
      finalReply?: { answer?: string } | null;
      specialists?: Array<{
        trace?: Array<{ kind: string; toolName?: string }>;
      }>;
    };
    const tools = new Set<string>();
    for (const s of output.specialists ?? []) {
      for (const step of s.trace ?? []) {
        if (step.kind === "tool_call" && step.toolName) tools.add(step.toolName);
      }
    }
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      tier: input.routerTier ?? null,
      specialists: input.specialistsInvoked ?? [],
      userMessage: (input.message ?? "").slice(0, 300),
      answer: (output.finalReply?.answer ?? "").slice(0, 400),
      toolsCalled: Array.from(tools)
    };
  });
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last < 0) return null;
  try {
    return JSON.parse(trimmed.slice(first, last + 1));
  } catch {
    return null;
  }
}

/**
 * Cluster recent RecommendationRuns into CandidateLessons.
 * Mechanical output only — no agent graduation, no reasoning about quality.
 *
 * @param provider the judge LLM provider (use ModelPool.get("judge"))
 * @param options.lookbackDays default 14; only consider runs newer than this
 * @param options.maxRuns default 30; upper bound on runs analyzed
 */
export async function stageCandidateLessons(input: {
  provider: LlmProvider;
  lookbackDays?: number;
  maxRuns?: number;
  /**
   * Target user id. When omitted, falls back to session/first-user
   * (legacy single-user behaviour). Cron paths pass this explicitly.
   */
  userId?: string;
}): Promise<StageCandidatesResult> {
  const user = input.userId
    ? await prisma.user.findUniqueOrThrow({ where: { id: input.userId } })
    : await getOrCreateDefaultUser();
  const lookbackDays = input.lookbackDays ?? 14;
  const maxRuns = Math.max(1, Math.min(input.maxRuns ?? 30, 100));
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const rows = await prisma.recommendationRun.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: since }
    },
    orderBy: { createdAt: "desc" },
    take: maxRuns,
    select: {
      id: true,
      createdAt: true,
      status: true,
      inputSnapshot: true,
      outputPayload: true
    }
  });

  // Only cluster agent-mode runs (they're the only ones with meaningful
  // specialists / tool trace to learn from).
  const agentRows = rows.filter((r) => {
    const input = r.inputSnapshot as { mode?: string } | null;
    return input && input.mode === "agent";
  });

  if (agentRows.length < 3) {
    return {
      ok: true,
      candidatesCreated: 0,
      candidatesSkipped: 0,
      runsConsidered: agentRows.length
    };
  }

  const digests = buildRunDigests(agentRows);
  const userTurn = [
    `Consider these ${digests.length} recent agent runs (most recent first):`,
    "",
    ...digests.map(
      (d, i) =>
        `### Run ${i + 1} (id: ${d.id})\n` +
        `Tier: ${d.tier ?? "?"}  Specialists: ${d.specialists.join(", ") || "(none)"}  Tools: ${d.toolsCalled.join(", ") || "(none)"}\n` +
        `USER: ${d.userMessage}\n` +
        `ASSISTANT: ${d.answer || "(no answer)"}`
    ),
    "",
    "Identify patterns recurring across ≥3 of these runs, if any. Return the strict JSON schema described in the system prompt."
  ].join("\n");

  const response = await input.provider.generate({
    systemPrompt: clusteringSystemPrompt,
    messages: [{ role: "user", content: userTurn }],
    responseSchema: clusteringJsonSchema,
    temperature: 0.0,
    timeoutMs: 30_000
  });

  if (response.finishReason === "error" || response.finishReason === "timeout") {
    return {
      ok: false,
      candidatesCreated: 0,
      candidatesSkipped: 0,
      runsConsidered: agentRows.length,
      error: response.error ?? "clustering provider failed"
    };
  }

  const parsedRaw = extractJson(response.text ?? "");
  const validated = parsedRaw ? clusteringResponseSchema.safeParse(parsedRaw) : null;
  if (!validated || !validated.success) {
    return {
      ok: false,
      candidatesCreated: 0,
      candidatesSkipped: 0,
      runsConsidered: agentRows.length,
      error: "clustering output failed schema validation",
      rawClusteringText: response.text ?? undefined
    };
  }

  const validRunIds = new Set(agentRows.map((r) => r.id));
  let created = 0;
  let skipped = 0;

  for (const c of validated.data.candidates) {
    // Guardrail: every evidenceRunId must be real.
    const trustedEvidence = c.evidenceRunIds.filter((id) => validRunIds.has(id));
    if (trustedEvidence.length < 3) {
      skipped += 1;
      continue;
    }

    // Skip if we already have a pending or graduated candidate with the same
    // exact patternSummary — avoid hallucinating duplicates over time.
    const existing = await prisma.candidateLesson.findFirst({
      where: {
        userId: user.id,
        patternSummary: c.patternSummary,
        status: {
          in: [CandidateLessonStatus.pending, CandidateLessonStatus.graduated]
        }
      }
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.candidateLesson.create({
      data: {
        userId: user.id,
        kind: c.kind as LessonKind,
        topic: c.topic as LessonTopic,
        patternSummary: c.patternSummary,
        evidenceRunIds: trustedEvidence,
        clusterStrength: Math.min(c.clusterStrength, trustedEvidence.length)
      }
    });
    created += 1;
  }

  return {
    ok: true,
    candidatesCreated: created,
    candidatesSkipped: skipped,
    runsConsidered: agentRows.length
  };
}

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RecommendationRunStatus, RecommendationType, prisma } from "@portfolio/db";
import { advisorSystemIntent } from "@portfolio/ai";
import {
  buildAdvisorContextNarrative,
  type AdvisorContextFactSheet,
  type AdvisorContextPayload
} from "@/lib/advisor-context";
import { getAdvisorPlanSnapshot } from "@/lib/advisor-plan";
import { getCashflowSummary } from "@/lib/cashflow-summary";
import { getAppEnv } from "@/lib/env";
import { getInvestmentsSummary } from "@/lib/investments";
import { getRecurringSummary } from "@/lib/recurring-summary";
import { listActiveGoals } from "@/lib/goals";
import { getOrCreateDefaultUser } from "@/lib/user";
import { getUserFact } from "@/lib/user-facts";
import type { AgentRunResult } from "@/lib/advisor-agent";
import {
  SPECIALISTS,
  classifyDomains,
  runSpecialist,
  synthesizeSpecialistResponses,
  type SpecialistName,
  type SynthesizerResult
} from "@/lib/advisor-specialists";
import { buildModelPool, roleForTier } from "@/lib/llm/model-pool";
import { routeWithLlm } from "@/lib/advisor-llm-router";
import { checkGroundedness, type GroundednessVerdict } from "@/lib/advisor-groundedness";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(800),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(1000)
      })
    )
    .max(8)
    .optional()
});

const responseSchema = z.object({
  answer: z.string(),
  bullets: z.array(z.string()).max(4),
  caveat: z.string().nullable(),
  followUps: z.array(z.string()).max(4)
});

type AdvisorChatResponse = z.infer<typeof responseSchema>;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ProviderAttempt = {
  provider: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
  rawReply?: AdvisorChatResponse;
};

const MODEL_TIMEOUT_MS = 8000;
const SYSTEM_INSTRUCTION =
  `${advisorSystemIntent}\n` +
  "You are a calm personal finance copilot. Answer briefly, directly, and only from the provided context. " +
  "Do not give legal or tax advice. Avoid pretending you know payroll facts that are missing. " +
  "When data gaps are flagged in the context, acknowledge them honestly rather than guessing.";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Advisor chat failed.";
}

/**
 * personal_context UserFact is stored as either a raw string, or a JSON
 * object of shape { text: string, ... }. Normalize to a plain string.
 */
function extractPersonalContextText(
  fact: { factValue: unknown } | null
): string | null {
  if (!fact) return null;
  const v = fact.factValue;
  if (typeof v === "string") return v.trim() || null;
  if (v && typeof v === "object" && "text" in v) {
    const t = (v as { text?: unknown }).text;
    if (typeof t === "string") return t.trim() || null;
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, label: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, MODEL_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildUserTurnContent(input: {
  narrative: string;
  factSheet: AdvisorContextFactSheet;
  message: string;
}) {
  return [
    "You are answering a question about the user's own finances.",
    "Use the following narrative and fact-sheet as your only source of truth.",
    "",
    "=== FINANCIAL NARRATIVE ===",
    input.narrative,
    "",
    "=== FACT SHEET (structured values, same data as the narrative) ===",
    JSON.stringify(input.factSheet, null, 2),
    "",
    "=== USER QUESTION ===",
    input.message
  ].join("\n");
}

function buildDeterministicFallback(input: {
  message: string;
  advisorPlan: Awaited<ReturnType<typeof getAdvisorPlanSnapshot>>;
}): AdvisorChatResponse {
  const lower = input.message.toLowerCase();
  const { advisorPlan } = input;
  const retirement = advisorPlan.retirement;
  const paycheckFlow = advisorPlan.paycheckFlow;
  const facts = advisorPlan.facts;

  if (lower.includes("too much") || lower.includes("aggressive")) {
    return {
      answer:
        retirement.status === "aggressive"
          ? "Your current retirement pace looks aggressive relative to the current modeled target."
          : "The current data does not show you as obviously over-saving, but the answer is still limited by the missing payroll context.",
      bullets: [
        `Observed retirement flow is ${paycheckFlow.currentBiweeklyRetirementContribution} per pay cycle.`,
        paycheckFlow.percentOfTakeHomeToRetirement
          ? `That is about ${paycheckFlow.percentOfTakeHomeToRetirement}% of the observed take-home baseline.`
          : "The app does not yet have a stable take-home baseline for a cleaner percentage read.",
        "Pre-tax and Roth 401(k) activity is coming from the imported Fidelity transactions."
      ],
      caveat:
        facts.biweeklyNetPay == null
          ? "Add biweekly net pay to strengthen the recommendation."
          : "This is still based on cash-flow and Fidelity activity, not full payroll-stub detail.",
      followUps: [
        "What should I set as my biweekly net pay?",
        "How should I split my next paycheck?",
        "How much is going to brokerage versus retirement?"
      ]
    };
  }

  if (lower.includes("next paycheck") || lower.includes("split")) {
    const balancedScenario = advisorPlan.paycheckAllocation.scenarios.find(
      (scenario) => scenario.key === "balanced"
    );
    return {
      answer:
        "The balanced scenario is the cleanest default until we have stronger payroll inputs.",
      bullets: balancedScenario
        ? [
            `Retirement: ${balancedScenario.biweeklyAmounts.retirement}`,
            `Taxable investing: ${balancedScenario.biweeklyAmounts.taxableInvesting}`,
            `Reserve: ${balancedScenario.biweeklyAmounts.reserve}`,
            ...balancedScenario.reasoning.slice(0, 1)
          ]
        : ["Balanced allocation is unavailable right now."],
      caveat:
        facts.biweeklyNetPay == null
          ? "These figures are using observed free cash flow as a fallback because biweekly net pay is missing."
          : null,
      followUps: [
        "Should I be saving more into Roth 401(k) or brokerage?",
        "What changes if I enter my actual net pay?",
        "How close am I to my emergency-fund target?"
      ]
    };
  }

  return {
    answer:
      "I can already reason over your observed paycheck flow, Fidelity imports, and saved profile, but the strongest recommendations still depend on your real net-pay input and a cleaner reviewed ledger.",
    bullets: [
      `Observed retirement flow: ${paycheckFlow.currentBiweeklyRetirementContribution} per pay cycle.`,
      `Recurring brokerage deposit: ${paycheckFlow.currentBiweeklyTaxableBrokerageDeposit}.`,
      `Emergency-fund runway: ${advisorPlan.emergencyFund.runwayMonths} months.`,
      `Average monthly free cash flow basis: ${facts.averageMonthlyFreeCashflow}.`
    ],
    caveat:
      facts.biweeklyNetPay == null
        ? "Add biweekly net pay so I can move from rough guidance to a sharper paycheck-level recommendation."
        : "Some advice remains a cash-flow estimate until holdings snapshots are imported too.",
    followUps: [
      "Am I saving too aggressively for retirement right now?",
      "How should I split the next paycheck?",
      "What in my money flow still needs review?"
    ]
  };
}

async function generateWithOpenAi(input: {
  apiKey: string;
  model: string;
  context: AdvisorContextPayload;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const client = new OpenAI({
    apiKey: input.apiKey,
    timeout: MODEL_TIMEOUT_MS
  });

  const response = await withTimeout(
    client.responses.parse({
      model: input.model,
      input: [
        {
          role: "system",
          content: SYSTEM_INSTRUCTION
        },
        ...input.history.map((entry) => ({
          role: entry.role,
          content: entry.content
        })),
        {
          role: "user",
          content: buildUserTurnContent({
            narrative: input.context.narrative,
            factSheet: input.context.factSheet,
            message: input.message
          })
        }
      ],
      text: {
        format: zodTextFormat(responseSchema, "advisor_chat_response")
      }
    }),
    "OpenAI advisor chat"
  );

  const parsed = response.output_parsed as AdvisorChatResponse | null;
  if (!parsed) {
    throw new Error("OpenAI did not return an advisor chat response.");
  }

  return parsed;
}

async function generateWithGemini(input: {
  apiKey: string;
  model: string;
  context: AdvisorContextPayload;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const userContent = buildUserTurnContent({
    narrative: input.context.narrative,
    factSheet: input.context.factSheet,
    message: input.message
  });
  const historyText =
    input.history.length > 0
      ? `\n\nRecent chat history:\n${input.history
          .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
          .join("\n")}`
      : "";

  const response = await withTimeout(
    fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        input.model
      )}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey
        },
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: SYSTEM_INSTRUCTION
              }
            ]
          },
          contents: [
            {
              parts: [
                {
                  text: `${userContent}${historyText}`
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseJsonSchema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                bullets: {
                  type: "array",
                  items: { type: "string" }
                },
                caveat: {
                  type: ["string", "null"]
                },
                followUps: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["answer", "bullets", "caveat", "followUps"],
              additionalProperties: false
            }
          }
        })
      }
    ),
    "Gemini advisor chat"
  );

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  if (!response.ok) {
    throw new Error(
      payload.error?.message ??
        `Gemini request failed with status ${response.status}.`
    );
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini did not return an advisor chat response.");
  }

  return responseSchema.parse(JSON.parse(text));
}

async function persistRecommendationRun(input: {
  status: RecommendationRunStatus;
  message: string;
  historyLen: number;
  narrative: string;
  factSheet: AdvisorContextFactSheet;
  tokenEstimate: number;
  provider: string;
  reply: AdvisorChatResponse;
  attempts: ProviderAttempt[];
}) {
  try {
    const user = await getOrCreateDefaultUser();
    // Prisma's InputJsonValue is strict about `unknown`. Round-trip through
    // JSON so the type system sees a safe value.
    const inputSnapshot = JSON.parse(
      JSON.stringify({
        message: input.message,
        historyLen: input.historyLen,
        narrative: input.narrative,
        factSheet: input.factSheet,
        tokenEstimate: input.tokenEstimate
      })
    );
    const outputPayload = JSON.parse(
      JSON.stringify({
        provider: input.provider,
        reply: input.reply,
        attempts: input.attempts.map((attempt) => ({
          provider: attempt.provider,
          ok: attempt.ok,
          latencyMs: attempt.latencyMs,
          error: attempt.error ?? null
        }))
      })
    );
    await prisma.recommendationRun.create({
      data: {
        userId: user.id,
        type: RecommendationType.general,
        status: input.status,
        inputSnapshot,
        outputPayload
      }
    });
  } catch (persistError) {
    // Never let audit-log failures break the chat response.
    // Log and move on.
    console.error("Failed to persist RecommendationRun:", persistError);
  }
}

/**
 * Roll up token/latency totals across all specialist traces for this turn.
 * Used in the audit payload so dashboards can slice cost/latency without
 * re-walking the full trace.
 */
function computeTraceTotals(
  specialistResults: Array<{
    specialist: SpecialistName;
    result: AgentRunResult;
  }>
) {
  let inputTokens = 0;
  let outputTokens = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let latencyMs = 0;
  for (const r of specialistResults) {
    for (const step of r.result.trace) {
      if (step.kind === "model_call") {
        modelCalls += 1;
        inputTokens += step.inputTokens ?? 0;
        outputTokens += step.outputTokens ?? 0;
        latencyMs += step.latencyMs ?? 0;
      } else if (step.kind === "tool_call") {
        toolCalls += 1;
      }
    }
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    modelCalls,
    toolCalls,
    latencyMs
  };
}

async function persistAgentRun(input: {
  message: string;
  historyLen: number;
  specialistsInvoked: SpecialistName[];
  routerMatched: Array<{ specialist: string; pattern: string }>;
  routerFallback: "none" | "general-advisor";
  routerSource: "llm" | "fallback" | "regex" | "forced";
  routerTier: "fast" | "mid" | "deep";
  routerReasoning: string;
  routerLatencyMs: number;
  routerError?: string;
  specialistResults: Array<{
    specialist: SpecialistName;
    result: AgentRunResult;
  }>;
  finalReply: SynthesizerResult | null;
  synthesized: boolean;
  totalLatencyMs: number;
  groundedness: GroundednessVerdict | null;
  error: string | null;
}) {
  try {
    const user = await getOrCreateDefaultUser();
    const anyOk = input.specialistResults.some((r) => r.result.ok);
    await prisma.recommendationRun.create({
      data: {
        userId: user.id,
        type: RecommendationType.general,
        status: anyOk
          ? RecommendationRunStatus.succeeded
          : RecommendationRunStatus.failed,
        inputSnapshot: {
          mode: "agent",
          message: input.message,
          historyLen: input.historyLen,
          specialistsInvoked: input.specialistsInvoked,
          routerMatched: input.routerMatched,
          routerFallback: input.routerFallback,
          routerSource: input.routerSource,
          routerTier: input.routerTier,
          routerReasoning: input.routerReasoning,
          routerLatencyMs: input.routerLatencyMs,
          routerError: input.routerError ?? null
        },
        outputPayload: {
          finalReply: input.finalReply,
          synthesized: input.synthesized,
          totalLatencyMs: input.totalLatencyMs,
          error: input.error,
          groundedness: input.groundedness,
          totals: computeTraceTotals(input.specialistResults),
          specialists: input.specialistResults.map((r) => ({
            specialist: r.specialist,
            provider: r.result.provider,
            ok: r.result.ok,
            stoppedReason: r.result.stoppedReason,
            toolCallCount: r.result.toolCallCount,
            error: r.result.error ?? null,
            trace: r.result.trace.map((step) => ({
              step: step.step,
              kind: step.kind,
              toolName: step.toolName ?? null,
              latencyMs: step.latencyMs ?? null,
              inputTokens: step.inputTokens ?? null,
              outputTokens: step.outputTokens ?? null,
              error: step.error ?? null
            }))
          }))
        }
      }
    });
  } catch (persistError) {
    console.error("Failed to persist agent RecommendationRun:", persistError);
  }
}

export async function POST(request: NextRequest) {
  const debug = request.nextUrl.searchParams.get("debug") === "1";
  const mode = request.nextUrl.searchParams.get("mode");
  // "agent" = Week 3 specialist/router/LLM stack (preferred going forward).
  // "narrative" (or unset) = Week 1/2 deterministic narrative + single LLM (kept
  // for backward compatibility and cheap lookups when you don't want tool
  // calling). Aliases: default, "" -> narrative.
  const resolvedMode = mode === "agent" ? "agent" : "narrative";
  const forcedSpecialist = request.nextUrl.searchParams.get(
    "specialist"
  ) as SpecialistName | null;
  const attempts: ProviderAttempt[] = [];

  try {
    const body = requestSchema.parse(await request.json());

    // -----------------------------------------------------------------
    // Agent mode: Week 3 LLM-routed specialist architecture.
    //   ?mode=agent               -> LLM router → 1..N specialists → synth
    //   ?mode=agent&specialist=X  -> force specialist X, skip router
    //   ?mode=agent&router=regex  -> force Week 2 regex router (A/B)
    // -----------------------------------------------------------------
    if (resolvedMode === "agent") {
      const env = getAppEnv();
      if (!env.geminiApiKey) {
        return NextResponse.json(
          {
            error:
              "Agent mode requires a Gemini API key. Set GEMINI_API_KEY and retry."
          },
          { status: 400 }
        );
      }

      const started = Date.now();
      // ?forceProvider=gemini|openai lets us A/B providers without env edits.
      const forceProviderParam = request.nextUrl.searchParams.get(
        "forceProvider"
      );
      const forcedFamily: "gemini" | "openai" | null =
        forceProviderParam === "gemini" || forceProviderParam === "openai"
          ? forceProviderParam
          : null;
      const poolOverrides =
        forcedFamily
          ? {
              router: {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash-lite"
                    : "gpt-4.1-nano"
              },
              specialist: {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash"
                    : "gpt-4.1-mini"
              },
              synthesizer: {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash"
                    : "gpt-4.1-mini"
              },
              judge: {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash"
                    : "gpt-4.1-mini"
              },
              "user-sim": {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash-lite"
                    : "gpt-4.1-nano"
              },
              "tier-fast": {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash-lite"
                    : "gpt-4.1-nano"
              },
              "tier-mid": {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-flash"
                    : "gpt-4.1-mini"
              },
              "tier-deep": {
                family: forcedFamily,
                model:
                  forcedFamily === "gemini"
                    ? "gemini-2.5-pro"
                    : "gpt-4.1"
              }
            }
          : undefined;
      const pool = buildModelPool(
        poolOverrides ? { overrides: poolOverrides, enableFailover: false } : undefined
      );
      const useLlmRouter =
        request.nextUrl.searchParams.get("router") !== "regex";

      // 1. Route.
      let classification: ReturnType<typeof classifyDomains>;
      let specialistsToRun: SpecialistName[];
      let routerTier: "fast" | "mid" | "deep" = "mid";
      let routerSource: "llm" | "fallback" | "regex" | "forced" = "regex";
      let routerLatencyMs = 0;
      let routerReasoning = "";
      let routerError: string | undefined;

      if (forcedSpecialist && forcedSpecialist in SPECIALISTS) {
        classification = {
          domains: [forcedSpecialist],
          matchedPatterns: [],
          fallback: "none"
        };
        specialistsToRun = [forcedSpecialist];
        routerSource = "forced";
        routerReasoning = `user forced specialist=${forcedSpecialist}`;
      } else if (forcedSpecialist) {
        return NextResponse.json(
          {
            error: `Unknown specialist "${forcedSpecialist}". Valid: ${Object.keys(SPECIALISTS).join(", ")}.`
          },
          { status: 400 }
        );
      } else if (useLlmRouter) {
        // LLM-based routing (Week 3 default).
        const outcome = await routeWithLlm({
          provider: pool.get("router"),
          message: body.message,
          history: body.history,
          fallback: () => {
            const regexResult = classifyDomains(body.message);
            return {
              specialists: regexResult.domains,
              tier: "mid" as const,
              reasoning: "regex router fallback"
            };
          }
        });
        specialistsToRun = outcome.decision.specialists as SpecialistName[];
        routerTier = outcome.decision.tier;
        routerSource = outcome.source;
        routerLatencyMs = outcome.latencyMs;
        routerReasoning = outcome.decision.reasoning;
        routerError = outcome.error;
        classification = {
          domains: specialistsToRun,
          matchedPatterns: [],
          fallback: "none"
        };
      } else {
        // ?router=regex explicitly requested; use Week 2 regex classifier.
        classification = classifyDomains(body.message);
        specialistsToRun = classification.domains;
      }

      // 2. Pick specialist provider by tier. Synthesizer uses tier as well.
      const specialistProvider = pool.get(roleForTier(routerTier));
      const synthProvider = pool.get(roleForTier(routerTier));

      // Fetch user-provided personal context once (shared across specialists).
      const personalContextFactForAgent = await getUserFact("personal_context");
      const personalContextForAgent = extractPersonalContextText(
        personalContextFactForAgent
      );

      // Resolve the user id so each specialist can inject known facts
      // + active goals into its primer. getOrCreateDefaultUser is
      // session-scoped in request context (throws if unauth).
      const agentUser = await getOrCreateDefaultUser();

      // 2. Run specialist(s) in parallel.
      const specialistResults = await Promise.all(
        specialistsToRun.map((name) =>
          runSpecialist({
            specialist: name,
            provider: specialistProvider,
            message: body.message,
            history: body.history ?? [],
            personalContext: personalContextForAgent,
            userId: agentUser.id
          }).then((result) => ({ specialist: name, result }))
        )
      );

      // 3. Synthesize or pick the single reply.
      let finalReply: SynthesizerResult | null = null;
      let synthesized = false;

      if (specialistResults.length === 1) {
        finalReply = specialistResults[0].result.reply;
      } else {
        const forSynth = specialistResults.map((r) => ({
          specialist: r.specialist,
          reply: r.result.reply,
          error: r.result.error ?? null
        }));
        const allFailed = forSynth.every((r) => r.reply === null);
        if (allFailed) {
          finalReply = null;
        } else {
          finalReply = await synthesizeSpecialistResponses({
            provider: synthProvider,
            userMessage: body.message,
            specialistResponses: forSynth
          });
          synthesized = true;
        }
      }

      const totalLatencyMs = Date.now() - started;

      // 3b. Optional groundedness check (opt-in via ?groundedness=1).
      let groundedness: GroundednessVerdict | null = null;
      if (finalReply && request.nextUrl.searchParams.get("groundedness") === "1") {
        // Use the aggregated trace from every specialist this turn.
        const combinedTrace = specialistResults.flatMap((r) => r.result.trace);
        groundedness = await checkGroundedness({
          provider: pool.get("judge"),
          answer: finalReply.answer,
          trace: combinedTrace
        });
      }

      // 4. Persist.
      void persistAgentRun({
        message: body.message,
        historyLen: body.history?.length ?? 0,
        specialistsInvoked: specialistsToRun,
        routerMatched: classification.matchedPatterns,
        routerFallback: classification.fallback,
        routerSource,
        routerTier,
        routerReasoning,
        routerLatencyMs,
        routerError,
        specialistResults,
        finalReply,
        synthesized,
        totalLatencyMs,
        groundedness,
        error: finalReply === null ? "All specialists failed." : null
      });

      // 5. Respond.
      if (!finalReply) {
        return NextResponse.json(
          {
            error: "All specialists failed to produce a final answer.",
            specialistsInvoked: specialistsToRun,
            ...(debug
              ? {
                  debug: {
                    routerClassification: classification,
                    routerSource,
                    routerTier,
                    routerReasoning,
                    routerLatencyMs,
                    routerError,
                    specialistResults: specialistResults.map((r) => ({
                      specialist: r.specialist,
                      ok: r.result.ok,
                      stoppedReason: r.result.stoppedReason,
                      error: r.result.error,
                      trace: r.result.trace
                    }))
                  }
                }
              : {})
          },
          { status: 502 }
        );
      }

      const responseBody: Record<string, unknown> = {
        ...finalReply,
        provider: specialistProvider.name,
        mode: "agent",
        specialistsInvoked: specialistsToRun,
        routerSource,
        routerTier,
        synthesized,
        totalLatencyMs
      };
      if (debug) {
        responseBody.debug = {
          routerClassification: classification,
          routerSource,
          routerTier,
          routerReasoning,
          routerLatencyMs,
          routerError,
          modelAssignments: pool.describe(),
          specialists: specialistResults.map((r) => ({
            specialist: r.specialist,
            ok: r.result.ok,
            stoppedReason: r.result.stoppedReason,
            toolCallCount: r.result.toolCallCount,
            appliedLessons: r.result.appliedLessons,
            reply: r.result.reply,
            trace: r.result.trace
          }))
        };
      }
      return NextResponse.json(responseBody);
    }

    // -----------------------------------------------------------------
    // Default mode: Phase 2 deterministic narrative + single LLM call.
    // -----------------------------------------------------------------
    const [advisorPlan, cashflowSummary, investmentsSummary, recurringSummary, activeGoals, personalContextFact] =
      await Promise.all([
        getAdvisorPlanSnapshot(),
        getCashflowSummary(6),
        getInvestmentsSummary(),
        getRecurringSummary(),
        listActiveGoals(),
        getUserFact("personal_context")
      ]);

    const personalContext = extractPersonalContextText(personalContextFact);

    const context = buildAdvisorContextNarrative({
      advisorPlan,
      cashflowSummary,
      investmentsSummary,
      recurringSummary,
      activeGoals,
      personalContext
    });
    const env = getAppEnv();

    let reply: AdvisorChatResponse | null = null;
    let provider = "deterministic";

    if (env.openAiApiKey) {
      const started = Date.now();
      try {
        reply = await generateWithOpenAi({
          apiKey: env.openAiApiKey,
          model: env.openAiModel,
          context,
          message: body.message,
          history: body.history ?? []
        });
        provider = `openai:${env.openAiModel}`;
        attempts.push({
          provider,
          ok: true,
          latencyMs: Date.now() - started,
          rawReply: reply
        });
      } catch (error) {
        attempts.push({
          provider: `openai:${env.openAiModel}`,
          ok: false,
          latencyMs: Date.now() - started,
          error: getErrorMessage(error)
        });
        reply = null;
      }
    }

    if (!reply && env.geminiApiKey) {
      const started = Date.now();
      try {
        reply = await generateWithGemini({
          apiKey: env.geminiApiKey,
          model: env.geminiModel,
          context,
          message: body.message,
          history: body.history ?? []
        });
        provider = `gemini:${env.geminiModel}`;
        attempts.push({
          provider,
          ok: true,
          latencyMs: Date.now() - started,
          rawReply: reply
        });
      } catch (error) {
        attempts.push({
          provider: `gemini:${env.geminiModel}`,
          ok: false,
          latencyMs: Date.now() - started,
          error: getErrorMessage(error)
        });
        reply = null;
      }
    }

    let usedDeterministicFallback = false;
    if (!reply) {
      reply = buildDeterministicFallback({
        message: body.message,
        advisorPlan
      });
      usedDeterministicFallback = true;
    }

    const runStatus: RecommendationRunStatus = usedDeterministicFallback
      ? RecommendationRunStatus.partial
      : RecommendationRunStatus.succeeded;

    // Fire-and-forget audit log. We do not await this to avoid adding DB
    // latency to the chat response; persistRecommendationRun swallows its
    // own errors so this is safe.
    void persistRecommendationRun({
      status: runStatus,
      message: body.message,
      historyLen: body.history?.length ?? 0,
      narrative: context.narrative,
      factSheet: context.factSheet,
      tokenEstimate: context.tokenEstimate,
      provider,
      reply,
      attempts
    });

    const responseBody: Record<string, unknown> = {
      ...reply,
      provider
    };

    if (debug) {
      responseBody.debug = {
        narrative: context.narrative,
        factSheet: context.factSheet,
        tokenEstimate: context.tokenEstimate,
        attempts,
        usedDeterministicFallback
      };
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error),
        attempts: debug ? attempts : undefined
      },
      {
        status: 400
      }
    );
  }
}

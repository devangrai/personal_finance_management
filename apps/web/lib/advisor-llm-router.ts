import { z } from "zod";
import type { LlmProvider } from "./llm/types";
import type { SpecialistName } from "./advisor-specialists";

/**
 * LLM-based router.
 *
 * Replaces Week 2's regex + overlap-rules in classifyDomains with an LLM
 * that makes both routing decisions in a single fast classification call:
 *   - which specialist(s) should handle this
 *   - which model tier (fast/mid/deep) is appropriate
 *
 * Why one call instead of two: simpler, faster, and the two decisions
 * correlate (a question that needs 3 specialists almost certainly also
 * needs the deep tier for synthesis). Frontier labs (Sierra, Kiro/Bedrock)
 * use this "combined router" pattern for the same reason.
 *
 * Fallback: on provider error or parse failure, fall back to the Week 2
 * regex-based router (kept as a safety net). That fallback also doubles
 * as a "no LLM available" path for tests/simulations.
 */

export type ModelTier = "fast" | "mid" | "deep";

const routerResponseSchema = z.object({
  specialists: z
    .array(
      z.enum([
        "spending-coach",
        "goal-tracker",
        "portfolio-analyst",
        "tax-planner",
        "retirement-pacer",
        "general-advisor"
      ])
    )
    .min(1),
  tier: z.enum(["fast", "mid", "deep"]),
  reasoning: z.string().max(200)
});

export type RouterDecision = z.infer<typeof routerResponseSchema>;

export type RouterOutcome = {
  decision: RouterDecision;
  source: "llm" | "fallback";
  latencyMs: number;
  error?: string;
  rawText?: string;
};

const ROUTER_SYSTEM = `
You are the router for a personal finance advisor. You read the user's message and decide two things:

1. Which specialist(s) should handle it. Valid specialists (pick 1-3):
   - spending-coach: spending patterns, trends, category breakdowns, merchant drill-downs, subscriptions
   - goal-tracker: stating new goals, reviewing progress, updating commitments
   - portfolio-analyst: allocation, concentration risk, holdings, rebalancing questions
   - tax-planner: contribution limits, phase-outs, tax-year mechanics (observational only, not prescriptive)
   - retirement-pacer: retirement pacing, age-based targets, savings-rate progress, catchup contributions
   - general-advisor: fallback when the message doesn't fit a domain cleanly, or asks for holistic synthesis

2. Which model tier to use. Valid tiers:
   - fast:  simple lookup, confirmation, or read-out of precomputed data (no multi-step reasoning)
   - mid:   typical single-domain reasoning, ~2-4 tool calls
   - deep:  cross-domain synthesis, tradeoff reasoning, nuanced priority judgment

Output STRICT JSON only, no code fences, no prose:
{
  "specialists": ["<specialist-name>", ...],
  "tier": "fast" | "mid" | "deep",
  "reasoning": "<one-sentence explanation of why these specialists + this tier>"
}

Rules:
- Prefer fewer specialists. Only add a second or third if the question genuinely spans domains.
- Prefer "fast" when a question is answerable from a single tool call. Default is "mid".
- Use "deep" only when the question requires weighing tradeoffs across domains or multi-step reasoning.
- Don't hedge. Make a clear pick.
`.trim();

const routerJsonSchema = {
  type: "object",
  properties: {
    specialists: {
      type: "array",
      items: {
        type: "string",
        enum: [
          "spending-coach",
          "goal-tracker",
          "portfolio-analyst",
          "tax-planner",
          "retirement-pacer",
          "general-advisor"
        ]
      },
      minItems: 1,
      maxItems: 3
    },
    tier: { type: "string", enum: ["fast", "mid", "deep"] },
    reasoning: { type: "string" }
  },
  required: ["specialists", "tier", "reasoning"],
  additionalProperties: false
};

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export async function routeWithLlm(input: {
  provider: LlmProvider;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  fallback?: () => {
    specialists: SpecialistName[];
    tier: ModelTier;
    reasoning: string;
  };
}): Promise<RouterOutcome> {
  const started = Date.now();

  const historyText =
    input.history && input.history.length > 0
      ? `Recent conversation (last ${input.history.length} turn${input.history.length > 1 ? "s" : ""}):\n${input.history
          .slice(-4)
          .map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`)
          .join("\n")}\n\n`
      : "";

  const response = await input.provider.generate({
    systemPrompt: ROUTER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${historyText}User message to route: "${input.message}"\n\nReturn the router JSON now.`
      }
    ],
    responseSchema: routerJsonSchema,
    temperature: 0.0,
    timeoutMs: 8_000
  });

  const latencyMs = Date.now() - started;

  if (response.finishReason === "error" || response.finishReason === "timeout") {
    const fallbackDecision = input.fallback?.();
    if (fallbackDecision) {
      return {
        decision: {
          specialists: fallbackDecision.specialists as RouterDecision["specialists"],
          tier: fallbackDecision.tier,
          reasoning: `[fallback] ${fallbackDecision.reasoning}`
        },
        source: "fallback",
        latencyMs,
        error: response.error
      };
    }
    return {
      decision: {
        specialists: ["general-advisor"],
        tier: "mid",
        reasoning: "[fallback] router error with no fallback supplied; using general-advisor"
      },
      source: "fallback",
      latencyMs,
      error: response.error
    };
  }

  const rawText = response.text ?? "";
  const parsed = extractJson(rawText);
  const validated = parsed ? routerResponseSchema.safeParse(parsed) : null;

  if (!validated || !validated.success) {
    const fallbackDecision = input.fallback?.();
    if (fallbackDecision) {
      return {
        decision: {
          specialists: fallbackDecision.specialists as RouterDecision["specialists"],
          tier: fallbackDecision.tier,
          reasoning: `[fallback] ${fallbackDecision.reasoning}`
        },
        source: "fallback",
        latencyMs,
        error: "router response did not match schema",
        rawText
      };
    }
    return {
      decision: {
        specialists: ["general-advisor"],
        tier: "mid",
        reasoning: "[fallback] parse error with no fallback; using general-advisor"
      },
      source: "fallback",
      latencyMs,
      error: "router response did not match schema",
      rawText
    };
  }

  return {
    decision: validated.data,
    source: "llm",
    latencyMs,
    rawText
  };
}

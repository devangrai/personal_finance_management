import type { LlmProvider } from "./llm/types";
import type { AgentTraceStep } from "./advisor-agent";

/**
 * Groundedness gate: uses the judge model to verify that dollar amounts
 * and percentages in the final answer are supported by the tool-call
 * trace from this turn.
 *
 * Opt-in via /api/advisor/chat?groundedness=1. Adds one extra LLM call
 * and ~1-2s latency, so default is off.
 *
 * Returns a verdict the caller can decide how to act on (annotate the
 * response, block it, log a warning, etc.). In this initial
 * implementation we just annotate — we don't block bad answers, because
 * false-positive blocking is worse than a rare ungrounded number.
 */

export type GroundednessVerdict = {
  grounded: boolean;
  confidence: number; // 0..100
  issues: string[];
  checkedClaims: number;
};

const GROUNDEDNESS_SCHEMA = {
  type: "object",
  properties: {
    grounded: { type: "boolean" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    issues: { type: "array", items: { type: "string" } },
    checkedClaims: { type: "integer", minimum: 0 }
  },
  required: ["grounded", "confidence", "issues", "checkedClaims"],
  additionalProperties: false
};

const SYSTEM_PROMPT = `
You are a fact-checker for a personal finance advisor agent. The agent produces
a final text answer containing dollar amounts and percentages. Your job: verify
that every specific number mentioned in the answer has support in the tool-call
results captured earlier in the turn.

Rules:
- "Grounded" means: every dollar figure, percentage, limit, or balance in the
  answer appears in a tool result, or is trivially computable (simple addition
  of multiple tool results). Round-trip tolerance ±$5 or ±0.1% is fine.
- Generic statements without numbers ("you're on track", "consider increasing")
  don't need grounding.
- Statements referencing "IRS guidance" or "Fidelity guidance" are fine if
  those tools were called.
- Mark an answer "grounded: false" only if you find at least one *specific
  number* in the answer that has no support.

Output STRICT JSON matching the schema. No prose.
`.trim();

export async function checkGroundedness(input: {
  provider: LlmProvider;
  answer: string;
  trace: AgentTraceStep[];
}): Promise<GroundednessVerdict> {
  // Build a compact trace digest. We only need tool-call results for grounding.
  const toolSummaries: string[] = [];
  for (const step of input.trace) {
    if (step.kind === "tool_result" && step.toolName && step.toolResult) {
      const snippet = JSON.stringify(step.toolResult).slice(0, 400);
      toolSummaries.push(`- ${step.toolName}: ${snippet}`);
    }
  }

  const userMessage = [
    "# Final answer to grade",
    input.answer,
    "",
    "# Tool results from this turn (in order)",
    toolSummaries.length > 0 ? toolSummaries.join("\n") : "(no tool calls in this turn)",
    "",
    "Grade the answer now."
  ].join("\n");

  const response = await input.provider.generate({
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    responseSchema: GROUNDEDNESS_SCHEMA,
    temperature: 0.0,
    timeoutMs: 12_000
  });

  if (!response.text || response.finishReason === "error") {
    return {
      grounded: true, // fail-open: don't block the user on judge flakiness
      confidence: 0,
      issues: [`groundedness check failed: ${response.error ?? "no text"}`],
      checkedClaims: 0
    };
  }

  try {
    const trimmed = response.text.trim();
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last < 0) {
      return {
        grounded: true,
        confidence: 0,
        issues: ["groundedness check returned malformed JSON"],
        checkedClaims: 0
      };
    }
    const parsed = JSON.parse(trimmed.slice(first, last + 1)) as GroundednessVerdict;
    return {
      grounded: parsed.grounded,
      confidence: Number(parsed.confidence) || 0,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      checkedClaims: Number(parsed.checkedClaims) || 0
    };
  } catch (err) {
    return {
      grounded: true,
      confidence: 0,
      issues: [
        `groundedness check parse error: ${err instanceof Error ? err.message : "unknown"}`
      ],
      checkedClaims: 0
    };
  }
}

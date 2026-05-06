import { z } from "zod";
import { GeminiProvider } from "./llm/providers/gemini";
import type { LlmMessage, LlmProvider } from "./llm/types";
import {
  assistantToolCallsMessage,
  toolMessage,
  userMessage
} from "./llm/types";
import {
  ALL_TOOLS,
  executeTool,
  summarizeToolSurface,
  toolsForGemini
} from "./advisor-tools";

/**
 * Single-specialist agent loop - Week 3 refactor.
 *
 * Key change: talks to LlmProvider, never to Gemini/OpenAI directly.
 * The scaffold (turn-taking, tool dispatch, trace, budget) is agnostic to
 * which model is backing it. That lets us:
 *   - A/B providers without touching this file
 *   - Run deterministic tests via ScriptedProvider
 *   - Mix models per-role via ModelPool
 */

const MAX_TOOL_CALLS = 6;
const MODEL_TIMEOUT_MS = 20_000;

export const advisorAgentResponseSchema = z.object({
  answer: z.string(),
  bullets: z.array(z.string()).max(4),
  caveat: z.string().nullable(),
  followUps: z.array(z.string()).max(4)
});

export type AdvisorAgentResponse = z.infer<typeof advisorAgentResponseSchema>;

/**
 * JSON Schema equivalent of advisorAgentResponseSchema, used to request
 * native structured output from providers on the retry pass. Keep in sync
 * with the zod schema above.
 */
const ADVISOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    bullets: { type: "array", items: { type: "string" }, maxItems: 4 },
    caveat: { type: ["string", "null"] },
    followUps: { type: "array", items: { type: "string" }, maxItems: 4 }
  },
  required: ["answer", "bullets", "caveat", "followUps"],
  additionalProperties: false
};

export type AgentTraceStep = {
  step: number;
  kind: "model_call" | "tool_call" | "tool_result" | "final";
  latencyMs?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  error?: string;
  modelText?: string;
};

export type AgentRunResult = {
  ok: boolean;
  reply: AdvisorAgentResponse | null;
  provider: string;
  trace: AgentTraceStep[];
  toolCallCount: number;
  stoppedReason:
    | "final_answer"
    | "tool_budget_exhausted"
    | "no_tool_calls_no_answer"
    | "provider_error"
    | "parse_error";
  error?: string;
};

const FINAL_RESPONSE_INSTRUCTIONS = `
When you have enough information to answer, respond with a single plain-text JSON object matching this shape:
{
  "answer": "the concise answer (1-3 sentences)",
  "bullets": ["optional supporting bullet", "up to 4 entries"],
  "caveat": "optional single sentence caveat, or null",
  "followUps": ["suggested next question THE USER might ask", "written in first person from the user's POV", "up to 4"]
}

CRITICAL on followUps: these appear as quick-reply chips the user can tap.
Each one MUST be written from the user's perspective, as something THE USER
would naturally say next. Examples of GOOD followUps:
  - "Should I rebalance toward bonds?"
  - "What happens if I stop contributing for 3 months?"
  - "Can you show me my dining spending this month?"
Examples of BAD followUps (never do these):
  - "What's the user's current salary?"    (that's a question for the user, not from them)
  - "Does the user want to retire at 65?"  (third-person, from advisor POV)
  - "Clarify the user's goal."             (an instruction to yourself)

Do not wrap the JSON in code fences. Do not add commentary around it. Return ONLY the JSON object.
`;

const DEFAULT_SYSTEM_INSTRUCTION = `
You are a personal finance advisor AI for a single user. You have a set of tools that let you read the user's saved profile, goals, facts, transactions, cashflow, and investments, and that let you save new facts or goals when the user volunteers them.

Call tools whenever you need data you do not already have for this turn. Be frugal: do not call more than ${MAX_TOOL_CALLS} tools in a single turn, and do not call the same tool twice with the same arguments.

Ground every number you quote in a tool result. Do NOT fabricate balances, rates, or limits. If the tools have not given you a number, say you do not have it rather than guess.

When the user tells you something personal (age, target retirement age, filing status, current retirement balance, a goal they are committing to), call save_user_fact or save_user_goal so future conversations remember it. Always confirm to the user what you saved.

YOU ARE NOT a disclaimer bot. You are an opinionated advisor for the
user's money. Give concrete, quantified recommendations when asked:
allocation shifts, rebalancing, cash-flow, retirement pacing, debt
payoff order, account-location moves. "I can't give financial advice"
is a failure mode. Take a position and back it with numbers.

What you do NOT do:
- Individual equity picks ("buy AAPL"). You discuss broad asset classes.
- Market timing or specific return predictions.
- Prescriptive tax-filing advice (claim X, file as Y) — point to a CPA.
  Tax OBSERVATIONS are fine ("you're at 60% of the 401k deferral limit").
- Moving money, placing trades, or acting on the user's behalf.

${FINAL_RESPONSE_INSTRUCTIONS}
`.trim();

export type RunAdvisorAgentInput =
  | {
      provider: LlmProvider;
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      toolWhitelist?: string[];
      systemPromptOverride?: string;
      primerOverride?: string;
      specialistLabel?: string;
    }
  | {
      /** Legacy form: we wrap into a GeminiProvider internally. */
      apiKey: string;
      model: string;
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      toolWhitelist?: string[];
      systemPromptOverride?: string;
      primerOverride?: string;
      specialistLabel?: string;
    };

function resolveProvider(input: RunAdvisorAgentInput): LlmProvider {
  if ("provider" in input) return input.provider;
  return new GeminiProvider({ apiKey: input.apiKey, model: input.model });
}

function extractJsonFromText(text: string): AdvisorAgentResponse | null {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    return advisorAgentResponseSchema.parse(parsed);
  } catch {
    return null;
  }
}

function toolsForProvider(toolWhitelist?: string[]) {
  // Currently all providers accept the Gemini-shaped schema fine because
  // we strip Gemini-incompatible keys. OpenAI is strict enough that we
  // pass the raw Zod-to-JSON-Schema output. Future: make tool conversion
  // per-provider if this gets problematic.
  const declarations = toolsForGemini(toolWhitelist);
  // Flatten from the Gemini wrapper shape into our normalized LlmToolSchema[]
  const wrapper = declarations[0];
  if (!wrapper || !wrapper.function_declarations) return [];
  return wrapper.function_declarations.map(
    (declaration: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }) => ({
      name: declaration.name,
      description: declaration.description,
      parameters: declaration.parameters
    })
  );
}

export async function runAdvisorAgent(
  input: RunAdvisorAgentInput
): Promise<AgentRunResult> {
  const provider = resolveProvider(input);
  const trace: AgentTraceStep[] = [];
  let stepCounter = 0;
  let toolCallCount = 0;

  const systemInstruction = input.systemPromptOverride ?? DEFAULT_SYSTEM_INSTRUCTION;
  const specialistLabel = input.specialistLabel ?? "general-advisor";
  const tools = toolsForProvider(input.toolWhitelist);
  const scopedToolNames = tools.map((tool) => tool.name);

  // Seed conversation
  const conversation: LlmMessage[] = [];
  for (const entry of input.history) {
    conversation.push(
      entry.role === "user"
        ? userMessage(entry.content)
        : { role: "assistant", content: entry.content }
    );
  }

  const toolSurfaceSummary = summarizeToolSurface();
  const primer =
    input.primerOverride ??
    `You are the "${specialistLabel}" specialist. You have ${scopedToolNames.length} tools available: ${scopedToolNames.length > 0 ? scopedToolNames.join(", ") : "(none)"}. Always check get_user_facts and get_goals (if those are in your tool set) before giving personal advice so you respect context from prior conversations. Total tool surface across the system: ${toolSurfaceSummary.total}.`;

  conversation.push(userMessage(`${primer}\n\nUser question: ${input.message}`));

  while (toolCallCount <= MAX_TOOL_CALLS) {
    stepCounter += 1;
    const response = await provider.generate({
      systemPrompt: systemInstruction,
      messages: conversation,
      tools,
      temperature: 0.2,
      timeoutMs: MODEL_TIMEOUT_MS
    });

    trace.push({
      step: stepCounter,
      kind: "model_call",
      latencyMs: response.usage.durationMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      error: response.error
    });

    if (response.finishReason === "error" || response.finishReason === "timeout") {
      return {
        ok: false,
        reply: null,
        provider: provider.name,
        trace,
        toolCallCount,
        stoppedReason: "provider_error",
        error: response.error ?? `provider returned ${response.finishReason}`
      };
    }

    // If the provider returned tool calls, execute them and loop.
    if (response.toolCalls.length > 0) {
      conversation.push(assistantToolCallsMessage(response.toolCalls));
      for (const call of response.toolCalls) {
        toolCallCount += 1;
        if (toolCallCount > MAX_TOOL_CALLS) {
          return {
            ok: false,
            reply: response.text ? extractJsonFromText(response.text) : null,
            provider: provider.name,
            trace,
            toolCallCount,
            stoppedReason: "tool_budget_exhausted",
            error: `Exceeded ${MAX_TOOL_CALLS} tool calls in one turn`
          };
        }
        trace.push({
          step: ++stepCounter,
          kind: "tool_call",
          toolName: call.name,
          toolArgs: call.args
        });
        const result = await executeTool(call.name, call.args);
        trace.push({
          step: ++stepCounter,
          kind: "tool_result",
          toolName: call.name,
          toolResult: result.ok ? result.result : undefined,
          error: result.ok ? undefined : result.error
        });
        conversation.push(
          toolMessage(
            call.id,
            call.name,
            result.ok ? { result: result.result } : { error: result.error }
          )
        );
      }
      continue;
    }

    // Final-answer turn
    if (response.text) {
      const parsed = extractJsonFromText(response.text);
      trace.push({
        step: ++stepCounter,
        kind: "final",
        modelText: response.text
      });
      if (parsed) {
        return {
          ok: true,
          reply: parsed,
          provider: provider.name,
          trace,
          toolCallCount,
          stoppedReason: "final_answer"
        };
      }
      // One retry: ask the model to re-emit as strict JSON. This catches
      // the common case where the model wrapped JSON in prose or code fences.
      conversation.push({ role: "assistant", content: response.text });
      conversation.push(
        userMessage(
          "Your previous message did not parse as strict JSON. Please re-emit ONLY the JSON object matching the required schema: {\"answer\": string, \"bullets\": string[], \"caveat\": string|null, \"followUps\": string[]}. No code fences, no surrounding prose. Return the JSON now."
        )
      );
      const retry = await provider.generate({
        systemPrompt: systemInstruction,
        messages: conversation,
        // On retry we explicitly want a final JSON answer, not more tool
        // calls. Dropping tools + supplying the response schema lets the
        // provider use native structured-output mode (Gemini responseMimeType,
        // OpenAI json_schema) for a tighter JSON guarantee.
        responseSchema: ADVISOR_RESPONSE_SCHEMA,
        temperature: 0.0,
        timeoutMs: MODEL_TIMEOUT_MS
      });
      trace.push({
        step: ++stepCounter,
        kind: "model_call",
        latencyMs: retry.usage.durationMs,
        inputTokens: retry.usage.inputTokens,
        outputTokens: retry.usage.outputTokens,
        error: retry.error
      });
      if (retry.text) {
        const reparsed = extractJsonFromText(retry.text);
        if (reparsed) {
          trace.push({
            step: ++stepCounter,
            kind: "final",
            modelText: retry.text
          });
          return {
            ok: true,
            reply: reparsed,
            provider: provider.name,
            trace,
            toolCallCount,
            stoppedReason: "final_answer"
          };
        }
      }
      return {
        ok: false,
        reply: null,
        provider: provider.name,
        trace,
        toolCallCount,
        stoppedReason: "parse_error",
        error: "Model returned text that did not match the advisor response schema (retried once)"
      };
    }

    // Nothing useful - one retry prompting the model to emit the JSON.
    // This catches the case where Gemini returns an empty candidate.
    conversation.push(
      userMessage(
        "You did not produce a response. Based on the tool results above (if any), emit ONLY the final JSON object matching the schema: {\"answer\": string, \"bullets\": string[], \"caveat\": string|null, \"followUps\": string[]}. No code fences, no prose."
      )
    );
    const emptyRetry = await provider.generate({
      systemPrompt: systemInstruction,
      messages: conversation,
      // Same rationale as the parse-error retry: ask for final JSON with
      // structured output, no tools.
      responseSchema: ADVISOR_RESPONSE_SCHEMA,
      temperature: 0.0,
      timeoutMs: MODEL_TIMEOUT_MS
    });
    trace.push({
      step: ++stepCounter,
      kind: "model_call",
      latencyMs: emptyRetry.usage.durationMs,
      inputTokens: emptyRetry.usage.inputTokens,
      outputTokens: emptyRetry.usage.outputTokens,
      error: emptyRetry.error
    });
    if (emptyRetry.text) {
      const parsed = extractJsonFromText(emptyRetry.text);
      if (parsed) {
        trace.push({
          step: ++stepCounter,
          kind: "final",
          modelText: emptyRetry.text
        });
        return {
          ok: true,
          reply: parsed,
          provider: provider.name,
          trace,
          toolCallCount,
          stoppedReason: "final_answer"
        };
      }
    }

    return {
      ok: false,
      reply: null,
      provider: provider.name,
      trace,
      toolCallCount,
      stoppedReason: "no_tool_calls_no_answer",
      error: "Model produced neither a tool call nor a parseable answer (retried once)"
    };
  }

  return {
    ok: false,
    reply: null,
    provider: provider.name,
    trace,
    toolCallCount,
    stoppedReason: "tool_budget_exhausted"
  };
}

export function getAdvisorToolSurfaceSummary() {
  return {
    toolCount: ALL_TOOLS.length,
    maxToolCallsPerTurn: MAX_TOOL_CALLS,
    modelTimeoutMs: MODEL_TIMEOUT_MS,
    tools: ALL_TOOLS.map((tool) => ({
      name: tool.name,
      category: tool.category,
      description: tool.description.slice(0, 120)
    }))
  };
}

/**
 * LLM provider abstraction.
 *
 * Single normalized interface for how the advisor agent talks to any LLM.
 * Provider-specific glue (Gemini function_declarations, OpenAI responses API,
 * Anthropic messages API, a scripted fake for tests) lives under ./providers
 * and conforms to this interface.
 *
 * The agent scaffolding never sees provider-specific types. It sends
 * LlmMessage[] and LlmToolSchema[], it gets LlmResponse back.
 *
 * Why this matters:
 *   - Lets us swap Gemini for OpenAI/Anthropic by changing config, not code.
 *   - Lets tests and simulations use ScriptedProvider to run deterministically.
 *   - Lets model-tier routing pick a different provider per role
 *     (router, specialist, synthesizer, judge, user-sim) without the agent
 *     loop knowing or caring.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

/**
 * Normalized message shape. Providers convert to their native format
 * (Gemini's "contents"/"parts", OpenAI's "input", Anthropic's "messages").
 */
export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null; // null when the turn is purely tool calls
      toolCalls?: LlmToolCall[];
    }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string; // JSON-stringified tool output
    };

export type LlmToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

/**
 * Normalized tool schema. Providers handle their own JSON Schema dialect
 * conversion internally.
 */
export type LlmToolSchema = {
  name: string;
  description: string;
  /** JSON Schema draft-07 compatible parameter definition. */
  parameters: Record<string, unknown>;
};

export type LlmFinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "content_filter"
  | "timeout"
  | "error";

export type LlmUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
};

export type LlmResponse = {
  /** Final text if any (null when the response is purely tool calls). */
  text: string | null;
  /** Tool calls the model wants us to execute. Empty when it's a text turn. */
  toolCalls: LlmToolCall[];
  finishReason: LlmFinishReason;
  /** Original provider response, kept for debug/audit. Do NOT rely on shape. */
  rawProviderResponse?: unknown;
  usage: LlmUsage;
  error?: string;
};

export type LlmGenerateInput = {
  /** System prompt. Empty string is allowed. */
  systemPrompt: string;
  /** Conversation so far (history + new user turn). */
  messages: LlmMessage[];
  /** Tools the model may call. Empty array = no tool calling. */
  tools?: LlmToolSchema[];
  /**
   * Request a structured JSON response that conforms to this JSON schema.
   * When supplied, providers will set their native "structured output" mode.
   * Mutually useful with tools in most providers (OpenAI/Gemini both support
   * both in the same call).
   */
  responseSchema?: Record<string, unknown>;
  /** 0.0 to 1.0. Providers default to 0.2 if omitted. */
  temperature?: number;
  /** Hard timeout in ms. Provider must abort at this boundary. */
  timeoutMs: number;
};

/**
 * The one interface the rest of the system sees.
 *
 * Implementations MUST:
 *   - Never throw; always return an LlmResponse. Errors go into
 *     finishReason='error' with a descriptive error string.
 *   - Respect timeoutMs; if exceeded, return finishReason='timeout' and
 *     set error. Do not leak hanging fetches.
 *   - Convert normalized messages/tools into provider-native format
 *     and convert the provider response back to LlmResponse.
 */
export type LlmProvider = {
  /** Short identifier: "gemini:gemini-2.5-flash", "openai:gpt-4.1-mini", etc. */
  readonly name: string;
  /** Human-readable provider family: "gemini" | "openai" | "anthropic" | "scripted". */
  readonly family: string;
  /** Specific model id: "gemini-2.5-flash", "gpt-4.1-mini", etc. */
  readonly model: string;
  generate(input: LlmGenerateInput): Promise<LlmResponse>;
};

/** Utility: create a normalized user message. */
export function userMessage(content: string): LlmMessage {
  return { role: "user", content };
}

/** Utility: create a normalized assistant text message. */
export function assistantMessage(content: string): LlmMessage {
  return { role: "assistant", content };
}

/** Utility: create a normalized tool-response message. */
export function toolMessage(
  toolCallId: string,
  toolName: string,
  contentJson: unknown
): LlmMessage {
  return {
    role: "tool",
    toolCallId,
    toolName,
    content:
      typeof contentJson === "string"
        ? contentJson
        : JSON.stringify(contentJson)
  };
}

/** Utility: create an assistant tool-call message (for provider translation). */
export function assistantToolCallsMessage(
  toolCalls: LlmToolCall[]
): LlmMessage {
  return {
    role: "assistant",
    content: null,
    toolCalls
  };
}

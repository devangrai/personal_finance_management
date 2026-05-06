import OpenAI from "openai";
import type {
  LlmGenerateInput,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmToolCall
} from "../types";

/**
 * OpenAI provider (via the official SDK, Responses API).
 *
 * Converts normalized LlmMessage[]/LlmToolSchema[] into OpenAI's Responses API
 * input format, calls client.responses.create(...) with tools and optional
 * structured output, and converts back to LlmResponse.
 *
 * Note: we use the Responses API (not Chat Completions) because it cleanly
 * supports both structured output and tool calling in a single call, which
 * is what the agent loop needs.
 *
 * Quota handling: if the key is rejected with 401/403 or quota-exhausted,
 * we return finishReason='error' with a clear message. The model-pool layer
 * should detect this and fall back to Gemini (mirrors what the advisor chat
 * route already does for non-agent mode).
 */

type OpenAIResponsesInput = Array<
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    }
>;

type OpenAIResponsesOutput = Array<{
  type: string;
  content?: Array<{ type: string; text?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
}>;

function messagesToOpenAiInput(messages: LlmMessage[]): OpenAIResponsesInput {
  const result: OpenAIResponsesInput = [];
  const toolCallNameById = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "system" || message.role === "user") {
      result.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) {
        result.push({ role: "assistant", content: message.content });
      }
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          toolCallNameById.set(call.id, call.name);
          result.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.args ?? {})
          });
        }
      }
      continue;
    }
    if (message.role === "tool") {
      result.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content
      });
      continue;
    }
  }

  return result;
}

function extractFromOutput(output: OpenAIResponsesOutput): {
  text: string | null;
  toolCalls: LlmToolCall[];
} {
  let text: string | null = null;
  const toolCalls: LlmToolCall[] = [];

  for (const item of output) {
    if (item.type === "message" && item.content) {
      const collected: string[] = [];
      for (const part of item.content) {
        if (part.type === "output_text" && part.text) collected.push(part.text);
      }
      const joined = collected.join("\n").trim();
      if (joined.length > 0) text = joined;
    }
    if (item.type === "function_call" && item.call_id && item.name) {
      let parsedArgs: Record<string, unknown> = {};
      if (item.arguments) {
        try {
          parsedArgs = JSON.parse(item.arguments);
        } catch {
          parsedArgs = {};
        }
      }
      toolCalls.push({
        id: item.call_id,
        name: item.name,
        args: parsedArgs
      });
    }
  }

  return { text, toolCalls };
}

export class OpenAIProvider implements LlmProvider {
  readonly name: string;
  readonly family = "openai";
  readonly model: string;
  private client: OpenAI;

  constructor(input: { apiKey: string; model: string }) {
    this.model = input.model;
    this.name = `openai:${input.model}`;
    this.client = new OpenAI({ apiKey: input.apiKey });
  }

  async generate(input: LlmGenerateInput): Promise<LlmResponse> {
    const started = Date.now();
    const openAiInput = messagesToOpenAiInput(input.messages);
    const systemFromMessages = input.messages
      .filter((message) => message.role === "system")
      .map((message) => (message as { content: string }).content)
      .join("\n\n");
    const combinedSystem = [input.systemPrompt, systemFromMessages]
      .filter((value) => value && value.length > 0)
      .join("\n\n");

    const inputWithSystem: OpenAIResponsesInput = combinedSystem
      ? [{ role: "system", content: combinedSystem }, ...openAiInput.filter((item) => !("role" in item) || item.role !== "system")]
      : openAiInput;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: any = {
      model: this.model,
      input: inputWithSystem,
      temperature: input.temperature ?? 0.2
    };
    if (input.tools && input.tools.length > 0) {
      requestBody.tools = input.tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false
      }));
    }
    if (input.responseSchema) {
      requestBody.text = {
        format: {
          type: "json_schema",
          name: "advisor_response",
          strict: false,
          schema: input.responseSchema
        }
      };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await Promise.race<any>([
        this.client.responses.create(requestBody),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("OpenAI request timed out")),
            input.timeoutMs
          )
        )
      ]);

      const durationMs = Date.now() - started;
      const output = (raw?.output ?? []) as OpenAIResponsesOutput;
      const { text, toolCalls } = extractFromOutput(output);

      const usage = raw?.usage ?? {};
      const finishReason: LlmResponse["finishReason"] =
        toolCalls.length > 0 ? "tool_calls" : "stop";

      return {
        text,
        toolCalls,
        finishReason,
        usage: {
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          durationMs
        },
        rawProviderResponse: raw
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lower = message.toLowerCase();
      const isTimeout = lower.includes("timed out") || lower.includes("abort");
      const isQuota =
        lower.includes("quota") ||
        lower.includes("billing") ||
        lower.includes("insufficient") ||
        lower.includes("429");
      const isAuth =
        lower.includes("401") ||
        lower.includes("403") ||
        lower.includes("api key") ||
        lower.includes("authentication");

      return {
        text: null,
        toolCalls: [],
        finishReason: isTimeout ? "timeout" : "error",
        usage: {
          inputTokens: null,
          outputTokens: null,
          durationMs: Date.now() - started
        },
        error: isQuota
          ? `OpenAI quota/billing error: ${message}`
          : isAuth
            ? `OpenAI auth error: ${message}`
            : message
      };
    }
  }
}

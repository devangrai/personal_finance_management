import type {
  LlmGenerateInput,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmToolCall
} from "../types";

/**
 * Gemini provider (generativelanguage.googleapis.com v1beta).
 *
 * Converts normalized LlmMessage[]/LlmToolSchema[] into Gemini's
 * contents/parts/function_declarations shape, and converts the response
 * back into LlmResponse.
 *
 * Notes:
 *   - Gemini rejects `additionalProperties` on tool parameter schemas;
 *     we strip it out during conversion.
 *   - Gemini's "contents" array uses {role, parts}. System prompt goes
 *     in a top-level system_instruction, not the contents array.
 *   - The "tool" role is represented as a user turn with functionResponse parts.
 */

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | {
      functionResponse: { name: string; response: Record<string, unknown> };
    };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

type GeminiApiResponse = {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: { code?: number; message?: string; status?: string };
};

function stripAdditionalProperties(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "strict") continue;
    if (key === "properties" && value && typeof value === "object") {
      const cleanedProps: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(
        value as Record<string, unknown>
      )) {
        cleanedProps[propKey] = stripAdditionalProperties(
          (propValue ?? {}) as Record<string, unknown>
        );
      }
      cleaned[key] = cleanedProps;
      continue;
    }
    if (key === "anyOf" && Array.isArray(value)) {
      cleaned[key] = value.map((entry) =>
        stripAdditionalProperties((entry ?? {}) as Record<string, unknown>)
      );
      continue;
    }
    if (key === "items" && value && typeof value === "object") {
      cleaned[key] = stripAdditionalProperties(
        value as Record<string, unknown>
      );
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

function messagesToGeminiContents(messages: LlmMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") continue; // system goes in system_instruction
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.content }] });
      continue;
    }
    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (message.content) {
        parts.push({ text: message.content });
      }
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          parts.push({
            functionCall: { name: call.name, args: call.args }
          });
        }
      }
      contents.push({ role: "model", parts });
      continue;
    }
    if (message.role === "tool") {
      // Gemini represents tool responses as a user turn with a functionResponse part.
      let parsedResponse: Record<string, unknown>;
      try {
        const raw = JSON.parse(message.content);
        parsedResponse =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : { result: raw };
      } catch {
        parsedResponse = { result: message.content };
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolName,
              response: parsedResponse
            }
          }
        ]
      });
      continue;
    }
  }
  return contents;
}

function extractText(parts: GeminiPart[] | undefined): string | null {
  if (!parts) return null;
  const collected: string[] = [];
  for (const part of parts) {
    if ("text" in part && typeof part.text === "string") {
      collected.push(part.text);
    }
  }
  if (collected.length === 0) return null;
  const joined = collected.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

function extractToolCalls(parts: GeminiPart[] | undefined): LlmToolCall[] {
  if (!parts) return [];
  const calls: LlmToolCall[] = [];
  let counter = 0;
  for (const part of parts) {
    if ("functionCall" in part && part.functionCall) {
      counter += 1;
      calls.push({
        id: `gemini-${Date.now()}-${counter}`,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {}
      });
    }
  }
  return calls;
}

export class GeminiProvider implements LlmProvider {
  readonly name: string;
  readonly family = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(input: { apiKey: string; model: string }) {
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.name = `gemini:${input.model}`;
  }

  async generate(input: LlmGenerateInput): Promise<LlmResponse> {
    const started = Date.now();
    const contents = messagesToGeminiContents(input.messages);
    const systemPrompt = input.messages
      .filter((message) => message.role === "system")
      .map((message) => (message as { content: string }).content)
      .join("\n\n");
    const mergedSystem = [input.systemPrompt, systemPrompt]
      .filter((value) => value && value.length > 0)
      .join("\n\n");

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: input.temperature ?? 0.2
      }
    };
    if (mergedSystem.length > 0) {
      body.system_instruction = { parts: [{ text: mergedSystem }] };
    }
    if (input.tools && input.tools.length > 0) {
      body.tools = [
        {
          function_declarations: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: stripAdditionalProperties(tool.parameters)
          }))
        }
      ];
    }
    if (input.responseSchema) {
      (body.generationConfig as Record<string, unknown>).responseMimeType =
        "application/json";
      (body.generationConfig as Record<string, unknown>).responseJsonSchema =
        stripAdditionalProperties(input.responseSchema);
    }

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          this.model
        )}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          signal: AbortSignal.timeout(input.timeoutMs),
          body: JSON.stringify(body)
        }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Gemini fetch failed";
      const isTimeout = message.toLowerCase().includes("abort") ||
        message.toLowerCase().includes("timeout");
      return {
        text: null,
        toolCalls: [],
        finishReason: isTimeout ? "timeout" : "error",
        usage: {
          inputTokens: null,
          outputTokens: null,
          durationMs: Date.now() - started
        },
        error: message
      };
    }

    const payload = (await response.json()) as GeminiApiResponse;
    const durationMs = Date.now() - started;

    if (!response.ok || payload.error) {
      return {
        text: null,
        toolCalls: [],
        finishReason: "error",
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount ?? null,
          outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null,
          durationMs
        },
        error:
          payload.error?.message ??
          `Gemini returned status ${response.status}`,
        rawProviderResponse: payload
      };
    }

    const candidate = payload.candidates?.[0];
    if (!candidate?.content) {
      return {
        text: null,
        toolCalls: [],
        finishReason: "error",
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount ?? null,
          outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null,
          durationMs
        },
        error: "Gemini returned no content",
        rawProviderResponse: payload
      };
    }

    const toolCalls = extractToolCalls(candidate.content.parts);
    const text = extractText(candidate.content.parts);
    const finishReason: LlmResponse["finishReason"] =
      toolCalls.length > 0
        ? "tool_calls"
        : candidate.finishReason === "MAX_TOKENS"
          ? "length"
          : "stop";

    return {
      text,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? null,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null,
        durationMs
      },
      rawProviderResponse: payload
    };
  }
}

import type {
  LlmGenerateInput,
  LlmProvider,
  LlmResponse,
  LlmToolCall
} from "../types";

/**
 * Scripted provider for deterministic tests and simulations.
 *
 * You give it a sequence of pre-baked responses. On each call to generate(),
 * it returns the next one. If it runs out, it returns an error response.
 *
 * Three ways to use it:
 *
 * 1) Fixed-response list:
 *    new ScriptedProvider({
 *      responses: [
 *        { toolCalls: [{ name: "get_profile", args: {} }] },
 *        { text: '{"answer":"...","bullets":[]}' }
 *      ]
 *    })
 *
 * 2) Function-based (pick response based on input):
 *    new ScriptedProvider({
 *      handler: (input) => {
 *        if (input.tools?.some(t => t.name === "save_user_fact")) {
 *          return { text: '{"answer":"saved"}' };
 *        }
 *        return { text: '{"answer":"default"}' };
 *      }
 *    })
 *
 * 3) Replay mode (playback recorded responses from a prior live run):
 *    new ScriptedProvider({ responses: recorded })
 *
 * The provider normalizes each response entry into a full LlmResponse so
 * callers never need to fill in defaults.
 */

export type ScriptedResponseSpec = {
  /** Optional: the final text the model produces. */
  text?: string | null;
  /** Optional: tool calls to produce (as if the model asked to call them). */
  toolCalls?: Array<{ name: string; args?: Record<string, unknown>; id?: string }>;
  /** Optional: override the normalized finishReason. */
  finishReason?: LlmResponse["finishReason"];
  /** Optional: simulated latency in ms. */
  durationMs?: number;
  /** Optional: input/output token counts. */
  inputTokens?: number;
  outputTokens?: number;
  /** Optional: error string (forces finishReason='error'). */
  error?: string;
};

export type ScriptedHandler = (
  input: LlmGenerateInput
) => ScriptedResponseSpec | Promise<ScriptedResponseSpec>;

export type ScriptedProviderConfig = {
  name?: string;
  model?: string;
  /** Fixed sequence of responses to return in order. */
  responses?: ScriptedResponseSpec[];
  /** OR a handler function. One of responses/handler must be set. */
  handler?: ScriptedHandler;
  /**
   * What to do when fixed responses are exhausted:
   *   - "error" (default): return finishReason='error'
   *   - "repeat-last": keep returning the last response
   *   - "default-answer": return a benign "{}" text response
   */
  onExhausted?: "error" | "repeat-last" | "default-answer";
};

export class ScriptedProvider implements LlmProvider {
  readonly name: string;
  readonly family = "scripted";
  readonly model: string;
  private responses: ScriptedResponseSpec[];
  private handler: ScriptedHandler | null;
  private cursor = 0;
  private onExhausted: NonNullable<ScriptedProviderConfig["onExhausted"]>;
  public callCount = 0;
  public lastInput: LlmGenerateInput | null = null;

  constructor(config: ScriptedProviderConfig) {
    if (!config.responses && !config.handler) {
      throw new Error(
        "ScriptedProvider requires either `responses` or `handler`"
      );
    }
    this.responses = config.responses ?? [];
    this.handler = config.handler ?? null;
    this.model = config.model ?? "scripted";
    // Default to a unique name per instance so that downstream consumers
    // (e.g. FailoverProvider health tracking) don't accidentally collide
    // health across separate scripted instances.
    this.name =
      config.name ??
      `scripted:${this.model}:${Math.random().toString(36).slice(2, 7)}`;
    this.onExhausted = config.onExhausted ?? "error";
  }

  async generate(input: LlmGenerateInput): Promise<LlmResponse> {
    this.callCount += 1;
    this.lastInput = input;

    let spec: ScriptedResponseSpec;
    if (this.handler) {
      spec = await this.handler(input);
    } else if (this.cursor < this.responses.length) {
      spec = this.responses[this.cursor];
      this.cursor += 1;
    } else {
      switch (this.onExhausted) {
        case "repeat-last":
          spec = this.responses[this.responses.length - 1] ?? {
            error: "scripted provider exhausted with no responses defined"
          };
          break;
        case "default-answer":
          spec = { text: '{"answer":"(scripted-default)","bullets":[],"caveat":null,"followUps":[]}' };
          break;
        case "error":
        default:
          spec = {
            error: `ScriptedProvider exhausted after ${this.responses.length} responses`
          };
          break;
      }
    }

    return specToResponse(spec);
  }

  /** Reset the cursor for re-running a fixed-response sequence. */
  reset(): void {
    this.cursor = 0;
    this.callCount = 0;
    this.lastInput = null;
  }

  /** Where in the scripted sequence we are. */
  get position(): number {
    return this.cursor;
  }
}

function specToResponse(spec: ScriptedResponseSpec): LlmResponse {
  const toolCalls: LlmToolCall[] = (spec.toolCalls ?? []).map((call, index) => ({
    id: call.id ?? `scripted-${Date.now()}-${index}`,
    name: call.name,
    args: call.args ?? {}
  }));

  let finishReason: LlmResponse["finishReason"];
  if (spec.finishReason) {
    finishReason = spec.finishReason;
  } else if (spec.error) {
    finishReason = "error";
  } else if (toolCalls.length > 0) {
    finishReason = "tool_calls";
  } else {
    finishReason = "stop";
  }

  return {
    text: spec.error ? null : (spec.text ?? null),
    toolCalls,
    finishReason,
    usage: {
      inputTokens: spec.inputTokens ?? null,
      outputTokens: spec.outputTokens ?? null,
      durationMs: spec.durationMs ?? 0
    },
    error: spec.error
  };
}

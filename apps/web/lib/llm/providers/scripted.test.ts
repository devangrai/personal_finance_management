import { describe, it, expect } from "vitest";
import { ScriptedProvider } from "./scripted";
import type { LlmGenerateInput } from "../types";

/**
 * Provider conformance tests.
 *
 * These assert the LlmProvider contract for each concrete provider using
 * the simplest one we have (ScriptedProvider) as the reference. The goal:
 * catch regressions in the contract (never throws, shape of LlmResponse,
 * finishReason values, usage object) cheaply in CI.
 *
 * Live providers (Gemini, OpenAI) are not exercised here — they'd require
 * network + keys. We have a separate integration test (see live.test.ts)
 * gated behind env vars for when you want to run them.
 */

function defaultInput(): LlmGenerateInput {
  return {
    systemPrompt: "you are helpful",
    messages: [{ role: "user", content: "hello" }],
    timeoutMs: 5_000
  };
}

describe("ScriptedProvider conformance", () => {
  it("returns text responses verbatim", async () => {
    const provider = new ScriptedProvider({
      responses: [{ text: "hi there" }]
    });
    const response = await provider.generate(defaultInput());
    expect(response.text).toBe("hi there");
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe("stop");
    expect(response.error).toBeUndefined();
    expect(response.usage.durationMs).toBe(0);
  });

  it("returns tool calls with normalized ids", async () => {
    const provider = new ScriptedProvider({
      responses: [
        { toolCalls: [{ name: "get_profile", args: {} }] },
        { text: "done" }
      ]
    });
    const first = await provider.generate(defaultInput());
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0].name).toBe("get_profile");
    expect(first.toolCalls[0].id).toMatch(/^scripted-/);
    expect(first.finishReason).toBe("tool_calls");
    expect(first.text).toBeNull();

    const second = await provider.generate(defaultInput());
    expect(second.text).toBe("done");
    expect(second.finishReason).toBe("stop");
  });

  it("never throws — errors surface via finishReason=error", async () => {
    const provider = new ScriptedProvider({
      responses: [{ error: "upstream exploded" }]
    });
    const response = await provider.generate(defaultInput());
    expect(response.finishReason).toBe("error");
    expect(response.error).toBe("upstream exploded");
    expect(response.text).toBeNull();
    expect(response.toolCalls).toEqual([]);
  });

  it("returns error when exhausted with default onExhausted", async () => {
    const provider = new ScriptedProvider({
      responses: [{ text: "only one" }]
    });
    await provider.generate(defaultInput());
    const exhausted = await provider.generate(defaultInput());
    expect(exhausted.finishReason).toBe("error");
    expect(exhausted.error).toMatch(/exhausted/i);
  });

  it("repeats last response when onExhausted=repeat-last", async () => {
    const provider = new ScriptedProvider({
      responses: [{ text: "same answer" }],
      onExhausted: "repeat-last"
    });
    const first = await provider.generate(defaultInput());
    const second = await provider.generate(defaultInput());
    expect(first.text).toBe("same answer");
    expect(second.text).toBe("same answer");
    expect(second.finishReason).toBe("stop");
  });

  it("handler-based provider sees input and can branch", async () => {
    const provider = new ScriptedProvider({
      handler: (input) => {
        const lastMessage = input.messages[input.messages.length - 1];
        if (lastMessage.role === "user" && typeof lastMessage.content === "string" && lastMessage.content.includes("save")) {
          return { toolCalls: [{ name: "save_user_fact", args: { factKey: "age" } }] };
        }
        return { text: "noop" };
      }
    });
    const saveResponse = await provider.generate({
      systemPrompt: "",
      messages: [{ role: "user", content: "please save this" }],
      timeoutMs: 5_000
    });
    expect(saveResponse.toolCalls[0].name).toBe("save_user_fact");

    const textResponse = await provider.generate({
      systemPrompt: "",
      messages: [{ role: "user", content: "just say hi" }],
      timeoutMs: 5_000
    });
    expect(textResponse.text).toBe("noop");
  });

  it("reset() clears the cursor", async () => {
    const provider = new ScriptedProvider({
      responses: [{ text: "a" }, { text: "b" }]
    });
    await provider.generate(defaultInput());
    await provider.generate(defaultInput());
    provider.reset();
    const third = await provider.generate(defaultInput());
    expect(third.text).toBe("a");
  });

  it("exposes name, family, model, and callCount", async () => {
    const provider = new ScriptedProvider({
      name: "test:scripted",
      model: "scripted-1",
      responses: [{ text: "ok" }]
    });
    expect(provider.name).toBe("test:scripted");
    expect(provider.family).toBe("scripted");
    expect(provider.model).toBe("scripted-1");
    expect(provider.callCount).toBe(0);
    await provider.generate(defaultInput());
    expect(provider.callCount).toBe(1);

    // Default-name case: should include model plus a unique suffix.
    const anon = new ScriptedProvider({ responses: [{ text: "x" }] });
    expect(anon.name).toMatch(/^scripted:scripted:/);
  });
});

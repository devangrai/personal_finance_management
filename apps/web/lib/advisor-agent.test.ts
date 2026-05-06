import { describe, it, expect } from "vitest";
import { runAdvisorAgent } from "./advisor-agent";
import { ScriptedProvider } from "./llm/providers/scripted";

/**
 * End-to-end agent-loop tests using ScriptedProvider.
 *
 * These assert that the scaffold (turn-taking, tool dispatch, trace,
 * retry logic, budget enforcement) behaves correctly regardless of which
 * LLM backs it. Because the provider is scripted, these run in <100ms
 * total and are fully deterministic.
 *
 * Note: these tests call executeTool() for real (it's deterministic when
 * the DB is empty — most read tools return empty data shapes — and we
 * only exercise reads here).
 */

describe("runAdvisorAgent — scaffold behavior", () => {
  it("returns parsed reply when provider emits valid JSON final answer", async () => {
    const provider = new ScriptedProvider({
      responses: [
        {
          text: JSON.stringify({
            answer: "hello",
            bullets: [],
            caveat: null,
            followUps: []
          })
        }
      ]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(true);
    expect(result.reply?.answer).toBe("hello");
    expect(result.stoppedReason).toBe("final_answer");
    expect(result.toolCallCount).toBe(0);
  });

  it("executes tool calls then expects final answer", async () => {
    const provider = new ScriptedProvider({
      responses: [
        {
          toolCalls: [{ name: "get_user_facts", args: {} }]
        },
        {
          text: JSON.stringify({
            answer: "after tool",
            bullets: ["ran a tool"],
            caveat: null,
            followUps: []
          })
        }
      ]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(true);
    expect(result.toolCallCount).toBe(1);
    expect(result.trace.filter((s) => s.kind === "tool_call")).toHaveLength(1);
    expect(result.trace.filter((s) => s.kind === "tool_result")).toHaveLength(1);
  });

  it("retries once on parse_error with the JSON-correction prompt", async () => {
    const provider = new ScriptedProvider({
      responses: [
        { text: "nope, just prose without any JSON" },
        {
          text: JSON.stringify({
            answer: "recovered",
            bullets: [],
            caveat: null,
            followUps: []
          })
        }
      ]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(true);
    expect(result.reply?.answer).toBe("recovered");
  });

  it("returns parse_error after two bad responses in a row", async () => {
    const provider = new ScriptedProvider({
      responses: [
        { text: "no json here" },
        { text: "still no json" }
      ]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(false);
    expect(result.stoppedReason).toBe("parse_error");
  });

  it("retries on empty response then recovers", async () => {
    const provider = new ScriptedProvider({
      responses: [
        { text: null }, // empty — no text, no tool calls
        {
          text: JSON.stringify({
            answer: "got it",
            bullets: [],
            caveat: null,
            followUps: []
          })
        }
      ]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(true);
    expect(result.reply?.answer).toBe("got it");
  });

  it("surfaces provider errors cleanly", async () => {
    const provider = new ScriptedProvider({
      responses: [{ error: "upstream 500" }]
    });

    const result = await runAdvisorAgent({
      provider,
      message: "test",
      history: []
    });

    expect(result.ok).toBe(false);
    expect(result.stoppedReason).toBe("provider_error");
    expect(result.error).toMatch(/upstream 500/);
  });

  it("respects tool whitelist — only whitelisted tools appear to the model", async () => {
    const seen: string[] = [];
    const provider = new ScriptedProvider({
      handler: (input) => {
        if (input.tools) {
          for (const tool of input.tools) seen.push(tool.name);
        }
        return {
          text: JSON.stringify({
            answer: "done",
            bullets: [],
            caveat: null,
            followUps: []
          })
        };
      }
    });

    await runAdvisorAgent({
      provider,
      message: "test",
      history: [],
      toolWhitelist: ["get_user_facts", "get_goals"]
    });

    // Each tool should appear in the seen list.
    expect(seen).toContain("get_user_facts");
    expect(seen).toContain("get_goals");
    // Other tools should not be in the whitelist.
    expect(seen).not.toContain("save_user_fact");
    expect(seen).not.toContain("analyze_allocation");
  });
});

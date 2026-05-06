import { describe, it, expect, beforeEach } from "vitest";
import { FailoverProvider } from "./failover";
import { ScriptedProvider } from "./scripted";
import type { LlmGenerateInput } from "../types";

function input(): LlmGenerateInput {
  return {
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }],
    timeoutMs: 5_000
  };
}

describe("FailoverProvider", () => {
  it("uses the primary when it succeeds", async () => {
    const primary = new ScriptedProvider({
      responses: [{ text: "primary says hi" }],
      onExhausted: "repeat-last"
    });
    const backup = new ScriptedProvider({
      responses: [{ text: "backup says hi" }],
      onExhausted: "repeat-last"
    });
    const failover = new FailoverProvider({ primary, backups: [backup] });

    const response = await failover.generate(input());
    expect(response.text).toBe("primary says hi");
    expect(primary.callCount).toBe(1);
    expect(backup.callCount).toBe(0);
  });

  it("falls over to backup when primary returns error", async () => {
    const primary = new ScriptedProvider({
      responses: [{ error: "primary boom" }],
      onExhausted: "repeat-last"
    });
    const backup = new ScriptedProvider({
      responses: [{ text: "backup to the rescue" }],
      onExhausted: "repeat-last"
    });
    const failover = new FailoverProvider({ primary, backups: [backup] });

    const response = await failover.generate(input());
    expect(response.text).toBe("backup to the rescue");
    expect(response.finishReason).toBe("stop");
  });

  it("does NOT fall over when primary returns empty (agent loop handles retry)", async () => {
    const primary = new ScriptedProvider({
      responses: [{ text: null }],
      onExhausted: "repeat-last"
    });
    const backup = new ScriptedProvider({
      responses: [{ text: "backup would have stepped in" }],
      onExhausted: "repeat-last"
    });
    const failover = new FailoverProvider({ primary, backups: [backup] });

    const response = await failover.generate(input());
    // Empty response from primary passes through unchanged; the agent layer
    // has its own retry that handles this better than provider switching.
    expect(response.text).toBeNull();
    expect(response.finishReason).toBe("stop");
    expect(primary.callCount).toBe(1);
    expect(backup.callCount).toBe(0);
  });

  it("marks primary degraded after repeated failures and skips it", async () => {
    const primary = new ScriptedProvider({
      name: "test:primary",
      handler: async () => ({ error: "always broken" })
    });
    const backup = new ScriptedProvider({
      name: "test:backup",
      handler: async () => ({ text: "backup stays healthy" })
    });
    const failover = new FailoverProvider({
      primary,
      backups: [backup],
      recentFailureThreshold: 2
    });

    await failover.generate(input()); // primary fails, backup used
    await failover.generate(input()); // primary fails again — now degraded
    await failover.generate(input()); // primary should be skipped

    expect(primary.callCount).toBe(2);
    expect(backup.callCount).toBe(3);
    const health = failover.describe();
    expect(health.providers[0].degraded).toBe(true);
  });

  it("returns error summary when all providers fail", async () => {
    const primary = new ScriptedProvider({
      handler: async () => ({ error: "primary broken" })
    });
    const backup = new ScriptedProvider({
      handler: async () => ({ error: "backup also broken" })
    });
    const failover = new FailoverProvider({ primary, backups: [backup] });

    const response = await failover.generate(input());
    expect(response.finishReason).toBe("error");
    expect(response.error).toMatch(/primary broken/);
    expect(response.error).toMatch(/backup also broken/);
  });

  it("handles single-provider case (no backups)", async () => {
    const primary = new ScriptedProvider({
      responses: [{ text: "solo" }]
    });
    const failover = new FailoverProvider({ primary });
    const response = await failover.generate(input());
    expect(response.text).toBe("solo");
  });

  it("immediately marks provider degraded on quota/auth errors", async () => {
    const primary = new ScriptedProvider({
      name: "test:chronically-broken",
      handler: async () => ({
        error: "OpenAI quota/billing error: 429 insufficient_quota"
      })
    });
    const backup = new ScriptedProvider({
      name: "test:healthy-backup",
      handler: async () => ({ text: "backup works" })
    });
    const failover = new FailoverProvider({ primary, backups: [backup] });

    await failover.generate(input()); // primary fails with quota error
    const health = failover.describe();
    // Primary should be flagged degraded immediately (not after N attempts).
    expect(health.providers[0].degraded).toBe(true);

    await failover.generate(input()); // primary should be skipped this time
    expect(primary.callCount).toBe(1);
    expect(backup.callCount).toBe(2);
  });
});

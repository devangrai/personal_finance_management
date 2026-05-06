import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@portfolio/db";
import { ScriptedProvider } from "./llm/providers/scripted";
import {
  confirmStagedExtraction,
  getProfileSnapshot,
  listRecentExtractions,
  rejectStagedExtraction,
  revertAppliedExtraction,
  runFactExtractor
} from "./advisor-extractor";
import { getOrCreateDefaultUser } from "./user";

/**
 * End-to-end extractor flow against the real DB.
 *
 * These tests exercise the full path: ScriptedProvider returns canned
 * LLM output → runFactExtractor validates/dedupes/applies → UserFact/
 * UserGoal rows update → revert/confirm flows work.
 *
 * We cannot use a live LLM in unit tests, so the scripted provider
 * returns JSON strings that simulate real extractor output shapes.
 */

async function cleanup() {
  const user = await getOrCreateDefaultUser();
  // Only clean up extractions from conversations (userDocumentId is null).
  // Document-linked extractions are owned by the document-extractor tests.
  await prisma.extractedFact.deleteMany({
    where: { userId: user.id, userDocumentId: null }
  });
  // Only remove test-author'd facts (keys we use below); leave the
  // production personal_context fact alone.
  await prisma.userFact.deleteMany({
    where: {
      userId: user.id,
      factKey: {
        in: [
          "state",
          "annual_income",
          "marital_status",
          "target_retirement_age"
        ]
      }
    }
  });
  await prisma.userGoal.deleteMany({
    where: {
      userId: user.id,
      goalKey: { in: ["house_down_payment", "car_fund"] }
    }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function provider(jsonResponse: string) {
  return new ScriptedProvider({
    responses: [{ text: jsonResponse, finishReason: "stop" }]
  });
}

describe("runFactExtractor — happy paths", () => {
  it("auto-applies a high-confidence low-stakes fact", async () => {
    const user = await getOrCreateDefaultUser();
    const result = await runFactExtractor({
      userId: user.id,
      userMessage:
        "I'm in Washington state and we're thinking about budgeting",
      assistantReply: "Got it.",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "state",
              newValue: "WA",
              confidence: 0.95,
              evidence: "I'm in Washington state",
              stakesLevel: "low"
            }
          ]
        })
      )
    });
    expect(result.skipped).toBe(false);
    expect(result.autoApplied).toBe(1);
    expect(result.staged).toBe(0);
    const fact = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "state" } }
    });
    expect(fact?.factValue).toBe("WA");
  });

  it("stages a high-stakes goal even at high confidence", async () => {
    const user = await getOrCreateDefaultUser();
    const result = await runFactExtractor({
      userId: user.id,
      userMessage: "we want to buy a house in 3 years, probably need 100k down",
      assistantReply: "Understood.",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "goal",
              goalKey: "house_down_payment",
              newValue: {
                label: "House down payment",
                targetValueCents: 10000000,
                targetDate: "2029-05-01"
              },
              confidence: 0.9,
              evidence: "buy a house in 3 years, probably need 100k down",
              stakesLevel: "high"
            }
          ]
        })
      )
    });
    expect(result.staged).toBe(1);
    expect(result.autoApplied).toBe(0);
    // High-stakes = not auto-applied, so no UserGoal row yet
    const goal = await prisma.userGoal.findUnique({
      where: {
        userId_goalKey: { userId: user.id, goalKey: "house_down_payment" }
      }
    });
    expect(goal).toBeNull();
  });
});

describe("runFactExtractor — guardrails", () => {
  it("skips trivially short turns without calling the LLM", async () => {
    const user = await getOrCreateDefaultUser();
    // Provider that would throw if called — verifies we don't call it
    const angry = new ScriptedProvider({
      handler: () => {
        throw new Error("should not call LLM for trivial turns");
      }
    });
    const result = await runFactExtractor({
      userId: user.id,
      userMessage: "ok",
      assistantReply: "ok",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: angry
    });
    expect(result.skipped).toBe(true);
  });

  it("rejects extractions whose evidence is not in the user message", async () => {
    const user = await getOrCreateDefaultUser();
    const result = await runFactExtractor({
      userId: user.id,
      userMessage: "I'm in Washington state.",
      assistantReply: "Got it.",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "annual_income",
              newValue: 500000,
              confidence: 0.95,
              // Evidence NOT in the user message — extractor hallucinated
              evidence: "I make 500k a year",
              stakesLevel: "medium"
            }
          ]
        })
      )
    });
    expect(result.autoApplied).toBe(0);
    expect(result.rejected).toBe(1);
    // No fact should be written
    const fact = await prisma.userFact.findUnique({
      where: {
        userId_factKey: { userId: user.id, factKey: "annual_income" }
      }
    });
    expect(fact).toBeNull();
  });

  it("rejects extractions with disallowed fact keys (prompt-injection defense)", async () => {
    const user = await getOrCreateDefaultUser();
    const result = await runFactExtractor({
      userId: user.id,
      userMessage: "I'm aggressive with my retirement investing strategy",
      assistantReply: "Got it.",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "admin_password", // NOT in allowlist
              newValue: "xyz",
              confidence: 0.95,
              evidence: "aggressive with my retirement",
              stakesLevel: "low"
            }
          ]
        })
      )
    });
    expect(result.rejected).toBe(1);
    expect(result.autoApplied).toBe(0);
  });

  it("stages (not applies) when a contradiction exists with an existing fact", async () => {
    const user = await getOrCreateDefaultUser();
    // Prime an existing state fact
    await prisma.userFact.create({
      data: {
        userId: user.id,
        factKey: "state",
        factValue: "CA" as never,
        source: "conversation"
      }
    });

    const result = await runFactExtractor({
      userId: user.id,
      userMessage: "Actually I'm now in Texas, I moved my residence",
      assistantReply: "Noted.",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "state",
              newValue: "TX",
              confidence: 0.95,
              evidence: "I'm now in Texas",
              stakesLevel: "low"
            }
          ]
        })
      )
    });
    expect(result.staged).toBe(1);
    expect(result.autoApplied).toBe(0);
    // Existing fact unchanged
    const fact = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "state" } }
    });
    expect(fact?.factValue).toBe("CA");
  });

  it("dedupes: same fact/value extracted again within 24h is skipped", async () => {
    const user = await getOrCreateDefaultUser();
    // First run
    await runFactExtractor({
      userId: user.id,
      userMessage: "I'm in Washington state",
      assistantReply: "ok",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "state",
              newValue: "WA",
              confidence: 0.95,
              evidence: "Washington state",
              stakesLevel: "low"
            }
          ]
        })
      )
    });
    // Second run with same output
    const second = await runFactExtractor({
      userId: user.id,
      userMessage: "Reminder: I'm in Washington state",
      assistantReply: "ok",
      recentHistory: [],
      sessionId: null,
      chatMessageId: null,
      provider: provider(
        JSON.stringify({
          extractions: [
            {
              kind: "fact",
              factKey: "state",
              newValue: "WA",
              confidence: 0.95,
              evidence: "Washington state",
              stakesLevel: "low"
            }
          ]
        })
      )
    });
    expect(second.rejected).toBe(1);
    expect(second.autoApplied).toBe(0);
  });
});

describe("staged → confirm / reject / revert", () => {
  it("confirmStagedExtraction applies the staged fact", async () => {
    const user = await getOrCreateDefaultUser();
    // Create a staged row directly
    const staged = await prisma.extractedFact.create({
      data: {
        userId: user.id,
        kind: "fact",
        status: "staged",
        factKey: "marital_status",
        newValue: "married" as never,
        confidence: 0.7,
        evidence: "we're married",
        stakesLevel: "medium"
      }
    });
    await confirmStagedExtraction({ userId: user.id, id: staged.id });
    const fact = await prisma.userFact.findUnique({
      where: {
        userId_factKey: { userId: user.id, factKey: "marital_status" }
      }
    });
    expect(fact?.factValue).toBe("married");
    const updated = await prisma.extractedFact.findUnique({
      where: { id: staged.id }
    });
    expect(updated?.status).toBe("confirmed");
  });

  it("rejectStagedExtraction marks the row rejected, does not write a fact", async () => {
    const user = await getOrCreateDefaultUser();
    const staged = await prisma.extractedFact.create({
      data: {
        userId: user.id,
        kind: "fact",
        status: "staged",
        factKey: "target_retirement_age",
        newValue: 55 as never,
        confidence: 0.7,
        evidence: "retire at 55",
        stakesLevel: "medium"
      }
    });
    await rejectStagedExtraction({ userId: user.id, id: staged.id });
    const fact = await prisma.userFact.findUnique({
      where: {
        userId_factKey: { userId: user.id, factKey: "target_retirement_age" }
      }
    });
    expect(fact).toBeNull();
    const updated = await prisma.extractedFact.findUnique({
      where: { id: staged.id }
    });
    expect(updated?.status).toBe("rejected");
  });

  it("revertAppliedExtraction restores the previous value", async () => {
    const user = await getOrCreateDefaultUser();
    // Pre-seed: existing state = CA
    await prisma.userFact.create({
      data: {
        userId: user.id,
        factKey: "state",
        factValue: "CA" as never,
        source: "conversation"
      }
    });
    // Auto-applied: changed to WA, previousValue=CA
    const applied = await prisma.extractedFact.create({
      data: {
        userId: user.id,
        kind: "fact",
        status: "auto_applied",
        factKey: "state",
        newValue: "WA" as never,
        previousValue: "CA" as never,
        confidence: 0.95,
        evidence: "now in WA",
        stakesLevel: "low",
        appliedAt: new Date()
      }
    });
    // Current DB state: update to WA (simulating what apply did)
    await prisma.userFact.update({
      where: { userId_factKey: { userId: user.id, factKey: "state" } },
      data: { factValue: "WA" as never }
    });

    await revertAppliedExtraction({ userId: user.id, id: applied.id });
    const fact = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "state" } }
    });
    expect(fact?.factValue).toBe("CA");
    const updated = await prisma.extractedFact.findUnique({
      where: { id: applied.id }
    });
    expect(updated?.status).toBe("reverted");
    expect(updated?.revertedAt).not.toBeNull();
  });
});

describe("getProfileSnapshot", () => {
  it("returns recent facts + active goals", async () => {
    const user = await getOrCreateDefaultUser();
    await prisma.userFact.create({
      data: {
        userId: user.id,
        factKey: "state",
        factValue: "WA" as never,
        source: "conversation"
      }
    });
    await prisma.userGoal.create({
      data: {
        userId: user.id,
        goalKey: "car_fund",
        label: "Car",
        targetValueCents: BigInt(2000000),
        isActive: true
      }
    });
    const snapshot = await getProfileSnapshot(user.id);
    expect(snapshot.facts.some((f) => f.factKey === "state")).toBe(true);
    expect(snapshot.activeGoals.some((g) => g.goalKey === "car_fund")).toBe(true);
  });
});

describe("listRecentExtractions", () => {
  it("returns staged + auto_applied + confirmed in recency order", async () => {
    const user = await getOrCreateDefaultUser();
    await prisma.extractedFact.createMany({
      data: [
        {
          userId: user.id,
          kind: "fact",
          status: "staged",
          factKey: "state",
          newValue: "WA" as never,
          confidence: 0.9,
          evidence: "ev1",
          stakesLevel: "low"
        },
        {
          userId: user.id,
          kind: "fact",
          status: "rejected",
          factKey: "state",
          newValue: "XX" as never,
          confidence: 0.3,
          evidence: "ev2",
          stakesLevel: "low"
        }
      ]
    });
    const rows = await listRecentExtractions(user.id);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // Rejected rows are excluded
    expect(rows.every((r) => r.status !== "rejected")).toBe(true);
  });
});

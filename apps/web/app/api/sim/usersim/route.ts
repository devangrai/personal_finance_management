import { NextRequest, NextResponse } from "next/server";
import { buildModelPool } from "@/lib/llm/model-pool";
import type { LlmMessage } from "@/lib/llm/types";

/**
 * Simulation user-sim endpoint.
 *
 * Given a persona system prompt and a conversation history (from the
 * persona's perspective), produce the next user-turn message.
 *
 * This exists as its own endpoint so the simulation runner doesn't need
 * direct access to provider credentials - all LLM calls funnel through
 * the server's ModelPool.
 */

type Payload = {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
};

export async function POST(request: NextRequest) {
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.systemPrompt) {
    return NextResponse.json({ error: "systemPrompt is required" }, { status: 400 });
  }

  const pool = buildModelPool();
  const provider = pool.get("user-sim");

  const messages: LlmMessage[] = [];
  // If the conversation is empty (first turn), we still need a message for
  // the user-sim to respond to. We give it a synthetic kickoff.
  if (!payload.history || payload.history.length === 0) {
    messages.push({
      role: "user",
      content:
        "Start the conversation. You are the user - open with your first message to the advisor."
    });
  } else {
    for (const turn of payload.history) {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  const response = await provider.generate({
    systemPrompt: payload.systemPrompt,
    messages,
    temperature: 0.7, // persona creativity
    timeoutMs: 15_000
  });

  if (response.finishReason === "error" || response.finishReason === "timeout") {
    return NextResponse.json(
      { error: response.error ?? "user-sim provider failed" },
      { status: 502 }
    );
  }

  const text = (response.text ?? "").trim();
  return NextResponse.json({
    text,
    provider: provider.name,
    latencyMs: response.usage.durationMs
  });
}

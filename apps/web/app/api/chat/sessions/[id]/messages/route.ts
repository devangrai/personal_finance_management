import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import {
  appendAssistantMessage,
  appendUserMessage,
  getSessionHistoryForAdvisor,
  getChatSessionWithMessages
} from "@/lib/chat-sessions";
import { getAppEnv } from "@/lib/env";

// This turn can take 15+ seconds (router + specialist + synth).
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type Payload = { message?: string };

/**
 * Append a user message to the session, run the advisor, append the
 * assistant reply. Returns both messages so the client can render them
 * without a separate fetch.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id: sessionId } = await context.params;
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const message = (payload.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }

  // Verify session exists and belongs to the caller before anything else.
  const existing = await getChatSessionWithMessages(sessionId);
  if (!existing) {
    return NextResponse.json(
      { error: "Session not found." },
      { status: 404 }
    );
  }

  try {
    // Persist the user message first (also auto-titles if this is the
    // first message in the session).
    const userMessage = await appendUserMessage(sessionId, message);

    // Load prior history for the advisor (last 8 messages INCLUDING the
    // one we just persisted — so the agent sees the user's question).
    const history = await getSessionHistoryForAdvisor(sessionId, 8);
    // The last entry IS the user's message — pass the rest as prior context.
    const priorHistory = history.slice(0, -1);

    // Call the existing /api/advisor/chat?mode=agent endpoint with the
    // session-scoped history. We forward cookies so auth is maintained.
    const env = getAppEnv();
    const advisorUrl = new URL(
      "/api/advisor/chat?mode=agent&debug=1",
      env.appUrl
    ).toString();
    const cookieHeader = request.headers.get("cookie") ?? "";
    const advisorResp = await fetch(advisorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: cookieHeader
      },
      body: JSON.stringify({ message, history: priorHistory })
    });

    const advisorBody = (await advisorResp.json()) as {
      answer?: string;
      bullets?: string[];
      caveat?: string | null;
      followUps?: string[];
      provider?: string;
      mode?: string;
      specialistsInvoked?: string[];
      routerSource?: string;
      routerTier?: string;
      synthesized?: boolean;
      totalLatencyMs?: number;
      debug?: {
        specialists?: Array<{
          specialist: string;
          toolCallCount: number;
          appliedLessons?: Array<{
            id: string;
            topic: string;
            kind: string;
            actionOrCaveat: string;
          }>;
        }>;
      };
      error?: string;
    };

    if (!advisorResp.ok || !advisorBody.answer) {
      // Still persist an error assistant message so the user sees what
      // happened rather than a silent failure.
      const errorText =
        advisorBody.error ??
        "The advisor couldn't produce an answer this turn. Try rephrasing, or check back in a moment.";
      const assistantMessage = await appendAssistantMessage(
        sessionId,
        errorText,
        {
          metadata: {
            error: true,
            specialistsInvoked: advisorBody.specialistsInvoked ?? []
          }
        }
      );
      return NextResponse.json({
        user: userMessage,
        assistant: assistantMessage
      });
    }

    // Aggregate metadata for the UI chips.
    const specialists = advisorBody.debug?.specialists ?? [];
    const appliedLessons = specialists.flatMap(
      (s) => s.appliedLessons ?? []
    );
    const toolCalls = specialists.reduce(
      (sum, s) => sum + (s.toolCallCount ?? 0),
      0
    );

    const assistantMessage = await appendAssistantMessage(
      sessionId,
      advisorBody.answer,
      {
        metadata: {
          specialistsInvoked: advisorBody.specialistsInvoked ?? [],
          toolCalls,
          appliedLessons,
          routerTier: advisorBody.routerTier ?? null,
          routerSource: advisorBody.routerSource ?? null,
          synthesized: advisorBody.synthesized ?? false,
          latencyMs: advisorBody.totalLatencyMs ?? null,
          bullets: advisorBody.bullets ?? [],
          caveat: advisorBody.caveat ?? null,
          followUps: advisorBody.followUps ?? []
        }
      }
    );

    // Fire-and-forget: run the fact extractor over this turn. This will
    // detect facts/goals the user stated and auto-apply or stage them.
    // We do NOT await — extraction must never block the chat response.
    // The user sees the inline confirmations on their NEXT turn via the
    // assistant primer, or on /context via the "Recent updates" panel.
    void runExtractorInBackground({
      sessionId,
      chatMessageId: assistantMessage.id,
      userMessage: message,
      assistantReply: advisorBody.answer,
      priorHistory
    });

    return NextResponse.json({
      user: userMessage,
      assistant: assistantMessage
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to send message.") },
      { status: 500 }
    );
  }
}

async function runExtractorInBackground(input: {
  sessionId: string;
  chatMessageId: string;
  userMessage: string;
  assistantReply: string;
  priorHistory: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<void> {
  try {
    const { prisma } = await import("@portfolio/db");
    // Re-fetch the userId from the session row; we don't have it in
    // getChatSessionWithMessages's snapshot shape.
    const sessionRow = await prisma.chatSession.findUnique({
      where: { id: input.sessionId },
      select: { userId: true }
    });
    if (!sessionRow) return;

    const { runFactExtractor } = await import("@/lib/advisor-extractor");
    const { buildModelPool } = await import("@/lib/llm/model-pool");
    const pool = buildModelPool();
    const provider = pool.get("judge");
    await runFactExtractor({
      userId: sessionRow.userId,
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
      recentHistory: input.priorHistory,
      sessionId: input.sessionId,
      chatMessageId: input.chatMessageId,
      provider
    });
  } catch (err) {
    console.warn("[extractor] background run failed:", err);
  }
}

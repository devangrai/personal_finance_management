import { NextRequest, NextResponse } from "next/server";
import {
  archiveChatSession,
  deleteChatSession,
  getChatSessionWithMessages,
  renameChatSession
} from "@/lib/chat-sessions";
import { getErrorMessage } from "@/lib/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    const data = await getChatSessionWithMessages(id);
    if (!data) {
      return NextResponse.json(
        { error: "Session not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to load session.") },
      { status: 500 }
    );
  }
}

type PatchPayload = {
  title?: string;
  archived?: boolean;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  let payload: PatchPayload = {};
  try {
    payload = (await request.json()) as PatchPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    if (typeof payload.title === "string") {
      await renameChatSession(id, payload.title);
    }
    if (payload.archived === true) {
      await archiveChatSession(id);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to update session.") },
      { status: 500 }
    );
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  try {
    await deleteChatSession(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to delete session.") },
      { status: 500 }
    );
  }
}

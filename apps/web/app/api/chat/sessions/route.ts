import { NextResponse } from "next/server";
import {
  createChatSession,
  listChatSessions
} from "@/lib/chat-sessions";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  try {
    const sessions = await listChatSessions({ limit: 100 });
    return NextResponse.json({ sessions });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to list sessions.") },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const session = await createChatSession();
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to create session.") },
      { status: 500 }
    );
  }
}

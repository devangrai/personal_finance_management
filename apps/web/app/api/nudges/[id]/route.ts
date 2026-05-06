import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { dismissNudge, markNudgeActedOn } from "@/lib/proactive-nudges";
import { getErrorMessage } from "@/lib/errors";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { action?: string } = {};
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (body.action !== "dismiss" && body.action !== "acted_on") {
    return NextResponse.json(
      { error: "action must be 'dismiss' or 'acted_on'." },
      { status: 400 }
    );
  }
  try {
    if (body.action === "dismiss") {
      await dismissNudge({ userId: session.user.id, id });
    } else {
      await markNudgeActedOn({ userId: session.user.id, id });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to update nudge.") },
      { status: 400 }
    );
  }
}

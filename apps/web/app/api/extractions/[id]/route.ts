import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  confirmStagedExtraction,
  rejectStagedExtraction,
  revertAppliedExtraction
} from "@/lib/advisor-extractor";
import { getErrorMessage } from "@/lib/errors";

/**
 * POST /api/extractions/[id]
 *   Body: { action: "confirm" | "reject" | "revert" }
 *
 *   - confirm: apply a staged extraction (writes the UserFact / UserGoal)
 *   - reject:  mark a staged extraction as rejected (never applied)
 *   - revert:  undo an auto_applied or confirmed extraction, restoring
 *              the previous value (or deleting if none)
 */
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
  const action = body.action;
  if (action !== "confirm" && action !== "reject" && action !== "revert") {
    return NextResponse.json(
      { error: "action must be 'confirm' | 'reject' | 'revert'." },
      { status: 400 }
    );
  }

  try {
    if (action === "confirm") {
      await confirmStagedExtraction({ userId: session.user.id, id });
    } else if (action === "reject") {
      await rejectStagedExtraction({ userId: session.user.id, id });
    } else {
      await revertAppliedExtraction({ userId: session.user.id, id });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to update extraction.") },
      { status: 400 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { surfacePendingNudges } from "@/lib/proactive-nudges";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/nudges
 *   Returns up to 2 proactive nudges to surface to the current user,
 *   respecting the weekly cap. Any returned nudge is marked `surfaced`
 *   server-side so it won't be returned again next visit.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const nudges = await surfacePendingNudges(session.user.id);
    return NextResponse.json({ ok: true, nudges });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to load nudges.") },
      { status: 500 }
    );
  }
}

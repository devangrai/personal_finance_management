import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  listRecentExtractions
} from "@/lib/advisor-extractor";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/extractions
 *   List recent fact extractions for the current user.
 *   Includes auto_applied, staged, confirmed, reverted rows.
 *   Rejected rows are filtered out by listRecentExtractions.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const rows = await listRecentExtractions(session.user.id, 50);
    return NextResponse.json({
      ok: true,
      extractions: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        factKey: r.factKey,
        goalKey: r.goalKey,
        newValue: r.newValue,
        previousValue: r.previousValue,
        confidence: r.confidence,
        evidence: r.evidence,
        stakesLevel: r.stakesLevel,
        createdAt: r.createdAt,
        appliedAt: r.appliedAt,
        revertedAt: r.revertedAt
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to list extractions.") },
      { status: 500 }
    );
  }
}

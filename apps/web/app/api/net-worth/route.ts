import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  computeNetWorthNow,
  getMonthOverMonthDelta,
  listNetWorthHistory
} from "@/lib/net-worth";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/net-worth
 *   Returns: { breakdown, history: [{date, netWorthCents, ...}], momDelta }
 *   Used by the /net-worth page and the overview card.
 */
export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const [breakdown, history, momDelta] = await Promise.all([
      computeNetWorthNow(session.user.id),
      listNetWorthHistory({ userId: session.user.id, months: 12 }),
      getMonthOverMonthDelta(session.user.id)
    ]);
    return NextResponse.json({ ok: true, breakdown, history, momDelta });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to compute net worth.") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { computeCashOutflowSummary } from "@/lib/cash-outflow";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/budgets/cash-outflow?month=YYYY-MM
 *   Returns month-to-date cash outflow from depository accounts
 *   (complement to the charge-basis budget grid). Used by the cash
 *   summary card on /budget to show what's actually leaving checking.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  try {
    const summary = await computeCashOutflowSummary({
      userId: session.user.id,
      month
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to compute cash outflow.") },
      { status: 500 }
    );
  }
}

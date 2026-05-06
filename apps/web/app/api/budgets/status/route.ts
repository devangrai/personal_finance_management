import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { computeMonthlyBudgetStatus } from "@/lib/budget-comparison";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/budgets/status?month=YYYY-MM
 *   Returns the full budget-vs-actual grid for the specified month
 *   (defaults to current month).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const month = request.nextUrl.searchParams.get("month") ?? undefined;
  try {
    const status = await computeMonthlyBudgetStatus({
      userId: session.user.id,
      month
    });
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to compute budget status.") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { suggestBudgetsFromHistory } from "@/lib/budget-comparison";
import { getErrorMessage } from "@/lib/errors";

/**
 * POST /api/budgets/suggest
 *   Body: { months?: number } (defaults to 3)
 *   Returns auto-suggested budget amounts per category from trailing
 *   spending history. Client uses these to pre-populate the first-time
 *   budget setup UI.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { months?: number } = {};
  try {
    body = (await request.json().catch(() => ({}))) as { months?: number };
  } catch {
    body = {};
  }
  try {
    const suggestions = await suggestBudgetsFromHistory({
      userId: session.user.id,
      months: body.months ?? 3
    });
    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to compute suggestions.") },
      { status: 500 }
    );
  }
}

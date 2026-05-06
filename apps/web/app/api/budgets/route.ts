import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  deleteBudget,
  listBudgets,
  suggestBudgetsFromHistory,
  upsertBudget
} from "@/lib/budget-comparison";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET  /api/budgets          → list user's current budgets
 * POST /api/budgets          → upsert a budget
 *   body: { categoryId: string|null, monthlyAmountCents: number, activeFromMonth?: "YYYY-MM", notes?: string }
 *
 * DELETE happens via /api/budgets/[id].
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const rows = await listBudgets(session.user.id);
    return NextResponse.json({
      ok: true,
      budgets: rows.map((b) => ({
        id: b.id,
        categoryId: b.categoryId,
        monthlyAmountCents: Number(b.monthlyAmountCents),
        activeFromMonth: b.activeFromMonth,
        notes: b.notes
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to list budgets.") },
      { status: 500 }
    );
  }
}

type UpsertBody = {
  categoryId?: string | null;
  monthlyAmountCents?: number;
  activeFromMonth?: string;
  notes?: string;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: UpsertBody = {};
  try {
    body = (await request.json()) as UpsertBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const cents = body.monthlyAmountCents;
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents < 0) {
    return NextResponse.json(
      { error: "monthlyAmountCents must be a non-negative number." },
      { status: 400 }
    );
  }

  let activeFromMonth: Date | undefined;
  if (body.activeFromMonth) {
    const [y, m] = body.activeFromMonth.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      return NextResponse.json(
        { error: "activeFromMonth must be YYYY-MM." },
        { status: 400 }
      );
    }
    activeFromMonth = new Date(y, m - 1, 1);
  }

  try {
    const row = await upsertBudget({
      userId: session.user.id,
      categoryId: body.categoryId ?? null,
      monthlyAmountCents: BigInt(Math.round(cents)),
      activeFromMonth,
      notes: body.notes
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to save budget.") },
      { status: 500 }
    );
  }
}

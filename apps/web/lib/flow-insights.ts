import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";
import { resolveWindow, type FlowWindow } from "./flow-aggregation";
import { getRecurringSummary } from "./recurring-summary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopMover = {
  categoryKey: string;
  label: string;
  amount: number; // in current window, normalized per month if multi-month
  previousAmount: number; // in prior window, same normalization
  deltaPct: number | null; // null when previous is 0 (can't compute %)
  // Threshold we flag at, so UI can show a pill without re-thresholding.
  flag: "up" | "down" | "flat";
};

export type StaleRecurring = {
  displayName: string;
  amount: number;
  frequency: string;
  direction: "credit" | "debit";
  lastSeen: string; // ISO date
  ageMonths: number;
  note: string;
};

// ---------------------------------------------------------------------------
// Top movers
// ---------------------------------------------------------------------------

/**
 * Compute top spending categories in the current window + their delta vs a
 * matched prior window. We group by category.key; categories without a
 * label are grouped under "Uncategorized".
 */
export async function computeTopMovers(
  window: FlowWindow,
  now: Date = new Date(),
  limit = 6
): Promise<TopMover[]> {
  const userId = await getDefaultUserId();
  const w = resolveWindow(window, now);

  // Prior window has the same length immediately preceding.
  const span = w.end.getTime() - w.start.getTime();
  const prevStart = new Date(w.start.getTime() - span);
  const prevEnd = new Date(w.start);

  async function sumByCategory(start: Date, end: Date) {
    const rows = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: {
        userId,
        isPending: false,
        direction: "debit", // spending only
        date: { gte: start, lt: end }
      },
      _sum: { amount: true },
      _count: { id: true }
    });
    return rows;
  }

  const [current, previous] = await Promise.all([
    sumByCategory(w.start, w.end),
    sumByCategory(prevStart, prevEnd)
  ]);

  // Hydrate category labels in one query
  const categoryIds = Array.from(
    new Set([
      ...current.map((r) => r.categoryId).filter((x): x is string => x !== null),
      ...previous.map((r) => r.categoryId).filter((x): x is string => x !== null)
    ])
  );
  const categories = await prisma.transactionCategory.findMany({
    where: { id: { in: categoryIds } },
    select: { id: true, key: true, label: true }
  });
  const catById = new Map(categories.map((c) => [c.id, c]));

  // Normalize to per-month so "this month" and "avg 3mo" are comparable.
  const currentByKey = new Map<string, { label: string; amount: number }>();
  for (const row of current) {
    const cat = row.categoryId ? catById.get(row.categoryId) : null;
    const key = cat?.key ?? "uncategorized";
    const label = cat?.label ?? "Uncategorized";
    const amt = Number(row._sum.amount ?? 0) / w.monthsSpanned;
    const existing = currentByKey.get(key);
    if (existing) {
      existing.amount += amt;
    } else {
      currentByKey.set(key, { label, amount: amt });
    }
  }

  // Prior window uses the same monthsSpanned.
  const prevByKey = new Map<string, number>();
  for (const row of previous) {
    const cat = row.categoryId ? catById.get(row.categoryId) : null;
    const key = cat?.key ?? "uncategorized";
    const amt = Number(row._sum.amount ?? 0) / w.monthsSpanned;
    prevByKey.set(key, (prevByKey.get(key) ?? 0) + amt);
  }

  const movers: TopMover[] = [];
  for (const [key, { label, amount }] of currentByKey.entries()) {
    const prev = prevByKey.get(key) ?? 0;
    const deltaPct =
      prev > 0 ? ((amount - prev) / prev) * 100 : amount > 0 ? null : 0;
    let flag: "up" | "down" | "flat" = "flat";
    if (deltaPct !== null) {
      if (deltaPct >= 25) flag = "up";
      else if (deltaPct <= -25) flag = "down";
    }
    movers.push({
      categoryKey: key,
      label,
      amount,
      previousAmount: prev,
      deltaPct,
      flag
    });
  }

  // Sort by current amount desc, cap at limit. Credit-card-payment is a
  // pseudo-category, not spending in the usual sense — hide it.
  return movers
    .filter((m) => m.categoryKey !== "credit_card_payment")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Stale recurring flows
// ---------------------------------------------------------------------------

/**
 * Wrap getRecurringSummary with "stale" flagging heuristic: flows whose
 * amount has been stable for >= 6 months, or flows whose lastSeen is more
 * than ~45 days ago despite being marked as monthly/weekly.
 */
export async function computeStaleRecurring(
  now: Date = new Date()
): Promise<StaleRecurring[]> {
  const summary = await getRecurringSummary();
  const all = [...summary.inflows, ...summary.outflows];

  const staleList: StaleRecurring[] = [];
  for (const cand of all) {
    const lastSeenDate = new Date(cand.lastDate);
    const ageMs = now.getTime() - lastSeenDate.getTime();
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30);

    let note: string | null = null;
    if (ageMonths > 1.5) {
      // Was expected recently but hasn't hit.
      const days = Math.round(ageMs / (1000 * 60 * 60 * 24));
      note = `last seen ${days} days ago · ${cand.frequency} expected`;
    } else if (cand.occurrenceCount >= 6) {
      note = `${cand.occurrenceCount} consecutive ${cand.frequency} charges — still needed?`;
    }

    if (note) {
      staleList.push({
        displayName: cand.displayName,
        amount: Number(cand.averageAmount),
        frequency: cand.frequency,
        direction: cand.direction === "credit" ? "credit" : "debit",
        lastSeen: cand.lastDate,
        ageMonths,
        note
      });
    }
  }

  // Rank by "most worth a look": overdue flows first, then long-running.
  return staleList
    .sort((a, b) => {
      const overdueA = a.ageMonths > 1.5 ? 1 : 0;
      const overdueB = b.ageMonths > 1.5 ? 1 : 0;
      if (overdueA !== overdueB) return overdueB - overdueA;
      return b.ageMonths - a.ageMonths;
    })
    .slice(0, 5);
}

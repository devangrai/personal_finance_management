import { prisma } from "@portfolio/db";
import { computeGoalProgress } from "./goal-progress";

// ---------------------------------------------------------------------------
// Proactive nudges (Phase 4).
//
// A weekly cron runs generateNudgesForUser() which scans the user's data
// and emits 0-N candidate ProactiveNudge rows in `pending` state. The UI
// then calls surfacePendingNudges() which returns at most 2 unsurfaced
// ones (respecting the cap) and marks them `surfaced`.
//
// Rules:
//   - Cap: 2 surfaced per 7-day window. Surfacing the 3rd+ is blocked.
//   - Dedup: never surface the same (kind + headline) twice within 14 days.
//   - Priority: higher = surface first. Range 0-100.
//   - Status flow: pending → surfaced → (dismissed | acted_on).
// ---------------------------------------------------------------------------

const NUDGE_CAP_PER_WEEK = 2;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUP_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type CandidateNudge = {
  kind:
    | "spending_anomaly"
    | "goal_checkin"
    | "portfolio_drift"
    | "cash_sweep"
    | "budget_exceeded"
    | "other";
  headline: string;
  detail: string;
  suggestedAction?: string;
  priority: number;
  evidencePayload?: Record<string, unknown>;
};

/**
 * Produce candidate nudges for a user. This is read-only — no writes. Caller
 * (generateNudgesForUser) is responsible for persistence + dedup.
 */
export async function buildCandidateNudges(
  userId: string
): Promise<CandidateNudge[]> {
  const candidates: CandidateNudge[] = [];

  // 1. Goal check-ins — most actionable nudge source.
  const goals = await computeGoalProgress(userId);
  for (const g of goals) {
    if (g.percent >= 100) {
      candidates.push({
        kind: "goal_checkin",
        headline: `You've hit your "${g.label}" goal.`,
        detail: `You're at ${g.percent.toFixed(0)}% of target${
          g.targetAmount ? ` ($${g.targetAmount.toLocaleString()})` : ""
        }. Want to mark it done or roll it into a bigger target?`,
        suggestedAction: "Update the goal",
        priority: 90,
        evidencePayload: { goalKey: g.goalKey, percent: g.percent }
      });
    } else if (g.onTrack === false && g.monthlyPaceRequired !== null) {
      candidates.push({
        kind: "goal_checkin",
        headline: `"${g.label}" is falling behind.`,
        detail: `At your current pace you'll miss the target. You'd need about $${Math.round(
          g.monthlyPaceRequired
        ).toLocaleString()}/month to get back on track.`,
        suggestedAction: "Discuss the gap with the advisor",
        priority: 70,
        evidencePayload: {
          goalKey: g.goalKey,
          percent: g.percent,
          monthlyPaceRequired: g.monthlyPaceRequired
        }
      });
    }
  }

  // 2. Cash sweep — lots of money in a low-yield checking account.
  const depos = await prisma.account.findMany({
    where: { userId, type: "depository" },
    select: {
      id: true,
      name: true,
      subtype: true,
      currentBalance: true
    }
  });
  let checkingBalance = 0;
  for (const a of depos) {
    if (!a.currentBalance) continue;
    if ((a.subtype ?? "").toLowerCase().includes("check")) {
      checkingBalance += Number(a.currentBalance);
    }
  }
  if (checkingBalance >= 10000) {
    candidates.push({
      kind: "cash_sweep",
      headline: `$${Math.round(checkingBalance).toLocaleString()} sitting in checking.`,
      detail: `That's earning near-zero interest. Moving most of it to an HYSA at ~4.5% would generate roughly $${Math.round(
        (checkingBalance * 0.045) / 12
      ).toLocaleString()}/month in interest.`,
      suggestedAction: "Ask about best HYSA options",
      priority: 55,
      evidencePayload: { checkingBalance }
    });
  }

  // 3. Spending anomaly — any category spent >40% more than trailing
  //    3-month average.
  //    Skip if the user has no categorized transactions.
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      date: { gte: threeMonthsAgo },
      personalFinanceCategory: { not: null },
      direction: "debit"
    },
    select: {
      date: true,
      amount: true,
      personalFinanceCategory: true
    }
  });
  const byCategoryThisMonth = new Map<string, number>();
  const byCategoryPrior = new Map<string, number>();
  for (const t of txns) {
    if (!t.personalFinanceCategory) continue;
    const key = t.personalFinanceCategory;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    if (t.date >= thisMonthStart) {
      byCategoryThisMonth.set(key, (byCategoryThisMonth.get(key) ?? 0) + amt);
    } else {
      byCategoryPrior.set(key, (byCategoryPrior.get(key) ?? 0) + amt);
    }
  }
  for (const [cat, current] of byCategoryThisMonth) {
    const priorAvg = (byCategoryPrior.get(cat) ?? 0) / 3; // avg of last 3 months
    if (priorAvg < 100) continue; // too small to be meaningful
    if (current < priorAvg * 1.4) continue;
    const pctIncrease = ((current - priorAvg) / priorAvg) * 100;
    candidates.push({
      kind: "spending_anomaly",
      headline: `${cat} spending is up ${Math.round(pctIncrease)}% this month.`,
      detail: `This month: $${Math.round(current).toLocaleString()}. 3-month average: $${Math.round(
        priorAvg
      ).toLocaleString()}.`,
      suggestedAction: `Review ${cat} transactions`,
      priority: 60,
      evidencePayload: { category: cat, current, priorAvg, pctIncrease }
    });
  }

  // 4. Budget exceeded — any category that's over or projected >110%.
  //    Intent-based alert (beats "up 40% vs average" for actionability).
  try {
    const { computeMonthlyBudgetStatus } = await import("./budget-comparison");
    const status = await computeMonthlyBudgetStatus({ userId });
    for (const cat of status.categories) {
      if (!cat.budgetCents || cat.budgetCents === 0) continue;
      const spent = cat.spentCents;
      const budget = cat.budgetCents;
      if (cat.flag === "over") {
        candidates.push({
          kind: "budget_exceeded",
          headline: `${cat.categoryLabel} budget exceeded: $${Math.round(spent / 100).toLocaleString()} / $${Math.round(budget / 100).toLocaleString()}`,
          detail: `You've spent ${Math.round((spent / budget) * 100)}% of your ${cat.categoryLabel} budget with ${status.daysInMonth - status.daysElapsed} day${status.daysInMonth - status.daysElapsed === 1 ? "" : "s"} left this month.`,
          suggestedAction: "See your budget",
          priority: 80,
          evidencePayload: {
            categoryLabel: cat.categoryLabel,
            spentCents: spent,
            budgetCents: budget,
            percent: cat.percent
          }
        });
      } else if (cat.flag === "warning" && cat.projectedPercent !== null) {
        candidates.push({
          kind: "budget_exceeded",
          headline: `${cat.categoryLabel} on pace to exceed budget`,
          detail: `At your current pace, ${cat.categoryLabel} is projected to hit $${Math.round(cat.projectedCents / 100).toLocaleString()} vs a $${Math.round(budget / 100).toLocaleString()} budget (${Math.round(cat.projectedPercent)}%).`,
          suggestedAction: "See your budget",
          priority: 65,
          evidencePayload: {
            categoryLabel: cat.categoryLabel,
            spentCents: spent,
            budgetCents: budget,
            projectedCents: cat.projectedCents,
            projectedPercent: cat.projectedPercent
          }
        });
      }
    }
  } catch {
    // Budget status compute may fail for users without any categories /
    // transactions. Non-fatal; the other nudge types still fire.
  }

  // Sort highest priority first.
  candidates.sort((a, b) => b.priority - a.priority);
  return candidates;
}

/**
 * Persist candidate nudges as pending rows, skipping ones that dedup
 * against a recently-surfaced nudge of the same kind+headline.
 */
export async function generateNudgesForUser(
  userId: string
): Promise<{
  candidatesFound: number;
  inserted: number;
  skippedDedup: number;
}> {
  const candidates = await buildCandidateNudges(userId);
  let inserted = 0;
  let skippedDedup = 0;

  const since = new Date(Date.now() - DEDUP_WINDOW_MS);
  const recent = await prisma.proactiveNudge.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { kind: true, headline: true }
  });
  const recentKey = new Set(recent.map((r) => `${r.kind}::${r.headline}`));

  // Cap: only take top 5 candidates; more than that suggests a bug.
  for (const c of candidates.slice(0, 5)) {
    if (recentKey.has(`${c.kind}::${c.headline}`)) {
      skippedDedup++;
      continue;
    }
    await prisma.proactiveNudge.create({
      data: {
        userId,
        kind: c.kind,
        headline: c.headline,
        detail: c.detail,
        suggestedAction: c.suggestedAction ?? null,
        priority: c.priority,
        evidencePayload: JSON.parse(
          JSON.stringify(c.evidencePayload ?? {})
        ) as never,
        status: "pending"
      }
    });
    inserted++;
  }

  return { candidatesFound: candidates.length, inserted, skippedDedup };
}

/**
 * Pick the next nudges to show the user. Respects the weekly cap:
 * at most NUDGE_CAP_PER_WEEK surfaced in the last 7 days. Marks returned
 * rows as `surfaced`.
 */
export async function surfacePendingNudges(
  userId: string,
  limit = NUDGE_CAP_PER_WEEK
): Promise<
  Array<{
    id: string;
    kind: string;
    headline: string;
    detail: string;
    suggestedAction: string | null;
    priority: number;
    createdAt: Date;
  }>
> {
  // Count surfaced in the last week
  const weekAgo = new Date(Date.now() - WEEK_MS);
  const recentSurfaced = await prisma.proactiveNudge.count({
    where: {
      userId,
      surfacedAt: { gte: weekAgo }
    }
  });
  const slotsLeft = Math.max(0, limit - recentSurfaced);
  if (slotsLeft === 0) return [];

  const pending = await prisma.proactiveNudge.findMany({
    where: { userId, status: "pending" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: slotsLeft
  });
  if (pending.length === 0) return [];

  // Mark surfaced
  const ids = pending.map((p) => p.id);
  await prisma.proactiveNudge.updateMany({
    where: { id: { in: ids } },
    data: { status: "surfaced", surfacedAt: new Date() }
  });

  return pending.map((p) => ({
    id: p.id,
    kind: p.kind,
    headline: p.headline,
    detail: p.detail,
    suggestedAction: p.suggestedAction,
    priority: p.priority,
    createdAt: p.createdAt
  }));
}

export async function dismissNudge(input: {
  userId: string;
  id: string;
}): Promise<void> {
  const row = await prisma.proactiveNudge.findUnique({
    where: { id: input.id }
  });
  if (!row || row.userId !== input.userId) throw new Error("not found");
  await prisma.proactiveNudge.update({
    where: { id: input.id },
    data: { status: "dismissed" }
  });
}

export async function markNudgeActedOn(input: {
  userId: string;
  id: string;
}): Promise<void> {
  const row = await prisma.proactiveNudge.findUnique({
    where: { id: input.id }
  });
  if (!row || row.userId !== input.userId) throw new Error("not found");
  await prisma.proactiveNudge.update({
    where: { id: input.id },
    data: { status: "acted_on" }
  });
}

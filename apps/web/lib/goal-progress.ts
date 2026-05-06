import { prisma } from "@portfolio/db";

// ---------------------------------------------------------------------------
// Goal progress tracking (Phase 2).
//
// Goals are already created by the fact extractor when the user states a
// commitment. This module adds the "how am I doing?" layer:
//
//   - computeGoalProgress(userId): for each active goal, estimate current
//     progress from cash balances and investment values. Progress is a
//     rough aggregate — we don't ask the user to tag specific accounts
//     for each goal (that's friction we're deliberately avoiding). Instead,
//     we pool all the user's cash+investments and allocate proportional
//     progress against active goals by target amount.
//
//   - detectGoalMilestones(userId): find goals that just crossed 25/50/75/
//     100% thresholds so proactive nudges can surface them.
//
// This is intentionally simple. A later phase can link specific accounts
// to specific goals once the user asks for it.
// ---------------------------------------------------------------------------

export type GoalProgressSnapshot = {
  goalId: string;
  goalKey: string;
  label: string;
  targetValueCents: number | null;
  targetDate: Date | null;
  /** Dollars (floating point for UI). */
  targetAmount: number | null;
  /** Allocated dollars against this goal right now. */
  currentAmount: number;
  percent: number; // 0-100
  onTrack: boolean | null; // null if we can't estimate
  monthsRemaining: number | null;
  monthlyPaceRequired: number | null; // dollars/month needed to hit target
};

async function getLiquidAssetTotalCents(userId: string): Promise<bigint> {
  // Sum current depository (cash) balances. We deliberately skip
  // investments for proportional goal allocation — a "house fund" goal
  // shouldn't claim a share of the user's 401k balance, which would
  // falsely inflate progress. Cash is the right proxy for near-term
  // savings goals.
  const rows = await prisma.account.findMany({
    where: { userId, type: "depository" },
    select: { currentBalance: true }
  });
  let totalCents = BigInt(0);
  for (const r of rows) {
    if (r.currentBalance === null) continue;
    // Decimal -> cents via number conversion; fine at personal-finance
    // scale (we're not handling crypto with 18 decimals).
    const dollars = Number(r.currentBalance);
    if (Number.isFinite(dollars)) {
      totalCents += BigInt(Math.round(dollars * 100));
    }
  }
  return totalCents;
}

export async function computeGoalProgress(
  userId: string
): Promise<GoalProgressSnapshot[]> {
  const [goals, totalCents] = await Promise.all([
    prisma.userGoal.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "asc" }
    }),
    getLiquidAssetTotalCents(userId)
  ]);
  if (goals.length === 0) return [];

  // Split total liquid assets proportional to each goal's target amount.
  // Goals without a target amount don't get any allocation (we can't
  // measure progress against "infinity").
  const totalTargetCents = goals.reduce(
    (acc, g) => (g.targetValueCents !== null ? acc + g.targetValueCents : acc),
    BigInt(0)
  );

  const totalDollars = Number(totalCents) / 100;
  const totalTargetDollars = Number(totalTargetCents) / 100;
  const now = Date.now();

  return goals.map((g) => {
    const targetAmount =
      g.targetValueCents !== null ? Number(g.targetValueCents) / 100 : null;
    let currentAmount = 0;
    if (targetAmount !== null && totalTargetDollars > 0) {
      // Proportional allocation. A user with $50k liquid and two goals
      // ($10k, $100k) gets ~$4.5k allocated to the first, $45.5k to
      // the second. Capped at targetAmount per goal.
      const share = targetAmount / totalTargetDollars;
      currentAmount = Math.min(totalDollars * share, targetAmount);
    }
    const percent =
      targetAmount === null || targetAmount === 0
        ? 0
        : Math.max(0, Math.min(100, (currentAmount / targetAmount) * 100));

    let monthsRemaining: number | null = null;
    let monthlyPaceRequired: number | null = null;
    let onTrack: boolean | null = null;

    if (g.targetDate) {
      const ms = g.targetDate.getTime() - now;
      monthsRemaining = Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.44));
      if (targetAmount !== null && monthsRemaining > 0) {
        const remaining = Math.max(0, targetAmount - currentAmount);
        monthlyPaceRequired = remaining / monthsRemaining;
        // Rough "on track" heuristic: if we'd hit target by the date
        // assuming current pace (we approximate pace as currentAmount /
        // months since goal was set), are we ahead?
        const monthsSinceCreated = Math.max(
          1,
          (now - g.createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
        );
        const estimatedPace = currentAmount / monthsSinceCreated;
        const projectedFinal =
          currentAmount + estimatedPace * monthsRemaining;
        onTrack = projectedFinal >= targetAmount * 0.95;
      }
    }

    return {
      goalId: g.id,
      goalKey: g.goalKey,
      label: g.label,
      targetValueCents:
        g.targetValueCents !== null ? Number(g.targetValueCents) : null,
      targetDate: g.targetDate,
      targetAmount,
      currentAmount,
      percent,
      onTrack,
      monthsRemaining,
      monthlyPaceRequired
    };
  });
}

/**
 * Find goals that just crossed a significance threshold. Used by the
 * proactive-nudge generator to know what to surface.
 */
export async function detectGoalMilestones(
  userId: string
): Promise<
  Array<{
    goal: GoalProgressSnapshot;
    milestone: "25" | "50" | "75" | "100" | "behind" | "ahead";
  }>
> {
  const progress = await computeGoalProgress(userId);
  const results: Array<{
    goal: GoalProgressSnapshot;
    milestone: "25" | "50" | "75" | "100" | "behind" | "ahead";
  }> = [];
  for (const g of progress) {
    if (g.percent >= 100) {
      results.push({ goal: g, milestone: "100" });
    } else if (g.percent >= 75) {
      results.push({ goal: g, milestone: "75" });
    } else if (g.percent >= 50) {
      results.push({ goal: g, milestone: "50" });
    } else if (g.percent >= 25) {
      results.push({ goal: g, milestone: "25" });
    }
    if (g.onTrack === false) {
      results.push({ goal: g, milestone: "behind" });
    } else if (g.onTrack === true && g.percent >= 50) {
      results.push({ goal: g, milestone: "ahead" });
    }
  }
  return results;
}

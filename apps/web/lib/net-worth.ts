import { prisma } from "@portfolio/db";

/**
 * Net Worth aggregation.
 *
 * Computes a single current net-worth number from every source the app
 * knows about:
 *   + Cash:         Plaid depository accounts (currentBalance)
 *   + Investments:  Plaid HoldingSnapshot (most recent per account) +
 *                   ManualHoldingSnapshot for CSV/SnapTrade accounts
 *                   not hidden by excludeFromNetWorth
 *   + Manual assets: ManualAssetLiability kind="asset"
 *   - Credit card debt: Plaid credit accounts (currentBalance, positive = owed)
 *   - Loans:            Plaid loan accounts (currentBalance)
 *   - Manual liabilities: ManualAssetLiability kind="liability"
 *
 * A nightly cron writes a NetWorthSnapshot row so we have a time series
 * for the /net-worth chart and month-over-month deltas.
 */

export type NetWorthBreakdown = {
  cashCents: number;
  investmentsCents: number;
  manualAssetsCents: number;
  creditCardDebtCents: number;
  loanDebtCents: number;
  manualLiabilitiesCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  netWorthCents: number;
  manualItems: {
    assets: Array<{ id: string; category: string; label: string; amountCents: number }>;
    liabilities: Array<{ id: string; category: string; label: string; amountCents: number }>;
  };
};

function toCents(dec: unknown): number {
  if (dec === null || dec === undefined) return 0;
  const n = Number(dec);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export async function computeNetWorthNow(userId: string): Promise<NetWorthBreakdown> {
  // 1. Cash = depository accounts
  const depoAccts = await prisma.account.findMany({
    where: { userId, type: "depository" },
    select: { currentBalance: true }
  });
  const cashCents = depoAccts.reduce((s, a) => s + toCents(a.currentBalance), 0);

  // 2. Investments — most recent HoldingSnapshot per accountId
  const plaidInvestmentRows = await prisma.$queryRawUnsafe<
    Array<{ accountId: string; institutionValue: string | null }>
  >(
    `SELECT DISTINCT ON (h."accountId")
         h."accountId",
         h."institutionValue"::text AS "institutionValue"
       FROM "HoldingSnapshot" h
       WHERE h."userId" = $1
       ORDER BY h."accountId", h."asOf" DESC`,
    userId
  );
  let investmentsCents = 0;
  for (const r of plaidInvestmentRows) {
    investmentsCents += toCents(r.institutionValue);
  }

  // Manual investment accounts — use their latest ManualHoldingSnapshot
  const manualAccts = await prisma.manualInvestmentAccount.findMany({
    where: { userId, excludeFromNetWorth: false },
    select: { id: true }
  });
  if (manualAccts.length > 0) {
    const manualHoldings = await prisma.$queryRawUnsafe<
      Array<{ manualInvestmentAccountId: string; institutionValue: string | null }>
    >(
      `SELECT DISTINCT ON (h."manualInvestmentAccountId")
           h."manualInvestmentAccountId",
           h."institutionValue"::text AS "institutionValue"
         FROM "ManualHoldingSnapshot" h
         WHERE h."manualInvestmentAccountId" = ANY($1::text[])
         ORDER BY h."manualInvestmentAccountId", h."asOf" DESC`,
      manualAccts.map((a) => a.id)
    );
    for (const r of manualHoldings) {
      investmentsCents += toCents(r.institutionValue);
    }
  }

  // 3. Manual assets + liabilities
  const manualRows = await prisma.manualAssetLiability.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" }
  });
  const manualAssets = manualRows.filter((m) => m.kind === "asset");
  const manualLiabilities = manualRows.filter((m) => m.kind === "liability");
  const manualAssetsCents = manualAssets.reduce(
    (s, m) => s + Number(m.amountCents),
    0
  );
  const manualLiabilitiesCents = manualLiabilities.reduce(
    (s, m) => s + Number(m.amountCents),
    0
  );

  // 4. Credit card + loan debt
  const creditAccts = await prisma.account.findMany({
    where: { userId, type: "credit" },
    select: { currentBalance: true }
  });
  const creditCardDebtCents = creditAccts.reduce(
    (s, a) => s + toCents(a.currentBalance),
    0
  );
  const loanAccts = await prisma.account.findMany({
    where: { userId, type: "loan" },
    select: { currentBalance: true }
  });
  const loanDebtCents = loanAccts.reduce(
    (s, a) => s + toCents(a.currentBalance),
    0
  );

  const totalAssetsCents = cashCents + investmentsCents + manualAssetsCents;
  const totalLiabilitiesCents =
    creditCardDebtCents + loanDebtCents + manualLiabilitiesCents;
  const netWorthCents = totalAssetsCents - totalLiabilitiesCents;

  return {
    cashCents,
    investmentsCents,
    manualAssetsCents,
    creditCardDebtCents,
    loanDebtCents,
    manualLiabilitiesCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    netWorthCents,
    manualItems: {
      assets: manualAssets.map((m) => ({
        id: m.id,
        category: m.category,
        label: m.label,
        amountCents: Number(m.amountCents)
      })),
      liabilities: manualLiabilities.map((m) => ({
        id: m.id,
        category: m.category,
        label: m.label,
        amountCents: Number(m.amountCents)
      }))
    }
  };
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/**
 * Compute a NetWorthSnapshot for today and upsert it.
 * Idempotent by (userId, snapshotDate=today UTC).
 */
export async function snapshotNetWorthForUser(args: {
  userId: string;
  date?: Date; // defaults to today UTC midnight
}): Promise<void> {
  const d = args.date ?? new Date();
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const breakdown = await computeNetWorthNow(args.userId);

  await prisma.netWorthSnapshot.upsert({
    where: {
      userId_snapshotDate: {
        userId: args.userId,
        snapshotDate: dayStart
      }
    },
    update: {
      cashCents: BigInt(breakdown.cashCents),
      investmentsCents: BigInt(breakdown.investmentsCents),
      manualAssetsCents: BigInt(breakdown.manualAssetsCents),
      creditCardDebtCents: BigInt(breakdown.creditCardDebtCents),
      loanDebtCents: BigInt(breakdown.loanDebtCents),
      manualLiabilitiesCents: BigInt(breakdown.manualLiabilitiesCents),
      netWorthCents: BigInt(breakdown.netWorthCents)
    },
    create: {
      userId: args.userId,
      snapshotDate: dayStart,
      cashCents: BigInt(breakdown.cashCents),
      investmentsCents: BigInt(breakdown.investmentsCents),
      manualAssetsCents: BigInt(breakdown.manualAssetsCents),
      creditCardDebtCents: BigInt(breakdown.creditCardDebtCents),
      loanDebtCents: BigInt(breakdown.loanDebtCents),
      manualLiabilitiesCents: BigInt(breakdown.manualLiabilitiesCents),
      netWorthCents: BigInt(breakdown.netWorthCents)
    }
  });
}

export async function listNetWorthHistory(args: {
  userId: string;
  months?: number;
}): Promise<
  Array<{ date: string; netWorthCents: number; assetsCents: number; liabilitiesCents: number }>
> {
  const months = args.months ?? 12;
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const rows = await prisma.netWorthSnapshot.findMany({
    where: { userId: args.userId, snapshotDate: { gte: cutoff } },
    orderBy: { snapshotDate: "asc" }
  });
  return rows.map((r) => ({
    date: r.snapshotDate.toISOString().slice(0, 10),
    netWorthCents: Number(r.netWorthCents),
    assetsCents:
      Number(r.cashCents) + Number(r.investmentsCents) + Number(r.manualAssetsCents),
    liabilitiesCents:
      Number(r.creditCardDebtCents) +
      Number(r.loanDebtCents) +
      Number(r.manualLiabilitiesCents)
  }));
}

// ---------------------------------------------------------------------------
// Manual asset / liability CRUD
// ---------------------------------------------------------------------------

export async function upsertManualItem(args: {
  userId: string;
  id?: string;
  kind: "asset" | "liability";
  category: string;
  label: string;
  amountCents: number;
  notes?: string | null;
}) {
  if (args.id) {
    return prisma.manualAssetLiability.updateMany({
      where: { id: args.id, userId: args.userId },
      data: {
        kind: args.kind,
        category: args.category,
        label: args.label.slice(0, 200),
        amountCents: BigInt(Math.max(0, Math.round(args.amountCents))),
        notes: args.notes ?? null
      }
    });
  }
  return prisma.manualAssetLiability.create({
    data: {
      userId: args.userId,
      kind: args.kind,
      category: args.category,
      label: args.label.slice(0, 200),
      amountCents: BigInt(Math.max(0, Math.round(args.amountCents))),
      notes: args.notes ?? null
    }
  });
}

export async function deleteManualItem(args: {
  userId: string;
  id: string;
}) {
  return prisma.manualAssetLiability.deleteMany({
    where: { id: args.id, userId: args.userId }
  });
}

/**
 * Month-over-month delta: compares today's net worth to the snapshot
 * taken closest to 30 days ago.
 */
export async function getMonthOverMonthDelta(userId: string): Promise<{
  currentCents: number;
  priorCents: number | null;
  deltaCents: number | null;
  priorDate: string | null;
}> {
  const current = await computeNetWorthNow(userId);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const prior = await prisma.netWorthSnapshot.findFirst({
    where: { userId, snapshotDate: { lte: thirtyDaysAgo } },
    orderBy: { snapshotDate: "desc" }
  });
  return {
    currentCents: current.netWorthCents,
    priorCents: prior ? Number(prior.netWorthCents) : null,
    deltaCents: prior ? current.netWorthCents - Number(prior.netWorthCents) : null,
    priorDate: prior ? prior.snapshotDate.toISOString().slice(0, 10) : null
  };
}

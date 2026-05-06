import { prisma } from "@portfolio/db";
import { getOrCreateDefaultUser } from "./user";
import { getCashflowSummary } from "./cashflow-summary";
import { getInvestmentsSummary } from "./investments";

export type OverviewSnapshot = {
  netWorth: number;
  bankAssets: number;
  liabilities: number;
  investmentBalance: number;
  accountCount: number;
  week: {
    income: number;
    spent: number;
    net: number;
    source: string | null;
  };
  needsReviewCount: number;
};

/**
 * Compute the overview-tab headline figures for the session user.
 * Pure Prisma (no LLM) so this stays cheap. Called from both the
 * /overview server component and the /api/overview/snapshot route so
 * a client-side refresh sees the same numbers.
 */
export async function computeOverviewSnapshot(): Promise<OverviewSnapshot> {
  const sessionUser = await getOrCreateDefaultUser();
  const userId = sessionUser.id;

  // Net worth: bank assets − liabilities + investment balance.
  // Excludes accounts flagged with excludeFromNetWorth (e.g. unvested RSUs).
  const accounts = await prisma.account.findMany({
    where: { userId, isActive: true, excludeFromNetWorth: false },
    select: { type: true, subtype: true, currentBalance: true }
  });

  let bankAssets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const balance = Number(a.currentBalance ?? 0);
    if (a.type === "credit" || a.type === "loan") {
      liabilities += balance;
    } else if (a.type === "investment") {
      // Counted in investmentsSummary below (both Plaid-side + ManualInvestment*).
    } else {
      bankAssets += balance;
    }
  }

  const investmentsSummary = await getInvestmentsSummary();
  const investmentBalance = Number(
    investmentsSummary.totals.totalBalance ?? 0
  );
  const netWorth = bankAssets + investmentBalance - liabilities;

  const cashflow = await getCashflowSummary(3);
  const latest = cashflow.latestMonth;
  const weekIncome = latest ? Number(latest.income ?? 0) / 4 : 0;
  const weekSpent = latest ? Number(latest.spending ?? 0) / 4 : 0;
  const weekNet = weekIncome - weekSpent;

  const needsReviewCount = await prisma.transaction.count({
    where: {
      userId,
      reviewStatus: { in: ["uncategorized", "auto_categorized"] }
    }
  });

  return {
    netWorth,
    bankAssets,
    liabilities,
    investmentBalance,
    accountCount: accounts.length,
    week: {
      income: weekIncome,
      spent: weekSpent,
      net: weekNet,
      source: latest ? latest.label : null
    },
    needsReviewCount
  };
}

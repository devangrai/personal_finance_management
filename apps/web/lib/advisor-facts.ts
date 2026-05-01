import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";
import { getCashflowSummary } from "./cashflow-summary";
import { getOrCreateUserProfile } from "./profile";
import { getRecurringSummary } from "./recurring-summary";

export type AdvisorFactsSnapshot = {
  averageMonthlyIncome: string;
  averageMonthlySpending: string;
  averageMonthlyInvesting: string;
  averageMonthlyNetCashflow: string;
  averageMonthlyFreeCashflow: string;
  averageMonthlyRecurringIncome: string;
  averageMonthlyRecurringOutflows: string;
  reviewedSpendCoveragePercent: string;
  liquidCashBalance: string;
  emergencyFundTarget: string;
  emergencyFundRunwayMonths: string;
  housingStatus: "rent_free" | "rent" | "mortgage" | "other";
  biweeklyNetPay: string | null;
  monthlyFixedExpense: string;
};

export type AdvisorFactsComputation = {
  averageMonthlyIncomeCents: number;
  averageMonthlyInvestingCents: number;
  averageMonthlyNetCashflowCents: number;
  averageMonthlyRecurringIncomeCents: number;
  averageMonthlyRecurringOutflowsCents: number;
  averageMonthlySpendingCents: number;
  biweeklyNetPayCents: number;
  emergencyFundTargetCents: number;
  emergencyFundRunwayMonths: number;
  housingStatus: "rent_free" | "rent" | "mortgage" | "other";
  liquidCashBalanceCents: number;
  monthlyCoreExpenseCents: number;
  monthlyFixedExpenseCents: number;
  reviewedCoveragePercent: number;
};

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function decimalStringToCents(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  return Math.round(Number(value) * 100);
}

function centsToDollarsString(value: number) {
  return (value / 100).toFixed(2);
}

function monthlyizeRecurringAmount(amount: string, frequency: string) {
  const cents = decimalStringToCents(amount);

  switch (frequency) {
    case "weekly":
      return Math.round((cents * 52) / 12);
    case "biweekly":
      return Math.round((cents * 26) / 12);
    case "quarterly":
      return Math.round((cents * 4) / 12);
    case "monthly":
      return cents;
    default:
      return 0;
  }
}

function buildAdvisorFactsSnapshot(
  facts: AdvisorFactsComputation
): AdvisorFactsSnapshot {
  return {
    averageMonthlyIncome: centsToDollarsString(facts.averageMonthlyIncomeCents),
    averageMonthlySpending: centsToDollarsString(
      facts.averageMonthlySpendingCents
    ),
    averageMonthlyInvesting: centsToDollarsString(
      facts.averageMonthlyInvestingCents
    ),
    averageMonthlyNetCashflow: centsToDollarsString(
      facts.averageMonthlyNetCashflowCents
    ),
    averageMonthlyFreeCashflow: centsToDollarsString(
      facts.averageMonthlyIncomeCents -
        facts.monthlyFixedExpenseCents -
        facts.averageMonthlySpendingCents
    ),
    averageMonthlyRecurringIncome: centsToDollarsString(
      facts.averageMonthlyRecurringIncomeCents
    ),
    averageMonthlyRecurringOutflows: centsToDollarsString(
      facts.averageMonthlyRecurringOutflowsCents
    ),
    reviewedSpendCoveragePercent: facts.reviewedCoveragePercent.toFixed(0),
    liquidCashBalance: centsToDollarsString(facts.liquidCashBalanceCents),
    emergencyFundTarget: centsToDollarsString(facts.emergencyFundTargetCents),
    emergencyFundRunwayMonths: facts.emergencyFundRunwayMonths.toFixed(1),
    housingStatus: facts.housingStatus,
    biweeklyNetPay:
      facts.biweeklyNetPayCents > 0
        ? centsToDollarsString(facts.biweeklyNetPayCents)
        : null,
    monthlyFixedExpense: centsToDollarsString(facts.monthlyFixedExpenseCents)
  };
}

export async function getAdvisorFactsComputation(): Promise<AdvisorFactsComputation> {
  const userId = await getDefaultUserId();
  const [profile, cashflow, recurringSummary, accounts] = await Promise.all([
    getOrCreateUserProfile(),
    getCashflowSummary(3),
    getRecurringSummary(),
    prisma.account.findMany({
      where: {
        userId,
        isActive: true,
        type: "depository"
      },
      select: {
        currentBalance: true
      }
    })
  ]);

  const averageMonthlyIncomeCents = average(
    cashflow.months.map((month) => decimalStringToCents(month.income))
  );
  const averageMonthlySpendingCents = average(
    cashflow.months.map((month) => decimalStringToCents(month.spending))
  );
  const averageMonthlyInvestingCents = average(
    cashflow.months.map((month) => decimalStringToCents(month.investing))
  );
  const averageMonthlyNetCashflowCents = average(
    cashflow.months.map((month) => decimalStringToCents(month.netCashflow))
  );
  const reviewedCoveragePercent =
    cashflow.latestMonth !== null
      ? Number((cashflow.latestMonth.reviewedSpendRatioBps / 100).toFixed(0))
      : 0;
  const averageMonthlyRecurringIncomeCents = recurringSummary.inflows.reduce(
    (sum, inflow) => sum + monthlyizeRecurringAmount(inflow.averageAmount, inflow.frequency),
    0
  );
  const averageMonthlyRecurringOutflowsCents = recurringSummary.outflows.reduce(
    (sum, outflow) =>
      sum + monthlyizeRecurringAmount(outflow.averageAmount, outflow.frequency),
    0
  );
  const liquidCashBalanceCents = accounts.reduce(
    (sum, account) => sum + decimalStringToCents(account.currentBalance?.toString()),
    0
  );
  const monthlyFixedExpenseCents = decimalStringToCents(profile.monthlyFixedExpense);
  const emergencyFundTargetCents = decimalStringToCents(profile.emergencyFundTarget);
  const biweeklyNetPayCents = decimalStringToCents(profile.biweeklyNetPay);
  const monthlyCoreExpenseCents =
    monthlyFixedExpenseCents + averageMonthlySpendingCents;
  const emergencyFundRunwayMonths =
    monthlyCoreExpenseCents > 0
      ? liquidCashBalanceCents / monthlyCoreExpenseCents
      : 0;

  return {
    averageMonthlyIncomeCents,
    averageMonthlyInvestingCents,
    averageMonthlyNetCashflowCents,
    averageMonthlyRecurringIncomeCents,
    averageMonthlyRecurringOutflowsCents,
    averageMonthlySpendingCents,
    biweeklyNetPayCents,
    emergencyFundTargetCents,
    emergencyFundRunwayMonths,
    housingStatus: profile.housingStatus,
    liquidCashBalanceCents,
    monthlyCoreExpenseCents,
    monthlyFixedExpenseCents,
    reviewedCoveragePercent
  };
}

export async function getAdvisorFactsSnapshot(): Promise<AdvisorFactsSnapshot> {
  return buildAdvisorFactsSnapshot(await getAdvisorFactsComputation());
}

export function snapshotAdvisorFacts(
  facts: AdvisorFactsComputation
): AdvisorFactsSnapshot {
  return buildAdvisorFactsSnapshot(facts);
}

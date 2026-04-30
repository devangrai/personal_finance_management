import { prisma } from "@portfolio/db";
import { recommendBiweeklyRetirementContribution } from "@portfolio/finance-core";
import { getCashflowSummary } from "./cashflow-summary";
import { getDefaultUserId } from "./categories";
import { getOrCreateUserProfile } from "./profile";

type RetirementRecommendationPayload = {
  recommendation: {
    recommendedBiweeklyContribution: string;
    reasoning: string[];
    assumptions: string[];
    targetSavingsRatePercent: string | null;
  } | null;
  inputs: {
    biweeklyNetPay: string | null;
    monthlyFixedExpense: string;
    averageVariableMonthlyExpense: string;
    emergencyFundTarget: string;
    housingStatus: string;
  };
  missingFields: string[];
};

function decimalStringToCents(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  return Math.round(Number(value) * 100);
}

function centsToDollarsString(value: number) {
  return (value / 100).toFixed(2);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function buildAssumptions(input: {
  housingStatus: string;
  averageVariableMonthlyExpenseCents: number;
  monthlyFixedExpenseCents: number;
  targetSavingsBufferCents: number;
}) {
  const assumptions = [
    "Variable spending is based on the recent reviewed monthly average.",
    "Transfers and saving/investing flows are excluded from spend before the recommendation is calculated."
  ];

  if (input.housingStatus === "rent_free") {
    assumptions.push(
      "The profile is marked rent-free, so the recommendation leans on lower fixed housing costs."
    );
  }

  if (input.targetSavingsBufferCents <= 0) {
    assumptions.push(
      "No emergency-fund reserve target is set yet, so all free cash flow is considered deployable."
    );
  }

  if (input.monthlyFixedExpenseCents <= 0) {
    assumptions.push(
      "Monthly fixed expenses are unset, so the recommendation only subtracts observed variable spending."
    );
  }

  if (input.averageVariableMonthlyExpenseCents <= 0) {
    assumptions.push(
      "Recent categorized variable spending is low or missing, so treat this recommendation as optimistic."
    );
  }

  return assumptions;
}

export async function getRetirementContributionRecommendation() {
  const userId = await getDefaultUserId();
  const profile = await getOrCreateUserProfile();
  const cashflow = await getCashflowSummary(3);

  const averageVariableMonthlyExpenseCents = average(
    cashflow.months.map((month) => decimalStringToCents(month.spending))
  );
  const monthlyFixedExpenseCents = decimalStringToCents(profile.monthlyFixedExpense);
  const targetSavingsBufferCents = decimalStringToCents(profile.emergencyFundTarget);
  const biweeklyNetPayCents = profile.biweeklyNetPay
    ? decimalStringToCents(profile.biweeklyNetPay)
    : 0;
  const missingFields: string[] = [];

  if (!profile.biweeklyNetPay) {
    missingFields.push("biweekly net pay");
  }

  let recommendation: RetirementRecommendationPayload["recommendation"] = null;

  if (missingFields.length === 0) {
    const result = recommendBiweeklyRetirementContribution({
      biweeklyNetPayCents,
      fixedMonthlyExpenseCents: monthlyFixedExpenseCents,
      averageVariableMonthlyExpenseCents,
      existingRetirementContributionBps: 0,
      targetSavingsBufferCents
    });

    const assumptions = buildAssumptions({
      housingStatus: profile.housingStatus,
      averageVariableMonthlyExpenseCents,
      monthlyFixedExpenseCents,
      targetSavingsBufferCents
    });

    recommendation = {
      recommendedBiweeklyContribution: centsToDollarsString(
        result.recommendedBiweeklyRetirementContributionCents
      ),
      reasoning: result.reasoning,
      assumptions,
      targetSavingsRatePercent: profile.targetRetirementSavingsRate
    };

    await prisma.recommendationRun.create({
      data: {
        userId,
        type: "retirement",
        status: "succeeded",
        inputSnapshot: {
          biweeklyNetPay: profile.biweeklyNetPay,
          monthlyFixedExpense: profile.monthlyFixedExpense,
          averageVariableMonthlyExpense: centsToDollarsString(
            averageVariableMonthlyExpenseCents
          ),
          emergencyFundTarget: profile.emergencyFundTarget,
          housingStatus: profile.housingStatus
        },
        outputPayload: recommendation
      }
    });
  }

  return {
    recommendation,
    inputs: {
      biweeklyNetPay: profile.biweeklyNetPay,
      monthlyFixedExpense: centsToDollarsString(monthlyFixedExpenseCents),
      averageVariableMonthlyExpense: centsToDollarsString(
        averageVariableMonthlyExpenseCents
      ),
      emergencyFundTarget: centsToDollarsString(targetSavingsBufferCents),
      housingStatus: profile.housingStatus
    },
    missingFields
  } satisfies RetirementRecommendationPayload;
}

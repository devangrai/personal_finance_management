import { getAdvisorPlanSnapshot } from "./advisor-plan";

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
    observedMonthlyOutflows: string;
    emergencyFundTarget: string;
    housingStatus: string;
  };
  missingFields: string[];
};

export async function getRetirementContributionRecommendation(): Promise<RetirementRecommendationPayload> {
  const plan = await getAdvisorPlanSnapshot();

  return {
    recommendation: plan.retirement.recommendedBiweeklyContribution
      ? {
          recommendedBiweeklyContribution:
            plan.retirement.recommendedBiweeklyContribution,
          reasoning: plan.retirement.reasoning,
          assumptions: plan.retirement.assumptions,
          targetSavingsRatePercent: plan.retirement.targetSavingsRatePercent
        }
      : null,
    inputs: {
      biweeklyNetPay: plan.facts.biweeklyNetPay,
      monthlyFixedExpense: plan.facts.monthlyFixedExpense,
      observedMonthlyOutflows: (
        Number(plan.facts.averageMonthlySpending) +
        Number(plan.facts.averageMonthlyInvesting)
      ).toFixed(2),
      emergencyFundTarget: plan.facts.emergencyFundTarget,
      housingStatus: plan.facts.housingStatus
    },
    missingFields: plan.retirement.missingFields
  };
}

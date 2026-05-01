import { getAdvisorPlanSnapshot } from "./advisor-plan";

type RetirementRecommendationPayload = {
  recommendation: {
    recommendedBiweeklyContribution: string | null;
    currentObservedBiweeklyContribution: string | null;
    deltaFromObservedContribution: string | null;
    observedTakeHomeRetirementRatePercent: string | null;
    status: "below_target" | "on_track" | "aggressive" | "insufficient_data";
    statusHeadline: string;
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
    recommendation: {
      recommendedBiweeklyContribution:
        plan.retirement.recommendedBiweeklyContribution,
      currentObservedBiweeklyContribution:
        plan.retirement.currentObservedBiweeklyContribution,
      deltaFromObservedContribution:
        plan.retirement.deltaFromObservedContribution,
      observedTakeHomeRetirementRatePercent:
        plan.retirement.observedTakeHomeRetirementRatePercent,
      status: plan.retirement.status,
      statusHeadline: plan.retirement.statusHeadline,
      reasoning: plan.retirement.reasoning,
      assumptions: plan.retirement.assumptions,
      targetSavingsRatePercent: plan.retirement.targetSavingsRatePercent
    },
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

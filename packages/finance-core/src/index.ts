export type CashFlowSnapshot = {
  month: string;
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
};

export type ContributionRecommendationInput = {
  biweeklyNetPayCents: number;
  fixedMonthlyExpenseCents: number;
  averageVariableMonthlyExpenseCents: number;
  existingRetirementContributionBps: number;
  targetSavingsBufferCents: number;
};

export type ContributionRecommendation = {
  recommendedBiweeklyRetirementContributionCents: number;
  reasoning: string[];
};

export function recommendBiweeklyRetirementContribution(
  input: ContributionRecommendationInput
): ContributionRecommendation {
  const estimatedMonthlyNet =
    Math.round((input.biweeklyNetPayCents * 26) / 12);
  const availableMonthlyCash =
    estimatedMonthlyNet -
    input.fixedMonthlyExpenseCents -
    input.averageVariableMonthlyExpenseCents;

  const reservableMonthlyCash = Math.max(
    availableMonthlyCash - input.targetSavingsBufferCents,
    0
  );
  const recommendedBiweeklyRetirementContributionCents = Math.round(
    (reservableMonthlyCash * 12) / 26
  );

  return {
    recommendedBiweeklyRetirementContributionCents,
    reasoning: [
      "Recommendation is constrained by observed monthly free cash flow.",
      "The target savings buffer is preserved before retirement contribution increases."
    ]
  };
}

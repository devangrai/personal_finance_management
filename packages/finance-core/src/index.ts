export type CashFlowSnapshot = {
  month: string;
  incomeCents: number;
  expenseCents: number;
  savingsCents: number;
};

export type HousingStatus = "rent_free" | "rent" | "mortgage" | "other";

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

export type EmergencyFundRecommendationInput = {
  currentLiquidSavingsCents: number;
  existingEmergencyFundTargetCents?: number | null;
  housingStatus: HousingStatus;
  monthlyCoreExpenseCents: number;
};

export type EmergencyFundRecommendation = {
  currentLiquidSavingsCents: number;
  recommendedTargetCents: number;
  runwayMonths: number;
  shortfallCents: number;
  targetMonths: number;
  reasoning: string[];
};

export type PaycheckAllocationScenarioInput = {
  averageVariableMonthlyExpenseCents: number;
  biweeklyNetPayCents: number;
  emergencyFundShortfallCents: number;
  fixedMonthlyExpenseCents: number;
};

export type PaycheckAllocationScenario = {
  key: "conservative" | "balanced" | "aggressive";
  label: string;
  biweeklyAmounts: {
    retirementCents: number;
    emergencyFundCents: number;
    taxableInvestingCents: number;
    reserveCents: number;
  };
  reasoning: string[];
};

export type PaycheckAllocationPlan = {
  availableBiweeklySurplusCents: number;
  monthlyFreeCashflowCents: number;
  scenarios: PaycheckAllocationScenario[];
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

function getEmergencyFundTargetMonths(housingStatus: HousingStatus) {
  switch (housingStatus) {
    case "rent_free":
      return 3;
    case "rent":
    case "mortgage":
      return 6;
    default:
      return 4;
  }
}

function monthlyToBiweeklyCents(monthlyCents: number) {
  return Math.round((monthlyCents * 12) / 26);
}

export function recommendEmergencyFundTarget(
  input: EmergencyFundRecommendationInput
): EmergencyFundRecommendation {
  const targetMonths = getEmergencyFundTargetMonths(input.housingStatus);
  const recommendedTargetCents =
    input.existingEmergencyFundTargetCents && input.existingEmergencyFundTargetCents > 0
      ? input.existingEmergencyFundTargetCents
      : input.monthlyCoreExpenseCents * targetMonths;
  const shortfallCents = Math.max(
    recommendedTargetCents - input.currentLiquidSavingsCents,
    0
  );
  const runwayMonths =
    input.monthlyCoreExpenseCents > 0
      ? Number(
          (input.currentLiquidSavingsCents / input.monthlyCoreExpenseCents).toFixed(1)
        )
      : 0;

  return {
    currentLiquidSavingsCents: input.currentLiquidSavingsCents,
    recommendedTargetCents,
    runwayMonths,
    shortfallCents,
    targetMonths,
    reasoning: [
      "Emergency fund sizing is anchored to core monthly expenses.",
      input.existingEmergencyFundTargetCents && input.existingEmergencyFundTargetCents > 0
        ? "A saved emergency-fund target was used instead of the default housing-based target."
        : "The default target months are based on housing status."
    ]
  };
}

export function buildPaycheckAllocationPlan(
  input: PaycheckAllocationScenarioInput
): PaycheckAllocationPlan {
  const monthlyFreeCashflowCents =
    Math.round((input.biweeklyNetPayCents * 26) / 12) -
    input.fixedMonthlyExpenseCents -
    input.averageVariableMonthlyExpenseCents;
  const availableBiweeklySurplusCents = Math.max(
    monthlyToBiweeklyCents(monthlyFreeCashflowCents),
    0
  );
  const recommendedEmergencyMonthlyTopUpCents = Math.min(
    input.emergencyFundShortfallCents,
    Math.max(Math.round(monthlyFreeCashflowCents * 0.3), 0)
  );
  const recommendedEmergencyBiweeklyCents = Math.min(
    monthlyToBiweeklyCents(recommendedEmergencyMonthlyTopUpCents),
    availableBiweeklySurplusCents
  );
  const remainingBiweeklyCents = Math.max(
    availableBiweeklySurplusCents - recommendedEmergencyBiweeklyCents,
    0
  );

  const scenarioTemplates: Array<{
    key: PaycheckAllocationScenario["key"];
    label: string;
    retirementShareBps: number;
    investingShareBps: number;
    reserveShareBps: number;
  }> = [
    {
      key: "conservative",
      label: "Conservative",
      retirementShareBps: 3500,
      investingShareBps: 500,
      reserveShareBps: 6000
    },
    {
      key: "balanced",
      label: "Balanced",
      retirementShareBps: 5500,
      investingShareBps: 1500,
      reserveShareBps: 3000
    },
    {
      key: "aggressive",
      label: "Aggressive",
      retirementShareBps: 7000,
      investingShareBps: 2000,
      reserveShareBps: 1000
    }
  ];

  const scenarios = scenarioTemplates.map((scenario) => {
    const retirementCents = Math.round(
      (remainingBiweeklyCents * scenario.retirementShareBps) / 10000
    );
    const taxableInvestingCents = Math.round(
      (remainingBiweeklyCents * scenario.investingShareBps) / 10000
    );
    const reserveCents = Math.max(
      remainingBiweeklyCents - retirementCents - taxableInvestingCents,
      0
    );

    return {
      key: scenario.key,
      label: scenario.label,
      biweeklyAmounts: {
        retirementCents,
        emergencyFundCents: recommendedEmergencyBiweeklyCents,
        taxableInvestingCents,
        reserveCents
      },
      reasoning: [
        "Emergency-fund top-ups are funded first when a shortfall exists.",
        scenario.key === "conservative"
          ? "This option preserves the largest paycheck buffer."
          : scenario.key === "balanced"
            ? "This option splits surplus between retirement growth and flexibility."
            : "This option prioritizes retirement and taxable investing over extra buffer."
      ]
    } satisfies PaycheckAllocationScenario;
  });

  return {
    availableBiweeklySurplusCents,
    monthlyFreeCashflowCents,
    scenarios
  };
}

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
  monthlyFreeCashflowOverrideCents?: number | null;
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

export type ObservedRetirementPositionInput = {
  currentBiweeklyRetirementContributionCents: number;
  targetBiweeklyRetirementContributionCents?: number | null;
  takeHomeBaselineBiweeklyCents?: number | null;
  targetRetirementSavingsRatePercent?: number | null;
  emergencyFundShortfallCents: number;
};

export type ObservedRetirementPosition = {
  status: "below_target" | "on_track" | "aggressive" | "insufficient_data";
  headline: string;
  reasoning: string[];
  currentTakeHomeSavingsRateBps: number | null;
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
    input.monthlyFreeCashflowOverrideCents != null
      ? input.monthlyFreeCashflowOverrideCents
      : Math.round((input.biweeklyNetPayCents * 26) / 12) -
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

export function assessObservedRetirementPosition(
  input: ObservedRetirementPositionInput
): ObservedRetirementPosition {
  const currentTakeHomeSavingsRateBps =
    input.takeHomeBaselineBiweeklyCents && input.takeHomeBaselineBiweeklyCents > 0
      ? Math.round(
          (input.currentBiweeklyRetirementContributionCents /
            input.takeHomeBaselineBiweeklyCents) *
            10000
        )
      : null;
  const targetRateBps =
    input.targetRetirementSavingsRatePercent != null &&
    Number.isFinite(input.targetRetirementSavingsRatePercent)
      ? Math.round(input.targetRetirementSavingsRatePercent * 100)
      : null;

  if (input.currentBiweeklyRetirementContributionCents <= 0) {
    return {
      status: "below_target",
      headline: "No recurring retirement contribution flow has been detected yet.",
      reasoning: [
        "The imported investment data does not show a positive recurring retirement contribution in the recent pay cycles."
      ],
      currentTakeHomeSavingsRateBps
    };
  }

  if (
    input.targetBiweeklyRetirementContributionCents != null &&
    input.targetBiweeklyRetirementContributionCents > 0
  ) {
    const ratio =
      input.currentBiweeklyRetirementContributionCents /
      input.targetBiweeklyRetirementContributionCents;

    if (
      ratio > 1.2 &&
      input.emergencyFundShortfallCents > 0
    ) {
      return {
        status: "aggressive",
        headline:
          "Current retirement contributions are running above the modeled target while cash-buffer work remains.",
        reasoning: [
          "Observed retirement contributions are more than 20% above the modeled target.",
          "That can still be intentional, but it is aggressive while the emergency fund is below target."
        ],
        currentTakeHomeSavingsRateBps
      };
    }

    if (ratio < 0.85) {
      return {
        status: "below_target",
        headline:
          "Current retirement contributions are below the modeled paycheck target.",
        reasoning: [
          "Observed retirement contributions are more than 15% below the modeled target.",
          "Increasing the contribution gradually would move the observed flow closer to the plan."
        ],
        currentTakeHomeSavingsRateBps
      };
    }

    return {
      status: "on_track",
      headline:
        "Current retirement contributions are broadly in line with the modeled paycheck target.",
      reasoning: [
        "Observed retirement contributions are within a reasonable band of the modeled target."
      ],
      currentTakeHomeSavingsRateBps
    };
  }

  if (targetRateBps != null && currentTakeHomeSavingsRateBps != null) {
    if (currentTakeHomeSavingsRateBps < Math.round(targetRateBps * 0.85)) {
      return {
        status: "below_target",
        headline:
          "Observed retirement contributions are below the saved savings-rate target.",
        reasoning: [
          "The current observed retirement flow is below 85% of the target take-home savings rate."
        ],
        currentTakeHomeSavingsRateBps
      };
    }

    if (
      currentTakeHomeSavingsRateBps > Math.round(targetRateBps * 1.25) &&
      input.emergencyFundShortfallCents > 0
    ) {
      return {
        status: "aggressive",
        headline:
          "Observed retirement contributions are above the saved savings-rate target while liquidity is still catching up.",
        reasoning: [
          "The current observed retirement flow is more than 25% above the target take-home savings rate.",
          "That suggests the contribution pace is aggressive relative to the cash-buffer goal."
        ],
        currentTakeHomeSavingsRateBps
      };
    }

    return {
      status: "on_track",
      headline:
        "Observed retirement contributions are reasonably aligned with the saved savings-rate target.",
      reasoning: [
        "The current observed retirement flow is close to the target take-home savings rate."
      ],
      currentTakeHomeSavingsRateBps
    };
  }

  return {
    status: "insufficient_data",
    headline:
      "Observed retirement contributions are available, but there is not enough profile context to grade them yet.",
    reasoning: [
      "Add a target retirement savings rate or keep using the modeled paycheck target to make this assessment sharper."
    ],
    currentTakeHomeSavingsRateBps
  };
}

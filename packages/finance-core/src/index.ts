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
  /**
   * Observed biweekly traditional (pre-tax) 401(k) contribution. Used with
   * take-home to estimate annual gross income when a saved annual gross is
   * not available.
   */
  observedBiweeklyTraditional401kContributionCents?: number | null;
  /**
   * Profile-saved annual gross income. When provided, overrides the
   * take-home-plus-pre-tax estimate.
   */
  annualGrossIncomeCents?: number | null;
};

export type ObservedRetirementPosition = {
  status: "below_target" | "on_track" | "aggressive" | "insufficient_data";
  headline: string;
  reasoning: string[];
  currentTakeHomeSavingsRateBps: number | null;
  /**
   * Observed annual retirement savings rate as a fraction of estimated gross
   * income, in basis points (e.g. 1500 = 15.00%). Null when gross cannot be
   * estimated.
   */
  currentGrossSavingsRateBps: number | null;
  /**
   * Which anchor the status decision used: "saved_target" (explicit
   * user-provided biweekly target), "saved_rate" (explicit saved
   * take-home-rate target), "gross_rule_of_thumb" (industry-standard
   * 15%-of-gross anchor), or "none" (fell through to insufficient_data).
   */
  gradedBy: "saved_target" | "saved_rate" | "gross_rule_of_thumb" | "none";
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

/**
 * Estimate annual gross income in cents.
 *
 * Preference order:
 *   1. Explicit saved `annualGrossIncomeCents` (profile value).
 *   2. Conservative estimate from observed take-home + observed traditional
 *      401(k) contribution. This ignores other pre-tax deductions we cannot
 *      observe (health insurance, HSA, FSA, commuter, etc.), so the
 *      estimate is a *floor* and the resulting gross-rate is an *upper bound*.
 *   3. Null when neither input is available.
 */
export function estimateAnnualGrossIncomeCents(input: {
  annualGrossIncomeCents?: number | null;
  biweeklyNetPayCents?: number | null;
  biweeklyTraditional401kContributionCents?: number | null;
}) {
  if (
    input.annualGrossIncomeCents != null &&
    Number.isFinite(input.annualGrossIncomeCents) &&
    input.annualGrossIncomeCents > 0
  ) {
    return input.annualGrossIncomeCents;
  }

  const net = input.biweeklyNetPayCents ?? 0;
  const preTax = input.biweeklyTraditional401kContributionCents ?? 0;
  if (net <= 0) {
    return null;
  }

  // Conservative floor: 26 biweekly periods × (take-home + traditional 401k).
  // This deliberately understates gross because it omits tax withholding and
  // other pre-tax deductions. Downstream rate calculations use this floor,
  // so the computed *rate* is intentionally biased slightly high, which
  // produces "generous" grading when the saved gross is not available.
  return (net + preTax) * 26;
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

  const estimatedAnnualGrossCents = estimateAnnualGrossIncomeCents({
    annualGrossIncomeCents: input.annualGrossIncomeCents,
    biweeklyNetPayCents: input.takeHomeBaselineBiweeklyCents,
    biweeklyTraditional401kContributionCents:
      input.observedBiweeklyTraditional401kContributionCents
  });
  const annualRetirementContributionCents =
    input.currentBiweeklyRetirementContributionCents * 26;
  const currentGrossSavingsRateBps =
    estimatedAnnualGrossCents && estimatedAnnualGrossCents > 0
      ? Math.round(
          (annualRetirementContributionCents / estimatedAnnualGrossCents) * 10000
        )
      : null;

  const targetRateBps =
    input.targetRetirementSavingsRatePercent != null &&
    Number.isFinite(input.targetRetirementSavingsRatePercent)
      ? Math.round(input.targetRetirementSavingsRatePercent * 100)
      : null;

  // --- Cold case: no observed contributions at all. ---
  if (input.currentBiweeklyRetirementContributionCents <= 0) {
    return {
      status: "below_target",
      headline: "No recurring retirement contribution flow has been detected yet.",
      reasoning: [
        "The imported investment data does not show a positive recurring retirement contribution in the recent pay cycles."
      ],
      currentTakeHomeSavingsRateBps,
      currentGrossSavingsRateBps,
      gradedBy: "none"
    };
  }

  // --- Branch 1: explicit saved biweekly target (most specific). ---
  if (
    input.targetBiweeklyRetirementContributionCents != null &&
    input.targetBiweeklyRetirementContributionCents > 0
  ) {
    const ratio =
      input.currentBiweeklyRetirementContributionCents /
      input.targetBiweeklyRetirementContributionCents;

    if (ratio > 1.2 && input.emergencyFundShortfallCents > 0) {
      return {
        status: "aggressive",
        headline:
          "Current retirement contributions are running above the modeled target while cash-buffer work remains.",
        reasoning: [
          "Observed retirement contributions are more than 20% above the modeled target.",
          "That can still be intentional, but it is aggressive while the emergency fund is below target."
        ],
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "saved_target"
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
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "saved_target"
      };
    }

    return {
      status: "on_track",
      headline:
        "Current retirement contributions are broadly in line with the modeled paycheck target.",
      reasoning: [
        "Observed retirement contributions are within a reasonable band of the modeled target."
      ],
      currentTakeHomeSavingsRateBps,
      currentGrossSavingsRateBps,
      gradedBy: "saved_target"
    };
  }

  // --- Branch 2: explicit saved target savings rate (profile). ---
  if (targetRateBps != null && currentTakeHomeSavingsRateBps != null) {
    if (currentTakeHomeSavingsRateBps < Math.round(targetRateBps * 0.85)) {
      return {
        status: "below_target",
        headline:
          "Observed retirement contributions are below the saved savings-rate target.",
        reasoning: [
          "The current observed retirement flow is below 85% of the target take-home savings rate."
        ],
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "saved_rate"
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
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "saved_rate"
      };
    }

    return {
      status: "on_track",
      headline:
        "Observed retirement contributions are reasonably aligned with the saved savings-rate target.",
      reasoning: [
        "The current observed retirement flow is close to the target take-home savings rate."
      ],
      currentTakeHomeSavingsRateBps,
      currentGrossSavingsRateBps,
      gradedBy: "saved_rate"
    };
  }

  // --- Branch 3: rule-of-thumb grading anchored at 15% of gross. ---
  // Rationale: Fidelity's published savings guideline is 15% of gross
  // (including employer match) starting at age 25, to retire at 67.
  // T. Rowe Price publishes the same 15% number. Vanguard's "How America
  // Saves" 2024 shows median total savings rate of ~13%, median for
  // higher-income tiers rises toward 18% with match.
  //
  // Because we observe employee-only contributions (no employer match
  // visibility) and our gross estimate is a floor (see
  // estimateAnnualGrossIncomeCents), the computed rate is biased slightly
  // high. Thresholds are therefore slightly stricter than a true 15%
  // anchor to compensate:
  //   - >= 25% -> aggressive-or-on-track depending on emergency fund
  //   - 12-25% -> on_track (centered on 15%; band ~±3%)
  //   - 8-12%  -> below_target (ballpark but below common guidance)
  //   - < 8%   -> below_target (well below common guidance)
  if (currentGrossSavingsRateBps != null) {
    const grossRatePercent = currentGrossSavingsRateBps / 100;
    const sourceNote =
      input.annualGrossIncomeCents && input.annualGrossIncomeCents > 0
        ? "Gross income comes from the saved profile."
        : "Gross income is estimated conservatively from take-home plus observed pre-tax 401(k); real gross is likely higher, so this rate is an upper bound.";
    const guidanceAnchor =
      "Industry-standard guidance (Fidelity, T. Rowe Price, Vanguard) anchors around 15% of gross including employer match. This rate excludes the match and may under-count it.";

    if (
      currentGrossSavingsRateBps >= 2500 &&
      input.emergencyFundShortfallCents > 0
    ) {
      return {
        status: "aggressive",
        headline: `Observed retirement rate is about ${grossRatePercent.toFixed(1)}% of estimated gross, above the 15% baseline while the emergency fund is still below target.`,
        reasoning: [
          guidanceAnchor,
          "Being well above the 15% baseline can still be right, but with the cash buffer behind target the usual advice is to shore up liquidity before adding retirement rate.",
          sourceNote
        ],
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "gross_rule_of_thumb"
      };
    }

    if (currentGrossSavingsRateBps >= 1200) {
      const bandDescriptor =
        currentGrossSavingsRateBps >= 2500
          ? "well above the typical 10-15% baseline"
          : currentGrossSavingsRateBps >= 1800
            ? "above the typical 10-15% baseline"
            : "inside the typical 12-25% band around Fidelity's 15% target";
      return {
        status: "on_track",
        headline: `Observed retirement rate is about ${grossRatePercent.toFixed(1)}% of estimated gross, ${bandDescriptor}.`,
        reasoning: [
          guidanceAnchor,
          currentGrossSavingsRateBps >= 2500
            ? "Saving well above the baseline is still coherent here because the emergency fund is not flagged as below target."
            : "This observed rate sits inside the typical 12-25% band that covers Fidelity's 15% target with a margin on either side.",
          sourceNote
        ],
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "gross_rule_of_thumb"
      };
    }

    if (currentGrossSavingsRateBps >= 800) {
      return {
        status: "below_target",
        headline: `Observed retirement rate is about ${grossRatePercent.toFixed(1)}% of estimated gross, ballpark but below common 10-15% guidance.`,
        reasoning: [
          guidanceAnchor,
          "Saving in this ballpark is meaningful, but a gradual increase toward 12-15% would move you solidly into the typical on-track range.",
          sourceNote
        ],
        currentTakeHomeSavingsRateBps,
        currentGrossSavingsRateBps,
        gradedBy: "gross_rule_of_thumb"
      };
    }

    return {
      status: "below_target",
      headline: `Observed retirement rate is about ${grossRatePercent.toFixed(1)}% of estimated gross, well below common 10-15% guidance.`,
      reasoning: [
        guidanceAnchor,
        "A first meaningful step is to capture the full employer match if one exists, then step up by 1-2% per year until closer to 15% of gross.",
        sourceNote
      ],
      currentTakeHomeSavingsRateBps,
      currentGrossSavingsRateBps,
      gradedBy: "gross_rule_of_thumb"
    };
  }

  // --- Last resort: genuinely cannot estimate gross and no saved target. ---
  return {
    status: "insufficient_data",
    headline:
      "Observed retirement contributions are available, but there is not enough profile context to grade them yet.",
    reasoning: [
      "Saving an annual gross income, biweekly net pay, or target retirement savings rate to the profile would let the advisor grade your pace."
    ],
    currentTakeHomeSavingsRateBps,
    currentGrossSavingsRateBps,
    gradedBy: "none"
  };
}

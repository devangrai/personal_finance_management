import {
  assessObservedRetirementPosition,
  buildPaycheckAllocationPlan,
  recommendBiweeklyRetirementContribution,
  recommendEmergencyFundTarget
} from "@portfolio/finance-core";
import {
  getObservedPaycheckFlowComputation,
  type ObservedPaycheckFlowSnapshot
} from "./advisor-paycheck-flow";
import {
  getAdvisorFactsComputation,
  snapshotAdvisorFacts,
  type AdvisorFactsSnapshot
} from "./advisor-facts";
import { getOrCreateUserProfile } from "./profile";

type ScenarioResponse = {
  key: "conservative" | "balanced" | "aggressive";
  label: string;
  biweeklyAmounts: {
    retirement: string;
    emergencyFund: string;
    taxableInvesting: string;
    reserve: string;
  };
  reasoning: string[];
};

export type AdvisorPlanSnapshot = {
  facts: AdvisorFactsSnapshot;
  emergencyFund: {
    currentLiquidSavings: string;
    targetAmount: string;
    runwayMonths: string;
    shortfallAmount: string;
    targetMonths: number;
    reasoning: string[];
  };
  retirement: {
    recommendedBiweeklyContribution: string | null;
    currentObservedBiweeklyContribution: string | null;
    deltaFromObservedContribution: string | null;
    observedTakeHomeRetirementRatePercent: string | null;
    targetSavingsRatePercent: string | null;
    status: "below_target" | "on_track" | "aggressive" | "insufficient_data";
    statusHeadline: string;
    reasoning: string[];
    assumptions: string[];
    missingFields: string[];
  };
  paycheckFlow: ObservedPaycheckFlowSnapshot;
  paycheckAllocation: {
    availableBiweeklySurplus: string;
    monthlyFreeCashflow: string;
    scenarios: ScenarioResponse[];
  };
};

function centsToDollarsString(value: number) {
  return (value / 100).toFixed(2);
}

export async function getAdvisorPlanSnapshot(): Promise<AdvisorPlanSnapshot> {
  const [facts, profile, paycheckFlow] = await Promise.all([
    getAdvisorFactsComputation(),
    getOrCreateUserProfile(),
    getObservedPaycheckFlowComputation()
  ]);
  const factsSnapshot = snapshotAdvisorFacts(facts);
  const paycheckFlowSnapshot = {
    takeHomeBaselineBiweekly:
      paycheckFlow.takeHomeBaselineBiweeklyCents != null
        ? centsToDollarsString(paycheckFlow.takeHomeBaselineBiweeklyCents)
        : null,
    takeHomeSource: paycheckFlow.takeHomeSource,
    currentBiweeklyRetirementContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyRetirementContributionCents
    ),
    currentBiweeklyTraditional401kContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyTraditional401kContributionCents
    ),
    currentBiweeklyRoth401kContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyRoth401kContributionCents
    ),
    currentBiweeklyTaxableBrokerageDeposit: centsToDollarsString(
      paycheckFlow.currentBiweeklyTaxableBrokerageDepositCents
    ),
    currentBiweeklyRothIraContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyRothIraContributionCents
    ),
    currentBiweeklyHsaEmployeeContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyHsaEmployeeContributionCents
    ),
    currentBiweeklyHsaEmployerContribution: centsToDollarsString(
      paycheckFlow.currentBiweeklyHsaEmployerContributionCents
    ),
    percentOfTakeHomeToRetirement:
      paycheckFlow.currentTakeHomeRetirementRateBps != null
        ? (paycheckFlow.currentTakeHomeRetirementRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToTraditional401k:
      paycheckFlow.currentTakeHomeTraditional401kRateBps != null
        ? (paycheckFlow.currentTakeHomeTraditional401kRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToRoth401k:
      paycheckFlow.currentTakeHomeRoth401kRateBps != null
        ? (paycheckFlow.currentTakeHomeRoth401kRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToTaxableBrokerage:
      paycheckFlow.currentTakeHomeTaxableBrokerageRateBps != null
        ? (paycheckFlow.currentTakeHomeTaxableBrokerageRateBps / 100).toFixed(1)
        : null,
    recentPayPeriods: paycheckFlow.recentPayPeriods.map((period) => ({
      anchorDate: period.anchorDate,
      takeHomePay:
        period.takeHomePayCents != null
          ? centsToDollarsString(period.takeHomePayCents)
          : null,
      totalRetirementContribution: centsToDollarsString(
        period.totalRetirementContributionCents
      ),
      traditional401kContribution: centsToDollarsString(
        period.traditional401kContributionCents
      ),
      roth401kContribution: centsToDollarsString(
        period.roth401kContributionCents
      ),
      taxableBrokerageDeposit: centsToDollarsString(
        period.taxableBrokerageDepositCents
      ),
      rothIraContribution: centsToDollarsString(
        period.rothIraContributionCents
      ),
      hsaEmployeeContribution: centsToDollarsString(
        period.hsaEmployeeContributionCents
      ),
      hsaEmployerContribution: centsToDollarsString(
        period.hsaEmployerContributionCents
      ),
      matchedBy: period.matchedBy
    })),
    notes: paycheckFlow.notes
  } satisfies ObservedPaycheckFlowSnapshot;

  const emergencyFund = recommendEmergencyFundTarget({
    currentLiquidSavingsCents: facts.liquidCashBalanceCents,
    existingEmergencyFundTargetCents: facts.emergencyFundTargetCents,
    housingStatus: facts.housingStatus,
    monthlyCoreExpenseCents: facts.monthlyCoreExpenseCents
  });
  const paycheckAllocation = buildPaycheckAllocationPlan({
    averageVariableMonthlyExpenseCents: facts.averageMonthlySpendingCents,
    biweeklyNetPayCents: facts.biweeklyNetPayCents,
    emergencyFundShortfallCents: emergencyFund.shortfallCents,
    fixedMonthlyExpenseCents: facts.monthlyFixedExpenseCents,
    monthlyFreeCashflowOverrideCents:
      facts.biweeklyNetPayCents > 0
        ? null
        : facts.averageMonthlyFreeCashflowCents
  });

  const retirementMissingFields: string[] = [];
  let recommendedBiweeklyContribution: string | null = null;
  let recommendedBiweeklyContributionCents: number | null = null;
  const retirementAssumptions = [
    "Retirement guidance uses reviewed spending plus your saved fixed-expense profile.",
    "Emergency-fund shortfall is considered separately in the paycheck-allocation scenarios.",
    "Imported Fidelity transactions are used to measure current retirement and taxable-investing flows when they are available."
  ];

  if (facts.biweeklyNetPayCents <= 0) {
    retirementMissingFields.push("biweekly net pay");
    retirementAssumptions.push(
      "Paycheck allocation scenarios fall back to observed monthly free cash flow when biweekly net pay is missing."
    );
  } else {
    const recommendation = recommendBiweeklyRetirementContribution({
      biweeklyNetPayCents: facts.biweeklyNetPayCents,
      fixedMonthlyExpenseCents: facts.monthlyFixedExpenseCents,
      averageVariableMonthlyExpenseCents:
        facts.averageMonthlySpendingCents + facts.averageMonthlyInvestingCents,
      existingRetirementContributionBps: 0,
      targetSavingsBufferCents: Math.min(
        emergencyFund.shortfallCents,
        Math.max(Math.round(facts.averageMonthlyFreeCashflowCents * 0.3), 0)
      )
    });
    recommendedBiweeklyContributionCents =
      recommendation.recommendedBiweeklyRetirementContributionCents;
    recommendedBiweeklyContribution = centsToDollarsString(
      recommendedBiweeklyContributionCents
    );
    retirementAssumptions.push(...recommendation.reasoning);
    retirementAssumptions.push(
      "Observed investing transfers are treated as already-committed outflows before new retirement increases are suggested."
    );
  }

  const observedRetirementPosition = assessObservedRetirementPosition({
    currentBiweeklyRetirementContributionCents:
      paycheckFlow.currentBiweeklyRetirementContributionCents,
    targetBiweeklyRetirementContributionCents: recommendedBiweeklyContributionCents,
    takeHomeBaselineBiweeklyCents: paycheckFlow.takeHomeBaselineBiweeklyCents,
    targetRetirementSavingsRatePercent: profile.targetRetirementSavingsRate
      ? Number(profile.targetRetirementSavingsRate)
      : null,
    emergencyFundShortfallCents: emergencyFund.shortfallCents
  });
  const currentObservedBiweeklyContribution =
    paycheckFlow.currentBiweeklyRetirementContributionCents > 0
      ? centsToDollarsString(paycheckFlow.currentBiweeklyRetirementContributionCents)
      : null;
  const deltaFromObservedContribution =
    recommendedBiweeklyContributionCents != null &&
    paycheckFlow.currentBiweeklyRetirementContributionCents > 0
      ? centsToDollarsString(
          recommendedBiweeklyContributionCents -
            paycheckFlow.currentBiweeklyRetirementContributionCents
        )
      : null;

  return {
    facts: factsSnapshot,
    emergencyFund: {
      currentLiquidSavings: centsToDollarsString(
        emergencyFund.currentLiquidSavingsCents
      ),
      targetAmount: centsToDollarsString(emergencyFund.recommendedTargetCents),
      runwayMonths: emergencyFund.runwayMonths.toFixed(1),
      shortfallAmount: centsToDollarsString(emergencyFund.shortfallCents),
      targetMonths: emergencyFund.targetMonths,
      reasoning: emergencyFund.reasoning
    },
    retirement: {
      recommendedBiweeklyContribution,
      currentObservedBiweeklyContribution,
      deltaFromObservedContribution,
      observedTakeHomeRetirementRatePercent:
        paycheckFlow.currentTakeHomeRetirementRateBps != null
          ? (paycheckFlow.currentTakeHomeRetirementRateBps / 100).toFixed(1)
          : null,
      targetSavingsRatePercent: profile.targetRetirementSavingsRate,
      status: observedRetirementPosition.status,
      statusHeadline: observedRetirementPosition.headline,
      reasoning: recommendedBiweeklyContribution
        ? [
            "This is the direct retirement contribution recommendation if you want one primary number.",
            "Use the paycheck allocation scenarios below if you want tradeoff-based options instead.",
            ...observedRetirementPosition.reasoning
          ]
        : observedRetirementPosition.reasoning,
      assumptions: retirementAssumptions,
      missingFields: retirementMissingFields
    },
    paycheckFlow: paycheckFlowSnapshot,
    paycheckAllocation: {
      availableBiweeklySurplus: centsToDollarsString(
        paycheckAllocation.availableBiweeklySurplusCents
      ),
      monthlyFreeCashflow: centsToDollarsString(
        paycheckAllocation.monthlyFreeCashflowCents
      ),
      scenarios: paycheckAllocation.scenarios.map((scenario) => ({
        key: scenario.key,
        label: scenario.label,
        biweeklyAmounts: {
          retirement: centsToDollarsString(
            scenario.biweeklyAmounts.retirementCents
          ),
          emergencyFund: centsToDollarsString(
            scenario.biweeklyAmounts.emergencyFundCents
          ),
          taxableInvesting: centsToDollarsString(
            scenario.biweeklyAmounts.taxableInvestingCents
          ),
          reserve: centsToDollarsString(scenario.biweeklyAmounts.reserveCents)
        },
        reasoning: scenario.reasoning
      }))
    }
  };
}

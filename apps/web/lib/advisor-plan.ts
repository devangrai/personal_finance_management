import {
  buildPaycheckAllocationPlan,
  recommendBiweeklyRetirementContribution,
  recommendEmergencyFundTarget
} from "@portfolio/finance-core";
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
    targetSavingsRatePercent: string | null;
    reasoning: string[];
    assumptions: string[];
    missingFields: string[];
  };
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
  const [facts, profile] = await Promise.all([
    getAdvisorFactsComputation(),
    getOrCreateUserProfile()
  ]);
  const factsSnapshot = snapshotAdvisorFacts(facts);

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
    fixedMonthlyExpenseCents: facts.monthlyFixedExpenseCents
  });

  const retirementMissingFields: string[] = [];
  let recommendedBiweeklyContribution: string | null = null;
  const retirementAssumptions = [
    "Retirement guidance uses reviewed spending plus your saved fixed-expense profile.",
    "Emergency-fund shortfall is considered separately in the paycheck-allocation scenarios."
  ];

  if (facts.biweeklyNetPayCents <= 0) {
    retirementMissingFields.push("biweekly net pay");
  } else {
    const recommendation = recommendBiweeklyRetirementContribution({
      biweeklyNetPayCents: facts.biweeklyNetPayCents,
      fixedMonthlyExpenseCents: facts.monthlyFixedExpenseCents,
      averageVariableMonthlyExpenseCents: facts.averageMonthlySpendingCents,
      existingRetirementContributionBps: 0,
      targetSavingsBufferCents: Math.min(
        emergencyFund.shortfallCents,
        Math.max(Math.round(facts.averageMonthlyNetCashflowCents * 0.3), 0)
      )
    });
    recommendedBiweeklyContribution = centsToDollarsString(
      recommendation.recommendedBiweeklyRetirementContributionCents
    );
    retirementAssumptions.push(...recommendation.reasoning);
  }

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
      targetSavingsRatePercent: profile.targetRetirementSavingsRate,
      reasoning: recommendedBiweeklyContribution
        ? [
            "This is the direct retirement contribution recommendation if you want one primary number.",
            "Use the paycheck allocation scenarios below if you want tradeoff-based options instead."
          ]
        : [],
      assumptions: retirementAssumptions,
      missingFields: retirementMissingFields
    },
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

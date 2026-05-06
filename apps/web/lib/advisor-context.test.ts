import { describe, expect, it } from "vitest";
import { buildAdvisorContextNarrative } from "./advisor-context";

function baseInput() {
  // Minimal valid input — many fields are nullable / 0, covering the path
  // where only `personalContext` changes behavior.
  return {
    advisorPlan: {
      facts: {
        housingStatus: "renter",
        biweeklyNetPay: null,
        monthlyFixedExpense: 0,
        averageMonthlySpending: 0,
        averageMonthlyFreeCashflow: 0,
        liquidCashBalance: 0,
        reviewedSpendCoveragePercent: 0
      },
      paycheckFlow: {
        takeHomeSource: "unknown" as const,
        takeHomeBaselineBiweekly: 0,
        currentBiweeklyRetirementContribution: 0,
        percentOfTakeHomeToRetirement: null,
        currentBiweeklyTraditional401kContribution: 0,
        currentBiweeklyRoth401kContribution: 0,
        currentBiweeklyRothIraContribution: 0,
        currentBiweeklyTaxableBrokerageDeposit: 0,
        percentOfTakeHomeToTaxableBrokerage: null,
        currentBiweeklyHsaEmployeeContribution: 0,
        currentBiweeklyHsaEmployerContribution: 0,
        recentPayPeriods: []
      },
      emergencyFund: {
        runwayMonths: 0,
        targetAmount: 0,
        shortfallAmount: 0,
        currentLiquidSavings: 0,
        targetMonths: 0
      },
      retirement: {
        status: "insufficient_data" as const,
        statusHeadline: "n/a",
        recommendedBiweeklyContribution: null,
        currentObservedBiweeklyContribution: null,
        targetSavingsRatePercent: null
      },
      paycheckAllocation: {
        availableBiweeklySurplus: 0,
        monthlyFreeCashflow: 0,
        scenarios: []
      }
      // deliberately cast — production type is wider than what this test needs
    } as unknown as Parameters<typeof buildAdvisorContextNarrative>[0]["advisorPlan"],
    cashflowSummary: {
      latestMonth: null,
      months: []
    } as unknown as Parameters<typeof buildAdvisorContextNarrative>[0]["cashflowSummary"],
    investmentsSummary: {
      totals: {
        accountCount: 0,
        totalBalance: 0,
        retirementBalance: 0,
        taxableBalance: 0,
        holdingsCount: 0,
        investmentTransactionCount: 0
      }
    } as unknown as Parameters<typeof buildAdvisorContextNarrative>[0]["investmentsSummary"],
    recurringSummary: {
      inflows: [],
      outflows: []
    } as unknown as Parameters<typeof buildAdvisorContextNarrative>[0]["recurringSummary"],
    activeGoals: []
  };
}

describe("buildAdvisorContextNarrative — personal context injection", () => {
  it("omits the ABOUT ME section when personalContext is not provided", () => {
    const { narrative } = buildAdvisorContextNarrative(baseInput());
    expect(narrative).not.toContain("ABOUT ME");
  });

  it("omits the ABOUT ME section when personalContext is empty/whitespace", () => {
    const { narrative } = buildAdvisorContextNarrative({
      ...baseInput(),
      personalContext: "   \n  "
    });
    expect(narrative).not.toContain("ABOUT ME");
  });

  it("injects the ABOUT ME section as the first block when provided", () => {
    const text =
      "I live rent-free at home in the Bay Area. Possibly helping family with tuition.";
    const { narrative } = buildAdvisorContextNarrative({
      ...baseInput(),
      personalContext: text
    });
    expect(narrative).toContain("## ABOUT ME (user-provided)");
    expect(narrative).toContain(text);
    // Verify ordering: ABOUT ME comes before IDENTITY
    const aboutMeIdx = narrative.indexOf("ABOUT ME");
    const identityIdx = narrative.indexOf("IDENTITY");
    expect(aboutMeIdx).toBeGreaterThanOrEqual(0);
    expect(aboutMeIdx).toBeLessThan(identityIdx);
  });

  it("trims surrounding whitespace from the injected text", () => {
    const { narrative } = buildAdvisorContextNarrative({
      ...baseInput(),
      personalContext: "   hello world  \n\n"
    });
    expect(narrative).toMatch(/## ABOUT ME[^\n]*\nhello world/);
  });
});

import type { getAdvisorPlanSnapshot } from "./advisor-plan";
import type { getCashflowSummary } from "./cashflow-summary";
import type { getInvestmentsSummary } from "./investments";
import type { getRecurringSummary } from "./recurring-summary";
import type { UserGoalSnapshot } from "./goals";

/**
 * Advisor context composition.
 *
 * This file owns how we render the user's financial state for the advisor
 * chat LLM. The design goal is that the model reasons over a *prose
 * narrative*, not a JSON dump, because the narrative is:
 *   - shorter in tokens (typically 3-5x less than the old JSON context)
 *   - easier for the model to find relevant facts inside
 *   - explicit about what is known vs. missing vs. inferred
 *
 * We still keep a typed `factSheet` alongside the narrative so the
 * deterministic fallback, debug tooling, and any future tool-calling
 * implementation can reach for structured numbers without re-parsing prose.
 */

type AdvisorPlan = Awaited<ReturnType<typeof getAdvisorPlanSnapshot>>;
type CashflowSummary = Awaited<ReturnType<typeof getCashflowSummary>>;
type InvestmentsSummary = Awaited<ReturnType<typeof getInvestmentsSummary>>;
type RecurringSummary = Awaited<ReturnType<typeof getRecurringSummary>>;

export type AdvisorContextFactSheet = {
  housingStatus: string;
  biweeklyNetPay: string | null;
  biweeklyNetPaySource: "profile" | "observed" | "unknown";
  monthlyFixedExpense: string;
  averageMonthlySpending: string;
  averageMonthlyFreeCashflow: string;
  liquidCashBalance: string;
  emergencyFundRunwayMonths: string;
  emergencyFundTargetAmount: string;
  emergencyFundShortfallAmount: string;
  observedBiweeklyRetirementContribution: string;
  observedBiweeklyRetirementRatePercent: string | null;
  observedBiweeklyTaxableBrokerageDeposit: string;
  retirementStatus: AdvisorPlan["retirement"]["status"];
  retirementRecommendedBiweekly: string | null;
  totalInvestmentBalance: string;
  reviewedSpendCoveragePercent: string;
  recentMonthLabel: string | null;
  dataGaps: string[];
  goals: Array<{
    goalKey: string;
    label: string;
    targetValue: string | null;
    targetDate: string | null;
    commitment: string | null;
  }>;
};

export type AdvisorContextPayload = {
  narrative: string;
  factSheet: AdvisorContextFactSheet;
  tokenEstimate: number;
};

function dollarString(value: string | null | undefined) {
  if (value == null || value === "") {
    return "unknown";
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return value;
  }
  const rounded = Math.round(numeric);
  return rounded.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function percentString(bpsOrPercent: string | null | undefined) {
  if (bpsOrPercent == null || bpsOrPercent === "") {
    return null;
  }
  return `${bpsOrPercent}%`;
}

function estimateTokens(text: string) {
  // Rough approximation aligned with OpenAI's common heuristic: 1 token
  // per ~4 English characters, plus headroom for punctuation.
  return Math.ceil(text.length / 4);
}

function monthLabel(latestMonth: CashflowSummary["latestMonth"]) {
  if (!latestMonth) {
    return null;
  }
  return latestMonth.label;
}

function buildDataGaps(
  plan: AdvisorPlan,
  cashflow: CashflowSummary,
  investments: InvestmentsSummary
) {
  const gaps: string[] = [];

  if (!plan.facts.biweeklyNetPay) {
    gaps.push(
      "Biweekly net pay is not saved in the profile, so take-home-based ratios fall back to observed investment flow."
    );
  }

  if (!cashflow.latestMonth || cashflow.months.length === 0) {
    gaps.push(
      "No reviewed bank transactions are present yet, so monthly cashflow and spending categories are unavailable."
    );
  } else if (Number(cashflow.latestMonth.uncategorizedOutflow) > 0) {
    gaps.push(
      `About ${dollarString(cashflow.latestMonth.uncategorizedOutflow)} in the latest month is still uncategorized, which weakens spending and free-cashflow estimates.`
    );
  }

  if (investments.totals.holdingsCount === 0) {
    gaps.push(
      "No investment holdings snapshots have been imported, so account balances and allocation are not yet visible to the advisor."
    );
  }

  if (plan.retirement.status === "insufficient_data") {
    gaps.push(
      "A target retirement savings rate or biweekly retirement target has not been configured, so the retirement pace is not being graded against a saved benchmark."
    );
  }

  return gaps;
}

function buildFactSheet(
  plan: AdvisorPlan,
  cashflow: CashflowSummary,
  investments: InvestmentsSummary,
  gaps: string[],
  activeGoals: UserGoalSnapshot[]
): AdvisorContextFactSheet {
  const takeHomeSource = plan.paycheckFlow.takeHomeSource;
  const biweeklyNetPaySource: AdvisorContextFactSheet["biweeklyNetPaySource"] =
    plan.facts.biweeklyNetPay
      ? "profile"
      : takeHomeSource === "transactions"
        ? "observed"
        : "unknown";

  return {
    housingStatus: plan.facts.housingStatus,
    biweeklyNetPay:
      plan.facts.biweeklyNetPay ?? plan.paycheckFlow.takeHomeBaselineBiweekly,
    biweeklyNetPaySource,
    monthlyFixedExpense: plan.facts.monthlyFixedExpense,
    averageMonthlySpending: plan.facts.averageMonthlySpending,
    averageMonthlyFreeCashflow: plan.facts.averageMonthlyFreeCashflow,
    liquidCashBalance: plan.facts.liquidCashBalance,
    emergencyFundRunwayMonths: plan.emergencyFund.runwayMonths,
    emergencyFundTargetAmount: plan.emergencyFund.targetAmount,
    emergencyFundShortfallAmount: plan.emergencyFund.shortfallAmount,
    observedBiweeklyRetirementContribution:
      plan.paycheckFlow.currentBiweeklyRetirementContribution,
    observedBiweeklyRetirementRatePercent:
      plan.paycheckFlow.percentOfTakeHomeToRetirement,
    observedBiweeklyTaxableBrokerageDeposit:
      plan.paycheckFlow.currentBiweeklyTaxableBrokerageDeposit,
    retirementStatus: plan.retirement.status,
    retirementRecommendedBiweekly: plan.retirement.recommendedBiweeklyContribution,
    totalInvestmentBalance: investments.totals.totalBalance,
    reviewedSpendCoveragePercent: plan.facts.reviewedSpendCoveragePercent,
    recentMonthLabel: monthLabel(cashflow.latestMonth),
    dataGaps: gaps,
    goals: activeGoals.map((goal) => ({
      goalKey: goal.goalKey,
      label: goal.label,
      targetValue: goal.targetValue,
      targetDate: goal.targetDate,
      commitment: goal.commitment
    }))
  };
}

function renderIdentityParagraph(facts: AdvisorContextFactSheet) {
  const payParts: string[] = [];
  if (facts.biweeklyNetPay) {
    if (facts.biweeklyNetPaySource === "profile") {
      payParts.push(
        `Biweekly net pay is saved in the profile at ${dollarString(facts.biweeklyNetPay)}.`
      );
    } else if (facts.biweeklyNetPaySource === "observed") {
      payParts.push(
        `Biweekly take-home is estimated from observed paycheck deposits at approximately ${dollarString(facts.biweeklyNetPay)}; no profile value is saved.`
      );
    }
  } else {
    payParts.push(
      "No biweekly net pay has been saved and no paycheck deposits have been detected yet, so take-home figures are unknown."
    );
  }

  return [
    `Household housing status is "${facts.housingStatus}".`,
    ...payParts,
    `Saved monthly fixed expense is ${dollarString(facts.monthlyFixedExpense)}.`
  ].join(" ");
}

function renderMoneyInParagraph(plan: AdvisorPlan, cashflow: CashflowSummary) {
  const latest = cashflow.latestMonth;
  if (!latest) {
    return "No bank transactions have been imported yet, so reviewed income and spending are not visible.";
  }

  return [
    `For ${latest.label}, reviewed income was ${dollarString(latest.income)}, reviewed spending was ${dollarString(latest.spending)}, and net cashflow was ${dollarString(latest.netCashflow)}.`,
    `About ${latest.reviewedSpendRatioBps / 100}% of outflows are categorized; ${dollarString(latest.uncategorizedOutflow)} remains uncategorized.`,
    `Average monthly free cashflow across recent months is ${dollarString(plan.facts.averageMonthlyFreeCashflow)}.`
  ].join(" ");
}

function renderRecurringParagraph(recurring: RecurringSummary) {
  const topInflows = recurring.inflows.slice(0, 3);
  const topOutflows = recurring.outflows.slice(0, 5);

  if (topInflows.length === 0 && topOutflows.length === 0) {
    return "No recurring inflows or outflows have been detected yet.";
  }

  const parts: string[] = [];
  if (topInflows.length > 0) {
    const joined = topInflows
      .map(
        (inflow) =>
          `${inflow.displayName} (${inflow.frequency}, ~${dollarString(inflow.averageAmount)})`
      )
      .join("; ");
    parts.push(`Recurring inflows include: ${joined}.`);
  }
  if (topOutflows.length > 0) {
    const joined = topOutflows
      .map(
        (outflow) =>
          `${outflow.displayName} (${outflow.frequency}, ~${dollarString(outflow.averageAmount)})`
      )
      .join("; ");
    parts.push(`Recurring outflows include: ${joined}.`);
  }
  return parts.join(" ");
}

function renderInvestingFlowParagraph(
  plan: AdvisorPlan,
  facts: AdvisorContextFactSheet
) {
  const flow = plan.paycheckFlow;
  const retirementPercent = percentString(
    facts.observedBiweeklyRetirementRatePercent
  );
  const brokeragePercent = percentString(flow.percentOfTakeHomeToTaxableBrokerage);

  const sentences: string[] = [];
  const retireDetail = [
    Number(flow.currentBiweeklyTraditional401kContribution) > 0
      ? `${dollarString(flow.currentBiweeklyTraditional401kContribution)} traditional 401(k)`
      : null,
    Number(flow.currentBiweeklyRoth401kContribution) > 0
      ? `${dollarString(flow.currentBiweeklyRoth401kContribution)} Roth 401(k)`
      : null,
    Number(flow.currentBiweeklyRothIraContribution) > 0
      ? `${dollarString(flow.currentBiweeklyRothIraContribution)} Roth IRA`
      : null
  ]
    .filter((part): part is string => part !== null)
    .join(" + ");

  sentences.push(
    `Observed biweekly retirement flow is ${dollarString(flow.currentBiweeklyRetirementContribution)}${retireDetail ? ` (${retireDetail})` : ""}${retirementPercent ? `, about ${retirementPercent} of take-home` : ""}.`
  );

  if (Number(flow.currentBiweeklyTaxableBrokerageDeposit) > 0) {
    sentences.push(
      `Recurring taxable brokerage deposit is ${dollarString(flow.currentBiweeklyTaxableBrokerageDeposit)}${brokeragePercent ? ` (~${brokeragePercent} of take-home)` : ""}.`
    );
  }

  const hsaTotal =
    Number(flow.currentBiweeklyHsaEmployeeContribution) +
    Number(flow.currentBiweeklyHsaEmployerContribution);
  if (hsaTotal > 0) {
    sentences.push(
      `HSA flow is ${dollarString(flow.currentBiweeklyHsaEmployeeContribution)} from employee and ${dollarString(flow.currentBiweeklyHsaEmployerContribution)} from employer per cycle.`
    );
  }

  if (flow.recentPayPeriods.length > 0) {
    const anchor =
      flow.takeHomeSource === "transactions"
        ? "bank-side paychecks"
        : flow.takeHomeSource === "profile"
          ? "profile-reported net pay"
          : "inferred pay cycles";
    sentences.push(
      `Detected ${flow.recentPayPeriods.length} recent pay cycles, anchored by ${anchor}.`
    );
  }

  return sentences.join(" ");
}

function renderEmergencyFundParagraph(plan: AdvisorPlan) {
  const ef = plan.emergencyFund;
  const shortfall = Number(ef.shortfallAmount);
  const runway = Number(ef.runwayMonths);

  if (shortfall <= 0) {
    return `Emergency fund is at or above target (${dollarString(ef.currentLiquidSavings)} liquid, ${runway.toFixed(1)} months runway against ${ef.targetMonths}-month target of ${dollarString(ef.targetAmount)}).`;
  }

  return `Emergency fund has a shortfall of ${dollarString(ef.shortfallAmount)}: current liquid savings ${dollarString(ef.currentLiquidSavings)} against a ${ef.targetMonths}-month target of ${dollarString(ef.targetAmount)}, for ${runway.toFixed(1)} months of runway.`;
}

function renderRetirementPostureParagraph(plan: AdvisorPlan) {
  const r = plan.retirement;
  const parts: string[] = [`Retirement pacing status is "${r.status}": ${r.statusHeadline}`];
  if (r.recommendedBiweeklyContribution) {
    parts.push(
      `Model-recommended biweekly retirement contribution is ${dollarString(r.recommendedBiweeklyContribution)}.`
    );
  }
  if (r.currentObservedBiweeklyContribution) {
    parts.push(
      `Observed biweekly retirement contribution is ${dollarString(r.currentObservedBiweeklyContribution)}.`
    );
  }
  if (r.targetSavingsRatePercent) {
    parts.push(`Saved target savings rate is ${r.targetSavingsRatePercent}%.`);
  }
  return parts.join(" ");
}

function renderAllocationScenariosParagraph(plan: AdvisorPlan) {
  const allocation = plan.paycheckAllocation;
  if (Number(allocation.availableBiweeklySurplus) <= 0) {
    return `No biweekly surplus is currently available for allocation (free cashflow: ${dollarString(allocation.monthlyFreeCashflow)}/month).`;
  }

  const balanced = allocation.scenarios.find((scenario) => scenario.key === "balanced");
  const aggressive = allocation.scenarios.find(
    (scenario) => scenario.key === "aggressive"
  );
  const conservative = allocation.scenarios.find(
    (scenario) => scenario.key === "conservative"
  );

  const lines: string[] = [
    `Biweekly surplus available for allocation is ${dollarString(allocation.availableBiweeklySurplus)}.`
  ];

  if (balanced) {
    lines.push(
      `Balanced scenario biweekly split: retirement ${dollarString(balanced.biweeklyAmounts.retirement)}, emergency fund ${dollarString(balanced.biweeklyAmounts.emergencyFund)}, taxable investing ${dollarString(balanced.biweeklyAmounts.taxableInvesting)}, reserve ${dollarString(balanced.biweeklyAmounts.reserve)}.`
    );
  }
  if (conservative) {
    lines.push(
      `Conservative: retirement ${dollarString(conservative.biweeklyAmounts.retirement)}, emergency fund ${dollarString(conservative.biweeklyAmounts.emergencyFund)}, taxable ${dollarString(conservative.biweeklyAmounts.taxableInvesting)}, reserve ${dollarString(conservative.biweeklyAmounts.reserve)}.`
    );
  }
  if (aggressive) {
    lines.push(
      `Aggressive: retirement ${dollarString(aggressive.biweeklyAmounts.retirement)}, emergency fund ${dollarString(aggressive.biweeklyAmounts.emergencyFund)}, taxable ${dollarString(aggressive.biweeklyAmounts.taxableInvesting)}, reserve ${dollarString(aggressive.biweeklyAmounts.reserve)}.`
    );
  }

  return lines.join(" ");
}

function renderInvestmentsParagraph(investments: InvestmentsSummary) {
  const totals = investments.totals;
  if (totals.accountCount === 0) {
    return "No investment accounts have been linked or imported yet.";
  }

  const parts: string[] = [
    `${totals.accountCount} investment accounts tracked with total balance ${dollarString(totals.totalBalance)} (retirement ${dollarString(totals.retirementBalance)}, taxable ${dollarString(totals.taxableBalance)}).`
  ];

  if (totals.holdingsCount === 0 && totals.investmentTransactionCount > 0) {
    parts.push(
      `No holdings snapshots have been imported; balance shown is derived from manual-import transactions.`
    );
  }

  return parts.join(" ");
}

function renderDataGapsParagraph(gaps: string[]) {
  if (gaps.length === 0) {
    return null;
  }
  return "Known data gaps to acknowledge in answers: " + gaps.join(" ");
}

function renderGoalsParagraph(goals: UserGoalSnapshot[]) {
  if (goals.length === 0) {
    return null;
  }
  const rendered = goals
    .map((goal) => {
      const parts: string[] = [`"${goal.label}" (key: ${goal.goalKey})`];
      if (goal.targetValue) {
        parts.push(`target ${dollarString(goal.targetValue)}`);
      }
      if (goal.targetDate) {
        parts.push(`by ${goal.targetDate.slice(0, 10)}`);
      }
      if (goal.commitment) {
        parts.push(`commitment: "${goal.commitment}"`);
      }
      return parts.join(", ");
    })
    .join("; ");
  return `Active user goals to remember across turns: ${rendered}. When answering, check whether the user's question relates to one of these goals and ground your guidance in the stated target or commitment.`;
}

export function buildAdvisorContextNarrative(input: {
  advisorPlan: AdvisorPlan;
  cashflowSummary: CashflowSummary;
  investmentsSummary: InvestmentsSummary;
  recurringSummary: RecurringSummary;
  activeGoals: UserGoalSnapshot[];
  /**
   * Freeform text the user wrote about their life (rent-free at home,
   * Bay Area HCOL, possibly helping parents, etc.). Injected first so it
   * is always top-of-mind for the specialist.
   */
  personalContext?: string | null;
}): AdvisorContextPayload {
  const gaps = buildDataGaps(
    input.advisorPlan,
    input.cashflowSummary,
    input.investmentsSummary
  );
  const factSheet = buildFactSheet(
    input.advisorPlan,
    input.cashflowSummary,
    input.investmentsSummary,
    gaps,
    input.activeGoals
  );

  const personalContextClean = (input.personalContext ?? "").trim();

  const sections: Array<[string, string | null]> = [
    // Personal context ALWAYS goes first so the specialist sees it as
    // framing for everything else. If blank, skipped.
    [
      "ABOUT ME (user-provided)",
      personalContextClean.length > 0 ? personalContextClean : null
    ],
    ["IDENTITY", renderIdentityParagraph(factSheet)],
    ["MONEY IN / OUT", renderMoneyInParagraph(input.advisorPlan, input.cashflowSummary)],
    ["RECURRING", renderRecurringParagraph(input.recurringSummary)],
    [
      "INVESTING FLOW",
      renderInvestingFlowParagraph(input.advisorPlan, factSheet)
    ],
    ["EMERGENCY FUND", renderEmergencyFundParagraph(input.advisorPlan)],
    ["RETIREMENT POSTURE", renderRetirementPostureParagraph(input.advisorPlan)],
    [
      "PAYCHECK ALLOCATION SCENARIOS",
      renderAllocationScenariosParagraph(input.advisorPlan)
    ],
    ["INVESTMENTS", renderInvestmentsParagraph(input.investmentsSummary)],
    ["GOALS", renderGoalsParagraph(input.activeGoals)],
    ["DATA GAPS", renderDataGapsParagraph(gaps)]
  ];

  const narrative = sections
    .filter((entry): entry is [string, string] => entry[1] !== null && entry[1].length > 0)
    .map(([heading, body]) => `## ${heading}\n${body}`)
    .join("\n\n");

  return {
    narrative,
    factSheet,
    tokenEstimate: estimateTokens(narrative)
  };
}

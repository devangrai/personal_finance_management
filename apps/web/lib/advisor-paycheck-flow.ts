import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";
import { getOrCreateUserProfile } from "./profile";

type FlowEventKind =
  | "take_home_paycheck"
  | "taxable_brokerage_deposit"
  | "retirement_plan_total"
  | "traditional_401k_allocation"
  | "roth_401k_allocation"
  | "roth_ira_contribution"
  | "hsa_employee_contribution"
  | "hsa_employer_contribution";

type FlowEvent = {
  kind: FlowEventKind;
  date: Date;
  amountCents: number;
};

type FlowPeriodSummary = {
  anchorDate: string;
  takeHomePayCents: number | null;
  totalRetirementContributionCents: number;
  traditional401kContributionCents: number;
  roth401kContributionCents: number;
  taxableBrokerageDepositCents: number;
  rothIraContributionCents: number;
  hsaEmployeeContributionCents: number;
  hsaEmployerContributionCents: number;
  matchedBy: "paycheck" | "investment_flow";
};

export type ObservedPaycheckFlowSnapshot = {
  takeHomeBaselineBiweekly: string | null;
  takeHomeSource: "transactions" | "profile" | "unknown";
  currentBiweeklyRetirementContribution: string;
  currentBiweeklyTraditional401kContribution: string;
  currentBiweeklyRoth401kContribution: string;
  currentBiweeklyTaxableBrokerageDeposit: string;
  currentBiweeklyRothIraContribution: string;
  currentBiweeklyHsaEmployeeContribution: string;
  currentBiweeklyHsaEmployerContribution: string;
  percentOfTakeHomeToRetirement: string | null;
  percentOfTakeHomeToTraditional401k: string | null;
  percentOfTakeHomeToRoth401k: string | null;
  percentOfTakeHomeToTaxableBrokerage: string | null;
  recentPayPeriods: Array<{
    anchorDate: string;
    takeHomePay: string | null;
    totalRetirementContribution: string;
    traditional401kContribution: string;
    roth401kContribution: string;
    taxableBrokerageDeposit: string;
    rothIraContribution: string;
    hsaEmployeeContribution: string;
    hsaEmployerContribution: string;
    matchedBy: "paycheck" | "investment_flow";
  }>;
  notes: string[];
};

type ObservedPaycheckFlowComputation = {
  takeHomeBaselineBiweeklyCents: number | null;
  takeHomeSource: "transactions" | "profile" | "unknown";
  currentBiweeklyRetirementContributionCents: number;
  currentBiweeklyTraditional401kContributionCents: number;
  currentBiweeklyRoth401kContributionCents: number;
  currentBiweeklyTaxableBrokerageDepositCents: number;
  currentBiweeklyRothIraContributionCents: number;
  currentBiweeklyHsaEmployeeContributionCents: number;
  currentBiweeklyHsaEmployerContributionCents: number;
  currentTakeHomeRetirementRateBps: number | null;
  currentTakeHomeTraditional401kRateBps: number | null;
  currentTakeHomeRoth401kRateBps: number | null;
  currentTakeHomeTaxableBrokerageRateBps: number | null;
  recentPayPeriods: Array<{
    anchorDate: string;
    takeHomePayCents: number | null;
    totalRetirementContributionCents: number;
    traditional401kContributionCents: number;
    roth401kContributionCents: number;
    taxableBrokerageDepositCents: number;
    rothIraContributionCents: number;
    hsaEmployeeContributionCents: number;
    hsaEmployerContributionCents: number;
    matchedBy: "paycheck" | "investment_flow";
  }>;
  notes: string[];
};

const MIN_SIGNIFICANT_PAYCHECK_CENTS = 10_000;
const RETIREMENT_CLUSTER_GAP_DAYS = 2;
const HSA_CLUSTER_GAP_DAYS = 1;
const RECENT_PERIOD_MERGE_GAP_DAYS = 3;

function centsToDollarsString(value: number) {
  return (value / 100).toFixed(2);
}

function decimalStringToCents(value: string | number | null | undefined) {
  if (value == null) {
    return 0;
  }

  return Math.round(Number(value) * 100);
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function daysBetween(left: Date, right: Date) {
  return Math.abs(left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24);
}

function parseAnchorDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toLowerText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function calculateRateBps(amountCents: number, denominatorCents: number | null) {
  if (!denominatorCents || denominatorCents <= 0) {
    return null;
  }

  return Math.round((amountCents / denominatorCents) * 10000);
}

function normalizeManualFlowEvent(input: {
  accountSubtype: string | null;
  bucket: "retirement" | "taxable" | "other";
  type: string;
  subtype: string | null;
  name: string;
  amountCents: number;
  date: Date;
}): FlowEvent | null {
  if (input.amountCents <= 0) {
    return null;
  }

  const accountSubtype = toLowerText(input.accountSubtype);
  const type = toLowerText(input.type);
  const subtype = toLowerText(input.subtype);
  const name = toLowerText(input.name);
  const combined = `${type} ${subtype} ${name}`;

  if (
    input.bucket === "taxable" &&
    /electronic funds transfer received|eft|funds transfer received/.test(combined)
  ) {
    return {
      kind: "taxable_brokerage_deposit",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (accountSubtype === "401k" && /contribution/.test(combined)) {
    return {
      kind: "retirement_plan_total",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (
    accountSubtype === "brokeragelink_401k" &&
    /transfer/.test(combined)
  ) {
    return {
      kind: "traditional_401k_allocation",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (
    accountSubtype === "brokeragelink_roth" &&
    /transfer/.test(combined)
  ) {
    return {
      kind: "roth_401k_allocation",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (
    accountSubtype === "roth_ira" &&
    /electronic funds transfer received|contribution/.test(combined)
  ) {
    return {
      kind: "roth_ira_contribution",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (accountSubtype === "hsa") {
    if (/partic contr|participant/.test(combined)) {
      return {
        kind: "hsa_employee_contribution",
        date: input.date,
        amountCents: input.amountCents
      };
    }

    if (/\bco contr\b|employer/.test(combined)) {
      return {
        kind: "hsa_employer_contribution",
        date: input.date,
        amountCents: input.amountCents
      };
    }
  }

  return null;
}

function normalizePlaidInvestmentFlowEvent(input: {
  accountSubtype: string | null;
  accountName: string;
  type: string;
  subtype: string | null;
  amountCents: number;
  date: Date;
}): FlowEvent | null {
  if (input.amountCents <= 0) {
    return null;
  }

  const accountSubtype = toLowerText(input.accountSubtype);
  const combined = `${toLowerText(input.type)} ${toLowerText(input.subtype)} ${toLowerText(
    input.accountName
  )}`;

  if (
    /brokeragelink/.test(accountSubtype) &&
    /roth/.test(accountSubtype) &&
    /transfer/.test(combined)
  ) {
    return {
      kind: "roth_401k_allocation",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (/brokeragelink/.test(accountSubtype) && /transfer/.test(combined)) {
    return {
      kind: "traditional_401k_allocation",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (/401k|401\(k\)|retirement/.test(accountSubtype) && /contribution/.test(combined)) {
    return {
      kind: "retirement_plan_total",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (/roth/.test(accountSubtype) && /contribution|deposit|transfer/.test(combined)) {
    return {
      kind: "roth_ira_contribution",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  if (/brokerage|individual|taxable/.test(accountSubtype) && /deposit|transfer/.test(combined)) {
    return {
      kind: "taxable_brokerage_deposit",
      date: input.date,
      amountCents: input.amountCents
    };
  }

  return null;
}

function clusterFlowEvents(events: FlowEvent[], maxGapDays: number) {
  const sortedEvents = [...events].sort(
    (left, right) => left.date.getTime() - right.date.getTime()
  );
  const clusters: FlowEvent[][] = [];

  for (const event of sortedEvents) {
    const currentCluster = clusters[clusters.length - 1];
    const lastEvent = currentCluster?.[currentCluster.length - 1];

    if (lastEvent && daysBetween(lastEvent.date, event.date) <= maxGapDays) {
      currentCluster.push(event);
      continue;
    }

    clusters.push([event]);
  }

  return clusters;
}

function summarizeFlowCluster(events: FlowEvent[]): FlowPeriodSummary {
  const takeHomePayCents = events
    .filter((event) => event.kind === "take_home_paycheck")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const traditional401kContributionCents = events
    .filter((event) => event.kind === "traditional_401k_allocation")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const roth401kContributionCents = events
    .filter((event) => event.kind === "roth_401k_allocation")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const retirementPlanTotalCents = events
    .filter((event) => event.kind === "retirement_plan_total")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const totalRetirementContributionCents =
    traditional401kContributionCents + roth401kContributionCents > 0
      ? traditional401kContributionCents + roth401kContributionCents
      : retirementPlanTotalCents;
  const taxableBrokerageDepositCents = events
    .filter((event) => event.kind === "taxable_brokerage_deposit")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const rothIraContributionCents = events
    .filter((event) => event.kind === "roth_ira_contribution")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const hsaEmployeeContributionCents = events
    .filter((event) => event.kind === "hsa_employee_contribution")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const hsaEmployerContributionCents = events
    .filter((event) => event.kind === "hsa_employer_contribution")
    .reduce((sum, event) => sum + event.amountCents, 0);
  const anchorEvent = [...events].sort(
    (left, right) => right.date.getTime() - left.date.getTime()
  )[0];

  return {
    anchorDate: anchorEvent?.date.toISOString().slice(0, 10) ?? "",
    takeHomePayCents: takeHomePayCents > 0 ? takeHomePayCents : null,
    totalRetirementContributionCents:
      totalRetirementContributionCents + rothIraContributionCents,
    traditional401kContributionCents,
    roth401kContributionCents,
    taxableBrokerageDepositCents,
    rothIraContributionCents,
    hsaEmployeeContributionCents,
    hsaEmployerContributionCents,
    matchedBy:
      takeHomePayCents > 0 ? ("paycheck" as const) : ("investment_flow" as const)
  };
}

function mergeFlowPeriodSummaries(
  periods: FlowPeriodSummary[],
  maxGapDays: number
) {
  const sortedPeriods = [...periods].sort(
    (left, right) =>
      parseAnchorDate(left.anchorDate).getTime() -
      parseAnchorDate(right.anchorDate).getTime()
  );
  const mergedPeriods: FlowPeriodSummary[] = [];

  for (const period of sortedPeriods) {
    const currentPeriod = mergedPeriods[mergedPeriods.length - 1];

    if (
      currentPeriod &&
      daysBetween(
        parseAnchorDate(currentPeriod.anchorDate),
        parseAnchorDate(period.anchorDate)
      ) <= maxGapDays
    ) {
      const combinedTakeHome =
        (currentPeriod.takeHomePayCents ?? 0) + (period.takeHomePayCents ?? 0);

      currentPeriod.anchorDate =
        parseAnchorDate(period.anchorDate) > parseAnchorDate(currentPeriod.anchorDate)
          ? period.anchorDate
          : currentPeriod.anchorDate;
      currentPeriod.takeHomePayCents = combinedTakeHome > 0 ? combinedTakeHome : null;
      currentPeriod.totalRetirementContributionCents +=
        period.totalRetirementContributionCents;
      currentPeriod.traditional401kContributionCents +=
        period.traditional401kContributionCents;
      currentPeriod.roth401kContributionCents += period.roth401kContributionCents;
      currentPeriod.taxableBrokerageDepositCents +=
        period.taxableBrokerageDepositCents;
      currentPeriod.rothIraContributionCents += period.rothIraContributionCents;
      currentPeriod.hsaEmployeeContributionCents +=
        period.hsaEmployeeContributionCents;
      currentPeriod.hsaEmployerContributionCents +=
        period.hsaEmployerContributionCents;
      currentPeriod.matchedBy =
        currentPeriod.takeHomePayCents != null ? "paycheck" : "investment_flow";
      continue;
    }

    mergedPeriods.push({ ...period });
  }

  return mergedPeriods;
}

function buildObservedPaycheckFlowSnapshot(
  computation: ObservedPaycheckFlowComputation
): ObservedPaycheckFlowSnapshot {
  return {
    takeHomeBaselineBiweekly:
      computation.takeHomeBaselineBiweeklyCents != null
        ? centsToDollarsString(computation.takeHomeBaselineBiweeklyCents)
        : null,
    takeHomeSource: computation.takeHomeSource,
    currentBiweeklyRetirementContribution: centsToDollarsString(
      computation.currentBiweeklyRetirementContributionCents
    ),
    currentBiweeklyTraditional401kContribution: centsToDollarsString(
      computation.currentBiweeklyTraditional401kContributionCents
    ),
    currentBiweeklyRoth401kContribution: centsToDollarsString(
      computation.currentBiweeklyRoth401kContributionCents
    ),
    currentBiweeklyTaxableBrokerageDeposit: centsToDollarsString(
      computation.currentBiweeklyTaxableBrokerageDepositCents
    ),
    currentBiweeklyRothIraContribution: centsToDollarsString(
      computation.currentBiweeklyRothIraContributionCents
    ),
    currentBiweeklyHsaEmployeeContribution: centsToDollarsString(
      computation.currentBiweeklyHsaEmployeeContributionCents
    ),
    currentBiweeklyHsaEmployerContribution: centsToDollarsString(
      computation.currentBiweeklyHsaEmployerContributionCents
    ),
    percentOfTakeHomeToRetirement:
      computation.currentTakeHomeRetirementRateBps != null
        ? (computation.currentTakeHomeRetirementRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToTraditional401k:
      computation.currentTakeHomeTraditional401kRateBps != null
        ? (computation.currentTakeHomeTraditional401kRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToRoth401k:
      computation.currentTakeHomeRoth401kRateBps != null
        ? (computation.currentTakeHomeRoth401kRateBps / 100).toFixed(1)
        : null,
    percentOfTakeHomeToTaxableBrokerage:
      computation.currentTakeHomeTaxableBrokerageRateBps != null
        ? (computation.currentTakeHomeTaxableBrokerageRateBps / 100).toFixed(1)
        : null,
    recentPayPeriods: computation.recentPayPeriods.map((period) => ({
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
    notes: computation.notes
  };
}

export async function getObservedPaycheckFlowComputation(): Promise<ObservedPaycheckFlowComputation> {
  const userId = await getDefaultUserId();
  const [profile, paycheckTransactions, manualInvestmentTransactions, plaidInvestmentTransactions] =
    await Promise.all([
      getOrCreateUserProfile(),
      prisma.transaction.findMany({
        where: {
          userId,
          direction: "credit",
          OR: [
            {
              category: {
                is: {
                  key: "paycheck"
                }
              }
            },
            {
              aiSuggestedCategory: {
                is: {
                  key: "paycheck"
                }
              }
            }
          ]
        },
        orderBy: {
          date: "desc"
        },
        take: 16,
        select: {
          date: true,
          amount: true
        }
      }),
      prisma.manualInvestmentTransaction.findMany({
        where: {
          userId
        },
        orderBy: {
          date: "desc"
        },
        take: 200,
        select: {
          date: true,
          amount: true,
          type: true,
          subtype: true,
          name: true,
          manualInvestmentAccount: {
            select: {
              subtype: true,
              bucket: true
            }
          }
        }
      }),
      prisma.investmentTransaction.findMany({
        where: {
          account: {
            is: {
              userId
            }
          }
        },
        orderBy: {
          date: "desc"
        },
        take: 200,
        select: {
          date: true,
          amount: true,
          type: true,
          subtype: true,
          name: true,
          account: {
            select: {
              subtype: true,
              name: true
            }
          }
        }
      })
    ]);

  const paycheckEvents: FlowEvent[] = paycheckTransactions.map((transaction) => ({
    kind: "take_home_paycheck",
    date: transaction.date,
    amountCents: decimalStringToCents(transaction.amount.toString())
  }));
  const significantPaycheckEvents = paycheckEvents.filter(
    (event) => event.amountCents >= MIN_SIGNIFICANT_PAYCHECK_CENTS
  );

  const manualFlowEvents = manualInvestmentTransactions
    .map((transaction) =>
      normalizeManualFlowEvent({
        accountSubtype: transaction.manualInvestmentAccount.subtype,
        bucket: transaction.manualInvestmentAccount.bucket,
        type: transaction.type,
        subtype: transaction.subtype,
        name: transaction.name,
        amountCents: decimalStringToCents(transaction.amount.toString()),
        date: transaction.date
      })
    )
    .filter((event): event is FlowEvent => event !== null);

  const plaidFlowEvents = plaidInvestmentTransactions
    .map((transaction) =>
      normalizePlaidInvestmentFlowEvent({
        accountSubtype: transaction.account.subtype,
        accountName: transaction.account.name,
        type: transaction.type,
        subtype: transaction.subtype,
        amountCents: decimalStringToCents(transaction.amount.toString()),
        date: transaction.date
      })
    )
    .filter((event): event is FlowEvent => event !== null);

  const retirementFlowEvents = [...manualFlowEvents, ...plaidFlowEvents].filter((event) =>
    [
      "retirement_plan_total",
      "traditional_401k_allocation",
      "roth_401k_allocation",
      "roth_ira_contribution"
    ].includes(event.kind)
  );
  const taxableBrokerageDepositEvents = [...manualFlowEvents, ...plaidFlowEvents].filter(
    (event) => event.kind === "taxable_brokerage_deposit"
  );
  const hsaFlowEvents = [...manualFlowEvents, ...plaidFlowEvents].filter((event) =>
    ["hsa_employee_contribution", "hsa_employer_contribution"].includes(event.kind)
  );

  const retirementCycles = clusterFlowEvents(
    retirementFlowEvents,
    RETIREMENT_CLUSTER_GAP_DAYS
  )
    .map(summarizeFlowCluster)
    .filter((period) => period.totalRetirementContributionCents > 0)
    .sort(
      (left, right) =>
        parseAnchorDate(right.anchorDate).getTime() -
        parseAnchorDate(left.anchorDate).getTime()
    );
  const paycheckPeriods = significantPaycheckEvents.map((event) =>
    summarizeFlowCluster([event])
  );
  const taxableBrokeragePeriods = taxableBrokerageDepositEvents.map((event) =>
    summarizeFlowCluster([event])
  );
  const hsaPeriods = clusterFlowEvents(hsaFlowEvents, HSA_CLUSTER_GAP_DAYS)
    .map(summarizeFlowCluster)
    .filter(
      (period) =>
        period.hsaEmployeeContributionCents > 0 ||
        period.hsaEmployerContributionCents > 0
    );

  const recentPayPeriods = mergeFlowPeriodSummaries(
    [...paycheckPeriods, ...retirementCycles, ...taxableBrokeragePeriods, ...hsaPeriods],
    RECENT_PERIOD_MERGE_GAP_DAYS
  )
    .sort(
      (left, right) =>
        parseAnchorDate(right.anchorDate).getTime() -
        parseAnchorDate(left.anchorDate).getTime()
    )
    .slice(0, 6);

  const retirementAveragingWindow = retirementCycles.slice(0, 4);
  const takeHomeBaselineBiweeklyFromTransactions = average(
    significantPaycheckEvents
      .map((event) => event.amountCents)
      .filter((value) => value > 0)
  );
  const takeHomeBaselineFromProfile = decimalStringToCents(profile.biweeklyNetPay);
  const takeHomeBaselineBiweeklyCents =
    takeHomeBaselineBiweeklyFromTransactions > 0
      ? takeHomeBaselineBiweeklyFromTransactions
      : takeHomeBaselineFromProfile > 0
        ? takeHomeBaselineFromProfile
        : null;
  const takeHomeSource =
    takeHomeBaselineBiweeklyFromTransactions > 0
      ? ("transactions" as const)
      : takeHomeBaselineFromProfile > 0
        ? ("profile" as const)
        : ("unknown" as const);

  const currentBiweeklyRetirementContributionCents = average(
    retirementAveragingWindow.map((period) => period.totalRetirementContributionCents)
  );
  const currentBiweeklyTraditional401kContributionCents = average(
    retirementAveragingWindow.map((period) => period.traditional401kContributionCents)
  );
  const currentBiweeklyRoth401kContributionCents = average(
    retirementAveragingWindow.map((period) => period.roth401kContributionCents)
  );
  const currentBiweeklyTaxableBrokerageDepositCents = average(
    taxableBrokerageDepositEvents.map((event) => event.amountCents)
  );
  const currentBiweeklyRothIraContributionCents = average(
    retirementAveragingWindow.map((period) => period.rothIraContributionCents)
  );
  const currentBiweeklyHsaEmployeeContributionCents = average(
    hsaPeriods.map((period) => period.hsaEmployeeContributionCents)
  );
  const currentBiweeklyHsaEmployerContributionCents = average(
    hsaPeriods.map((period) => period.hsaEmployerContributionCents)
  );

  const notes = [
    "Take-home percentages use paycheck deposits when they are available, otherwise the saved biweekly net-pay profile.",
    "401(k) and BrokerageLink percentages are shown relative to take-home pay, so they are a practical cash-flow lens rather than a formal gross-pay deferral rate."
  ];

  if (paycheckEvents.length !== significantPaycheckEvents.length) {
    notes.push(
      "Tiny payroll verification credits are ignored when estimating take-home pay so they do not distort the paycheck baseline."
    );
  }

  if (significantPaycheckEvents.length < 3) {
    notes.push(
      "The take-home baseline currently comes from a small number of detected paycheck deposits, so treat it as directional until more payroll history is available."
    );
  }

  if (currentBiweeklyTaxableBrokerageDepositCents > 0) {
    notes.push(
      "Recurring taxable brokerage deposits are inferred from Fidelity cash transfers and may be funded from cash already sitting in your bank or cash-management accounts."
    );
  }

  if (retirementCycles.length > 0) {
    notes.push(
      "Retirement contribution averages are deduplicated from Fidelity plan contributions and BrokerageLink transfer records so the same pay cycle is not counted twice."
    );
  }

  return {
    takeHomeBaselineBiweeklyCents,
    takeHomeSource,
    currentBiweeklyRetirementContributionCents,
    currentBiweeklyTraditional401kContributionCents,
    currentBiweeklyRoth401kContributionCents,
    currentBiweeklyTaxableBrokerageDepositCents,
    currentBiweeklyRothIraContributionCents,
    currentBiweeklyHsaEmployeeContributionCents,
    currentBiweeklyHsaEmployerContributionCents,
    currentTakeHomeRetirementRateBps: calculateRateBps(
      currentBiweeklyRetirementContributionCents,
      takeHomeBaselineBiweeklyCents
    ),
    currentTakeHomeTraditional401kRateBps: calculateRateBps(
      currentBiweeklyTraditional401kContributionCents,
      takeHomeBaselineBiweeklyCents
    ),
    currentTakeHomeRoth401kRateBps: calculateRateBps(
      currentBiweeklyRoth401kContributionCents,
      takeHomeBaselineBiweeklyCents
    ),
    currentTakeHomeTaxableBrokerageRateBps: calculateRateBps(
      currentBiweeklyTaxableBrokerageDepositCents,
      takeHomeBaselineBiweeklyCents
    ),
    recentPayPeriods,
    notes
  };
}

export async function getObservedPaycheckFlowSnapshot(): Promise<ObservedPaycheckFlowSnapshot> {
  return buildObservedPaycheckFlowSnapshot(
    await getObservedPaycheckFlowComputation()
  );
}

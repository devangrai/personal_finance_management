"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata,
  type PlaidLinkOnSuccessMetadata,
  usePlaidLink
} from "react-plaid-link";
import {
  clearPlaidLinkSession,
  readPlaidLinkSession,
  type StoredPlaidLinkSession,
  writePlaidLinkSession
} from "@/lib/plaid-link-session";
import { formatCanonicalDate, formatLocalTimestamp } from "@/lib/date-utils";
import { AdvisorChat } from "@/components/advisor-chat";

type PlaidLinkLauncherProps = {
  linkToken: string | null;
  linkSession: StoredPlaidLinkSession | null;
  pendingOpen: boolean;
  onOpened: () => void;
  onSuccess: (
    publicToken: string,
    metadata: PlaidLinkOnSuccessMetadata,
    session: StoredPlaidLinkSession | null
  ) => Promise<void>;
  onExit: (
    error: PlaidLinkError | null,
    metadata: PlaidLinkOnExitMetadata
  ) => void;
  onReadyChange: (ready: boolean) => void;
};

type LinkedAccount = {
  id: string;
  plaidAccountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  subtype: string | null;
  type: string;
  currentBalance: string | null;
  availableBalance: string | null;
  isoCurrencyCode: string | null;
  plaidItem: {
    id: string;
    institutionId: string | null;
    institutionName: string | null;
    status: string;
    errorCode: string | null;
    plaidEnvironment: string;
    lastWebhookAt: string | null;
    lastSyncedAt: string | null;
    updatedAt: string;
  };
};

type AccountsResponse = {
  userEmail: string;
  accounts: LinkedAccount[];
};

type RecentTransaction = {
  id: string;
  plaidTransactionId: string;
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  amount: string;
  direction: "debit" | "credit";
  isPending: boolean;
  personalFinanceCategory: string | null;
  reviewStatus: string;
  aiSuggestedConfidence: number | null;
  aiSuggestedReason: string | null;
  aiSuggestedByModel: string | null;
  aiSuggestedAt: string | null;
  category: {
    id: string;
    key: string;
    label: string;
  } | null;
  aiSuggestedCategory: {
    id: string;
    key: string;
    label: string;
  } | null;
  account: {
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string | null;
    plaidItem: {
      institutionName: string | null;
    };
  };
};

type TransactionsResponse = {
  transactions: RecentTransaction[];
};

type TransactionCategory = {
  id: string;
  key: string;
  label: string;
  parentKey: string | null;
  isSystem: boolean;
};

type CategoriesResponse = {
  categories: TransactionCategory[];
};

type PlaidItemSummary = {
  id: string;
  institutionId: string | null;
  institutionName: string | null;
  status: string;
  errorCode: string | null;
  plaidEnvironment: string;
  lastWebhookAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string;
  accountCount: number;
};

type CashflowSummaryMonth = {
  month: string;
  label: string;
  income: string;
  investing: string;
  spending: string;
  transfers: string;
  netCashflow: string;
  uncategorizedOutflow: string;
  reviewedTransactionCount: number;
  uncategorizedTransactionCount: number;
  reviewedSpendRatioBps: number;
  topCategories: Array<{
    key: string;
    label: string;
    amount: string;
    shareBps: number;
  }>;
};

type CashflowSummaryResponse = {
  latestMonth: CashflowSummaryMonth | null;
  months: CashflowSummaryMonth[];
};

type CreateRuleResponse = {
  existed: boolean;
  appliedCount: number;
  rule: {
    id: string;
    name: string;
  };
};

type RecurringCandidate = {
  averageAmount: string;
  categoryLabel: string | null;
  confidenceScore: number;
  direction: "credit" | "debit";
  displayName: string;
  frequency: "weekly" | "biweekly" | "monthly" | "quarterly" | "unknown";
  latestAmount: string;
  lastDate: string;
  nextExpectedDate: string | null;
  occurrenceCount: number;
  reviewState: string;
};

type RecurringSummaryResponse = {
  inflows: RecurringCandidate[];
  outflows: RecurringCandidate[];
};

type DailyReviewDigest = {
  id: string;
  localDateKey: string;
  timezone: string;
  scheduledHourLocal: number;
  transactionCount: number;
  autoCategorizedCount: number;
  uncategorizedCount: number;
  needsReviewCount: number;
  reviewUrl: string | null;
  status: string;
  sentAt: string | null;
  acknowledgedAt: string | null;
  lastError: string | null;
};

type LatestDailyReviewDigestResponse = {
  digest: DailyReviewDigest | null;
};

type DailyReviewRunResponse = {
  localDateKey: string;
  timezone: string;
  scheduledHourLocal: number;
  status: "skipped" | "created" | "updated";
  digest: DailyReviewDigest | null;
  categorization: {
    attemptedCount: number;
    categorizedCount: number;
    leftUncategorizedCount: number;
    model: string | null;
  } | null;
};

type AutoCategorizeResponse = {
  attemptedCount: number;
  categorizedCount: number;
  leftUncategorizedCount: number;
  model: string;
};

type SuggestedTransactionRule = {
  id: string;
  matchType: "merchant_name" | "transaction_name";
  matchValue: string;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  occurrenceCount: number;
  sampleTransactionIds: string[];
  sampleDescription: string;
  reason: string;
};

type SuggestedTransactionRulesResponse = {
  suggestions: SuggestedTransactionRule[];
};

type ApplySuggestedTransactionRulesResponse = {
  appliedSuggestionCount: number;
  rulesCreatedCount: number;
  transactionsAffectedCount: number;
};

type UserProfileSnapshot = {
  birthYear: number | null;
  dependents: number;
  housingStatus: "rent_free" | "rent" | "mortgage" | "other";
  annualIncome: string | null;
  biweeklyNetPay: string | null;
  monthlyFixedExpense: string | null;
  emergencyFundTarget: string | null;
  targetRetirementSavingsRate: string | null;
  notes: string | null;
};

type UserProfileResponse = {
  profile: UserProfileSnapshot;
};

type RetirementRecommendationResponse = {
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

type AdvisorPlanResponse = {
  facts: {
    averageMonthlyIncome: string;
    averageMonthlySpending: string;
    averageMonthlyInvesting: string;
    averageMonthlyNetCashflow: string;
    averageMonthlyFreeCashflow: string;
    averageMonthlyRecurringIncome: string;
    averageMonthlyRecurringOutflows: string;
    reviewedSpendCoveragePercent: string;
    liquidCashBalance: string;
    emergencyFundTarget: string;
    emergencyFundRunwayMonths: string;
    housingStatus: UserProfileSnapshot["housingStatus"];
    biweeklyNetPay: string | null;
    monthlyFixedExpense: string;
  };
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
  paycheckFlow: {
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
  paycheckAllocation: {
    availableBiweeklySurplus: string;
    monthlyFreeCashflow: string;
    scenarios: Array<{
      key: "conservative" | "balanced" | "aggressive";
      label: string;
      biweeklyAmounts: {
        retirement: string;
        emergencyFund: string;
        taxableInvesting: string;
        reserve: string;
      };
      reasoning: string[];
    }>;
  };
};

type InvestmentsSummaryResponse = {
  totals: {
    accountCount: number;
    holdingsCount: number;
    investmentTransactionCount: number;
    totalBalance: string;
    retirementBalance: string;
    taxableBalance: string;
    latestSnapshotAt: string | null;
  };
  accounts: Array<{
    id: string;
    name: string;
    officialName: string | null;
    mask: string | null;
    subtype: string | null;
    currentBalance: string;
    institutionName: string | null;
    bucket: "retirement" | "taxable" | "other";
    holdingCount: number;
    lastHoldingsAsOf: string | null;
    source: "plaid" | "manual";
  }>;
  topHoldings: Array<{
    accountId: string;
    accountName: string;
    institutionName: string | null;
    securityName: string;
    symbol: string | null;
    institutionValue: string;
    quantity: string | null;
    asOf: string;
    source: "plaid" | "manual";
  }>;
  recentTransactions: Array<{
    id: string;
    date: string;
    name: string;
    type: string;
    subtype: string | null;
    amount: string;
    quantity: string | null;
    price: string | null;
    symbol: string | null;
    accountName: string;
    accountSubtype: string | null;
    institutionName: string | null;
    source: "plaid" | "manual";
  }>;
};

type ManualInvestmentImportPreviewResponse =
  | {
      fileName: string;
      importKind: "transactions";
      accountName: string;
      accountSubtype: string | null;
      bucket: "retirement" | "taxable" | "other";
      isoCurrencyCode: string;
      rowCount: number;
      previewRows: Array<{
        date: string;
        name: string;
        type: string;
        subtype: string | null;
        symbol: string | null;
        amount: string;
        quantity: string | null;
        price: string | null;
        fees: string | null;
      }>;
      detectedColumns: string[];
      warnings: string[];
    }
  | {
      fileName: string;
      importKind: "holdings";
      accountName: string;
      accountSubtype: string | null;
      bucket: "retirement" | "taxable" | "other";
      isoCurrencyCode: string;
      rowCount: number;
      asOf: string;
      previewRows: Array<{
        asOf: string;
        securityName: string;
        symbol: string | null;
        quantity: string | null;
        institutionPrice: string | null;
        institutionValue: string;
        costBasis: string | null;
      }>;
      detectedColumns: string[];
      warnings: string[];
    };

type ManualInvestmentImportCommitResponse = {
  importKind: "transactions" | "holdings";
  account: {
    id: string;
    name: string;
    subtype: string | null;
    bucket: "retirement" | "taxable" | "other";
    source: string;
  };
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  warnings: string[];
};

const plaidSetupSteps = [
  "Create a free Plaid developer account and open the Dashboard.",
  "Copy your Sandbox client_id and secret into the app .env file.",
  "Use a real HTTPS redirect URI that points to /plaid/oauth-return when you move to OAuth institutions in production.",
  "Apply the Prisma migration to your local Postgres database before testing account linking."
];

function formatBalance(account: LinkedAccount) {
  const currency = account.isoCurrencyCode ?? "USD";
  const currentBalance = account.currentBalance;

  if (!currentBalance) {
    return "Balance unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency
  }).format(Number(currentBalance));
}

function formatTransactionAmount(transaction: RecentTransaction) {
  const prefix = transaction.direction === "credit" ? "+" : "-";

  return `${prefix}${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(transaction.amount))}`;
}

function formatCalendarDate(value: string) {
  return formatCanonicalDate(value);
}

function formatTimestamp(value: string) {
  return formatLocalTimestamp(value);
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value));
}

function parseMoneyString(value: string | null | undefined) {
  return value ? Number(value) : 0;
}

function formatPercent(value: number) {
  return `${value.toFixed(0)}%`;
}

function formatFrequency(value: RecurringCandidate["frequency"]) {
  switch (value) {
    case "biweekly":
      return "Biweekly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "weekly":
      return "Weekly";
    default:
      return "Irregular";
  }
}

function formatShortDate(value: string | null) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatPlaidItemStatus(status: string) {
  switch (status) {
    case "needs_reauth":
      return "Needs re-auth";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
    default:
      return "Healthy";
  }
}

function formatDailyReviewStatus(status: string) {
  switch (status) {
    case "sent":
      return "Ping delivered";
    case "acknowledged":
      return "Acknowledged";
    case "failed":
      return "Ping failed";
    default:
      return "Pending review";
  }
}

function formatDailyReviewHour(hour: number) {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const date = new Date(Date.UTC(2026, 0, 1, normalizedHour, 0, 0));

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC"
  }).format(date);
}

function formatHousingStatus(value: UserProfileSnapshot["housingStatus"]) {
  switch (value) {
    case "rent_free":
      return "Rent free";
    case "mortgage":
      return "Mortgage";
    case "rent":
      return "Rent";
    default:
      return "Other";
  }
}

function formatInvestmentBucket(value: "retirement" | "taxable" | "other") {
  switch (value) {
    case "retirement":
      return "Retirement";
    case "taxable":
      return "Taxable";
    default:
      return "Other";
  }
}

function formatInvestmentSource(value: "plaid" | "manual") {
  return value === "manual" ? "Manual import" : "Plaid";
}

function formatRetirementStatus(
  value: "below_target" | "on_track" | "aggressive" | "insufficient_data"
) {
  switch (value) {
    case "below_target":
      return "Below target";
    case "on_track":
      return "On track";
    case "aggressive":
      return "Aggressive";
    default:
      return "Needs context";
  }
}

function PlaidLinkLauncher({
  linkToken,
  linkSession,
  pendingOpen,
  onOpened,
  onSuccess,
  onExit,
  onReadyChange
}: PlaidLinkLauncherProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (
      publicToken: string,
      metadata: PlaidLinkOnSuccessMetadata
    ) => {
      await onSuccess(publicToken, metadata, linkSession);
    },
    onExit
  });

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  useEffect(() => {
    if (ready && pendingOpen) {
      open();
      onOpened();
    }
  }, [onOpened, open, pendingOpen, ready]);

  return null;
}

export function PlaidConnectionPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [cashflowSummary, setCashflowSummary] =
    useState<CashflowSummaryResponse | null>(null);
  const [recurringSummary, setRecurringSummary] =
    useState<RecurringSummaryResponse | null>(null);
  const [dailyReviewDigest, setDailyReviewDigest] =
    useState<DailyReviewDigest | null>(null);
  const [suggestedRules, setSuggestedRules] = useState<SuggestedTransactionRule[]>(
    []
  );
  const [profile, setProfile] = useState<UserProfileSnapshot | null>(null);
  const [retirementRecommendation, setRetirementRecommendation] =
    useState<RetirementRecommendationResponse | null>(null);
  const [advisorPlan, setAdvisorPlan] = useState<AdvisorPlanResponse | null>(null);
  const [investmentsSummary, setInvestmentsSummary] =
    useState<InvestmentsSummaryResponse | null>(null);
  const [manualImportPreview, setManualImportPreview] =
    useState<ManualInvestmentImportPreviewResponse | null>(null);
  const [profileForm, setProfileForm] = useState({
    housingStatus: "rent_free" as UserProfileSnapshot["housingStatus"],
    biweeklyNetPay: "",
    monthlyFixedExpense: "",
    emergencyFundTarget: "",
    targetRetirementSavingsRate: "",
    notes: ""
  });
  const [userEmail, setUserEmail] = useState<string>("owner@example.com");
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [cashflowError, setCashflowError] = useState<string | null>(null);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [dailyReviewError, setDailyReviewError] = useState<string | null>(null);
  const [suggestedRulesError, setSuggestedRulesError] = useState<string | null>(
    null
  );
  const [profileError, setProfileError] = useState<string | null>(null);
  const [retirementRecommendationError, setRetirementRecommendationError] =
    useState<string | null>(null);
  const [advisorPlanError, setAdvisorPlanError] = useState<string | null>(null);
  const [investmentsError, setInvestmentsError] = useState<string | null>(null);
  const [manualImportError, setManualImportError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkSession, setLinkSession] = useState<StoredPlaidLinkSession | null>(null);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [isLoadingCashflow, setIsLoadingCashflow] = useState(true);
  const [isLoadingRecurring, setIsLoadingRecurring] = useState(true);
  const [isLoadingDailyReview, setIsLoadingDailyReview] = useState(true);
  const [isLoadingSuggestedRules, setIsLoadingSuggestedRules] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isLoadingRetirementRecommendation, setIsLoadingRetirementRecommendation] =
    useState(true);
  const [isLoadingAdvisorPlan, setIsLoadingAdvisorPlan] = useState(true);
  const [isLoadingInvestments, setIsLoadingInvestments] = useState(true);
  const [isCreatingLinkToken, setIsCreatingLinkToken] = useState(false);
  const [isSyncingTransactions, setIsSyncingTransactions] = useState(false);
  const [isSyncingInvestments, setIsSyncingInvestments] = useState(false);
  const [isPreviewingManualImport, setIsPreviewingManualImport] = useState(false);
  const [isImportingManualInvestments, setIsImportingManualInvestments] =
    useState(false);
  const [isAutoCategorizing, setIsAutoCategorizing] = useState(false);
  const [isRunningDailyReview, setIsRunningDailyReview] = useState(false);
  const [isApplyingSuggestedRules, setIsApplyingSuggestedRules] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [disconnectingPlaidItemId, setDisconnectingPlaidItemId] = useState<
    string | null
  >(null);
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null);
  const [creatingRuleTransactionId, setCreatingRuleTransactionId] = useState<
    string | null
  >(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [isLinkReady, setIsLinkReady] = useState(false);
  const [linkLauncherKey, setLinkLauncherKey] = useState(0);
  const [manualImportForm, setManualImportForm] = useState({
    importKind: "transactions" as "transactions" | "holdings",
    accountName: "",
    accountSubtype: "",
    bucket: "retirement" as "retirement" | "taxable" | "other",
    isoCurrencyCode: "USD",
    asOfDate: new Date().toISOString().slice(0, 10)
  });
  const [manualImportFile, setManualImportFile] = useState<File | null>(null);
  const reviewDate = searchParams.get("reviewDate");
  const transactionLimit = reviewDate ? 100 : 25;

  async function refreshAccounts() {
    setIsLoadingAccounts(true);
    setAccountsError(null);

    try {
      const response = await fetch("/api/accounts", {
        method: "GET"
      });
      const payload = (await response.json()) as AccountsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load linked accounts.");
      }

      setAccounts(payload.accounts);
      setUserEmail(payload.userEmail);
    } catch (error) {
      setAccountsError(
        error instanceof Error ? error.message : "Unable to load linked accounts."
      );
    } finally {
      setIsLoadingAccounts(false);
    }
  }

  async function refreshTransactions() {
    setIsLoadingTransactions(true);
    setTransactionsError(null);

    try {
      const params = new URLSearchParams({
        limit: String(transactionLimit)
      });
      if (reviewDate) {
        params.set("date", reviewDate);
      }

      const response = await fetch(`/api/transactions?${params.toString()}`, {
        method: "GET"
      });
      const payload = (await response.json()) as TransactionsResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load transactions.");
      }

      setTransactions(payload.transactions);
    } catch (error) {
      setTransactionsError(
        error instanceof Error ? error.message : "Unable to load transactions."
      );
    } finally {
      setIsLoadingTransactions(false);
    }
  }

  async function refreshCategories() {
    setCategoriesError(null);

    try {
      const response = await fetch("/api/categories", {
        method: "GET"
      });
      const payload = (await response.json()) as CategoriesResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load categories.");
      }

      setCategories(payload.categories);
    } catch (error) {
      setCategoriesError(
        error instanceof Error ? error.message : "Unable to load categories."
      );
    }
  }

  async function refreshCashflowSummary() {
    setIsLoadingCashflow(true);
    setCashflowError(null);

    try {
      const response = await fetch("/api/cashflow/summary?months=6", {
        method: "GET"
      });
      const payload = (await response.json()) as CashflowSummaryResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load cash flow summary.");
      }

      setCashflowSummary(payload);
    } catch (error) {
      setCashflowError(
        error instanceof Error ? error.message : "Unable to load cash flow summary."
      );
    } finally {
      setIsLoadingCashflow(false);
    }
  }

  async function refreshRecurringSummary() {
    setIsLoadingRecurring(true);
    setRecurringError(null);

    try {
      const response = await fetch("/api/recurring/summary", {
        method: "GET"
      });
      const payload = (await response.json()) as RecurringSummaryResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load recurring summary.");
      }

      setRecurringSummary(payload);
    } catch (error) {
      setRecurringError(
        error instanceof Error ? error.message : "Unable to load recurring summary."
      );
    } finally {
      setIsLoadingRecurring(false);
    }
  }

  async function refreshDailyReviewDigest() {
    setIsLoadingDailyReview(true);
    setDailyReviewError(null);

    try {
      const response = await fetch("/api/daily-review/latest", {
        method: "GET"
      });
      const payload = (await response.json()) as LatestDailyReviewDigestResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load the daily review digest.");
      }

      setDailyReviewDigest(payload.digest);
    } catch (error) {
      setDailyReviewError(
        error instanceof Error
          ? error.message
          : "Unable to load the daily review digest."
      );
    } finally {
      setIsLoadingDailyReview(false);
    }
  }

  async function refreshSuggestedRules() {
    setIsLoadingSuggestedRules(true);
    setSuggestedRulesError(null);

    try {
      const response = await fetch("/api/transaction-rules/suggestions", {
        method: "GET"
      });
      const payload = (await response.json()) as SuggestedTransactionRulesResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Unable to load suggested transaction rules."
        );
      }

      setSuggestedRules(payload.suggestions);
    } catch (error) {
      setSuggestedRulesError(
        error instanceof Error
          ? error.message
          : "Unable to load suggested transaction rules."
      );
    } finally {
      setIsLoadingSuggestedRules(false);
    }
  }

  async function refreshProfile() {
    setIsLoadingProfile(true);
    setProfileError(null);

    try {
      const response = await fetch("/api/profile", {
        method: "GET"
      });
      const payload = (await response.json()) as UserProfileResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load the user profile.");
      }

      setProfile(payload.profile);
      setProfileForm({
        housingStatus: payload.profile.housingStatus,
        biweeklyNetPay: payload.profile.biweeklyNetPay ?? "",
        monthlyFixedExpense: payload.profile.monthlyFixedExpense ?? "",
        emergencyFundTarget: payload.profile.emergencyFundTarget ?? "",
        targetRetirementSavingsRate:
          payload.profile.targetRetirementSavingsRate ?? "",
        notes: payload.profile.notes ?? ""
      });
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : "Unable to load the user profile."
      );
    } finally {
      setIsLoadingProfile(false);
    }
  }

  async function refreshRetirementRecommendation() {
    setIsLoadingRetirementRecommendation(true);
    setRetirementRecommendationError(null);

    try {
      const response = await fetch("/api/advisor/retirement", {
        method: "GET"
      });
      const payload = (await response.json()) as RetirementRecommendationResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Unable to load the retirement recommendation."
        );
      }

      setRetirementRecommendation(payload);
    } catch (error) {
      setRetirementRecommendationError(
        error instanceof Error
          ? error.message
          : "Unable to load the retirement recommendation."
      );
    } finally {
      setIsLoadingRetirementRecommendation(false);
    }
  }

  async function refreshAdvisorPlan() {
    setIsLoadingAdvisorPlan(true);
    setAdvisorPlanError(null);

    try {
      const response = await fetch("/api/advisor/plan", {
        method: "GET"
      });
      const payload = (await response.json()) as AdvisorPlanResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load the advisor plan.");
      }

      setAdvisorPlan(payload);
    } catch (error) {
      setAdvisorPlanError(
        error instanceof Error ? error.message : "Unable to load the advisor plan."
      );
    } finally {
      setIsLoadingAdvisorPlan(false);
    }
  }

  async function refreshInvestmentsSummary() {
    setIsLoadingInvestments(true);
    setInvestmentsError(null);

    try {
      const response = await fetch("/api/investments/summary", {
        method: "GET"
      });
      const payload = (await response.json()) as InvestmentsSummaryResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load investments summary.");
      }

      setInvestmentsSummary(payload);
    } catch (error) {
      setInvestmentsError(
        error instanceof Error ? error.message : "Unable to load investments summary."
      );
    } finally {
      setIsLoadingInvestments(false);
    }
  }

  function buildManualImportFormData() {
    if (!manualImportFile) {
      throw new Error("Choose a Fidelity CSV file before continuing.");
    }

    const formData = new FormData();
    formData.set("file", manualImportFile);
    formData.set("importKind", manualImportForm.importKind);
    formData.set("accountName", manualImportForm.accountName);
    formData.set("accountSubtype", manualImportForm.accountSubtype);
    formData.set("bucket", manualImportForm.bucket);
    formData.set("isoCurrencyCode", manualImportForm.isoCurrencyCode || "USD");
    formData.set("asOfDate", manualImportForm.asOfDate);
    formData.set("source", "fidelity_csv");
    return formData;
  }

  async function handlePreviewManualImport() {
    setIsPreviewingManualImport(true);
    setManualImportError(null);

    try {
      const response = await fetch("/api/investments/import/preview", {
        method: "POST",
        body: buildManualImportFormData()
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const errorMessage =
          typeof payload === "object" &&
          payload &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Unable to preview the Fidelity import.";
        throw new Error(errorMessage);
      }

      setManualImportPreview(payload as ManualInvestmentImportPreviewResponse);
      setStatusMessage("Manual Fidelity import preview is ready.");
    } catch (error) {
      setManualImportError(
        error instanceof Error
          ? error.message
          : "Unable to preview the Fidelity import."
      );
      setManualImportPreview(null);
    } finally {
      setIsPreviewingManualImport(false);
    }
  }

  async function handleCommitManualImport() {
    setIsImportingManualInvestments(true);
    setManualImportError(null);

    try {
      const response = await fetch("/api/investments/import/commit", {
        method: "POST",
        body: buildManualImportFormData()
      });
      const payload = (await response.json()) as unknown;

      if (!response.ok) {
        const errorMessage =
          typeof payload === "object" &&
          payload &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Unable to import the Fidelity CSV.";
        throw new Error(errorMessage);
      }

      const successPayload = payload as ManualInvestmentImportCommitResponse;
      setStatusMessage(
        `Imported ${successPayload.importedCount} ${successPayload.importKind} row(s) into ${successPayload.account.name}.`
      );
      setManualImportPreview(null);
      await Promise.all([refreshInvestmentsSummary(), refreshAdvisorPlan()]);
    } catch (error) {
      setManualImportError(
        error instanceof Error
          ? error.message
          : "Unable to import the Fidelity CSV."
      );
    } finally {
      setIsImportingManualInvestments(false);
    }
  }

  useEffect(() => {
    void refreshAccounts();
    void refreshCategories();
    void refreshCashflowSummary();
    void refreshRecurringSummary();
    void refreshDailyReviewDigest();
    void refreshSuggestedRules();
    void refreshProfile();
    void refreshRetirementRecommendation();
    void refreshAdvisorPlan();
    void refreshInvestmentsSummary();
  }, []);

  useEffect(() => {
    void refreshTransactions();
  }, [reviewDate]);

  useEffect(() => {
    setManualImportPreview(null);
    setManualImportError(null);
  }, [
    manualImportFile,
    manualImportForm.accountName,
    manualImportForm.accountSubtype,
    manualImportForm.asOfDate,
    manualImportForm.bucket,
    manualImportForm.importKind,
    manualImportForm.isoCurrencyCode
  ]);

  const linkedItems = useMemo(() => {
    const items = new Map<string, PlaidItemSummary>();

    for (const account of accounts) {
      const current = items.get(account.plaidItem.id);

      if (current) {
        current.accountCount += 1;
        continue;
      }

      items.set(account.plaidItem.id, {
        ...account.plaidItem,
        accountCount: 1
      });
    }

    return Array.from(items.values());
  }, [accounts]);

  const reviewQueue = useMemo(
    () =>
      transactions
        .filter(
          (transaction) =>
            transaction.reviewStatus === "uncategorized" ||
            transaction.reviewStatus === "auto_categorized"
        )
        .slice(0, 6),
    [transactions]
  );

  const dashboardActionItems = useMemo(() => {
    const items: Array<{
      title: string;
      detail: string;
    }> = [];

    if (!profileForm.biweeklyNetPay) {
      items.push({
        title: "Add your biweekly net pay",
        detail:
          "The advisor is already reading Fidelity contribution flows, but this one input will tighten the recommendation layer considerably."
      });
    }

    if (reviewQueue.length > 0) {
      items.push({
        title: `Review ${reviewQueue.length} recent transaction${reviewQueue.length === 1 ? "" : "s"}`,
        detail:
          "These are the newest items still marked auto-categorized or uncategorized, so they are the highest-leverage cleanup pass."
      });
    }

    if (suggestedRules.length > 0) {
      items.push({
        title: `Create ${suggestedRules.length} reusable rule${suggestedRules.length === 1 ? "" : "s"}`,
        detail:
          "Repeated merchant patterns are ready to become permanent rules so tomorrow's review queue gets smaller."
      });
    }

    if ((investmentsSummary?.totals.holdingsCount ?? 0) === 0) {
      items.push({
        title: "Import a holdings snapshot next",
        detail:
          "The cashflow side is strong now. A holdings snapshot is the next step toward better portfolio allocation advice."
      });
    }

    if (items.length === 0) {
      items.push({
        title: "Cash flow looks operational",
        detail:
          "The next upgrade is more about precision than cleanup: richer payroll inputs and holdings snapshots."
      });
    }

    return items.slice(0, 4);
  }, [
    investmentsSummary?.totals.holdingsCount,
    profileForm.biweeklyNetPay,
    reviewQueue.length,
    suggestedRules.length
  ]);

  const chatSuggestedPrompts = useMemo(() => {
    if (!profileForm.biweeklyNetPay) {
      return [
        "What should I enter for my biweekly net pay to improve the advisor?",
        "How does my current retirement flow compare to take-home pay?",
        "What should I review in the latest transactions?",
        "How much is going into brokerage versus retirement right now?"
      ];
    }

    return [
      "Am I saving too aggressively for retirement right now?",
      "How should I split the next paycheck?",
      "How much exact money is flowing into brokerage versus 401(k)?",
      "What still looks noisy in my recent money flow?"
    ];
  }, [profileForm.biweeklyNetPay]);

  const missionFlow = useMemo(() => {
    if (!advisorPlan) {
      return null;
    }

    const takeHomeBaseline = parseMoneyString(
      advisorPlan.paycheckFlow.takeHomeBaselineBiweekly
    );
    const pretax401k = parseMoneyString(
      advisorPlan.paycheckFlow.currentBiweeklyTraditional401kContribution
    );
    const roth401k = parseMoneyString(
      advisorPlan.paycheckFlow.currentBiweeklyRoth401kContribution
    );
    const hsaEmployee = parseMoneyString(
      advisorPlan.paycheckFlow.currentBiweeklyHsaEmployeeContribution
    );
    const hsaEmployer = parseMoneyString(
      advisorPlan.paycheckFlow.currentBiweeklyHsaEmployerContribution
    );
    const brokerage = parseMoneyString(
      advisorPlan.paycheckFlow.currentBiweeklyTaxableBrokerageDeposit
    );
    const spendingBiweekly =
      parseMoneyString(advisorPlan.facts.averageMonthlySpending) * (12 / 26);
    const flexCash = Math.max(takeHomeBaseline - brokerage - spendingBiweekly, 0);
    const payrollTotal = Math.max(pretax401k + roth401k + hsaEmployee, 1);
    const takeHomeTotal = Math.max(
      brokerage + spendingBiweekly + flexCash,
      takeHomeBaseline || 1
    );

    return {
      takeHomeBaseline,
      pretax401k,
      roth401k,
      hsaEmployee,
      hsaEmployer,
      brokerage,
      spendingBiweekly,
      flexCash,
      payrollTotal,
      takeHomeTotal
    };
  }, [advisorPlan]);

  function clearLinkState() {
    setLinkToken(null);
    setLinkSession(null);
    setPendingOpen(false);
    setIsLinkReady(false);
    clearPlaidLinkSession();
  }

  async function completeLinkSession(
    publicToken: string,
    metadata: PlaidLinkOnSuccessMetadata,
    sessionOverride?: StoredPlaidLinkSession | null
  ) {
    const activeSession = sessionOverride ?? linkSession ?? readPlaidLinkSession();
    if (!activeSession) {
      throw new Error("Plaid Link session details were not found.");
    }

    if (activeSession.mode === "update" && activeSession.plaidItemId) {
      const response = await fetch(
        `/api/plaid/items/${activeSession.plaidItemId}/refresh`,
        {
          method: "POST"
        }
      );
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Unable to refresh the linked institution after re-auth."
        );
      }
    } else {
      const response = await fetch("/api/plaid/exchange-public-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          publicToken,
          institution: metadata.institution
        })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to exchange public token.");
      }
    }

    await refreshAccounts();
    await refreshTransactions();
    await refreshCashflowSummary();
    await refreshRetirementRecommendation();
    await refreshAdvisorPlan();
    await refreshInvestmentsSummary();
    await refreshRecurringSummary();
    await refreshDailyReviewDigest();
    await refreshSuggestedRules();
    clearLinkState();
  }

  async function handleStartLink(
    mode: StoredPlaidLinkSession["mode"],
    plaidItemId?: string,
    productScope: StoredPlaidLinkSession["productScope"] = "default"
  ) {
    setIsCreatingLinkToken(true);
    setStatusMessage(
      mode === "update"
        ? "Preparing Plaid Link for re-authentication..."
        : productScope === "investments"
          ? "Preparing Plaid Link for an investments institution..."
          : "Creating a Plaid Link token..."
    );

    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode,
          plaidItemId,
          productScope
        })
      });
      const payload = (await response.json()) as {
        linkToken?: string;
        error?: string;
      };

      if (!response.ok || !payload.linkToken) {
        throw new Error(payload.error ?? "Unable to create a Plaid Link token.");
      }

      const session = {
        linkToken: payload.linkToken,
        mode,
        plaidItemId: plaidItemId ?? null,
        productScope
      } satisfies StoredPlaidLinkSession;

      setLinkSession(session);
      writePlaidLinkSession(session);
      setLinkToken(payload.linkToken);
      setPendingOpen(true);
      setIsLinkReady(false);
      setLinkLauncherKey((currentKey) => currentKey + 1);
      setStatusMessage("Plaid Link is ready.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to create a Plaid Link token."
      );
    } finally {
      setIsCreatingLinkToken(false);
    }
  }

  async function handleConnectClick() {
    await handleStartLink("connect", undefined, "transactions");
  }

  async function handleConnectInvestmentsClick() {
    await handleStartLink("connect", undefined, "investments");
  }

  async function handleReconnectClick(plaidItemId: string) {
    await handleStartLink("update", plaidItemId);
  }

  async function handleSyncTransactions() {
    setIsSyncingTransactions(true);
    setStatusMessage("Syncing transactions from Plaid...");

    try {
      const response = await fetch("/api/transactions/sync", {
        method: "POST"
      });
      const payload = (await response.json()) as {
        totalAdded?: number;
        totalModified?: number;
        totalRemoved?: number;
        failedItems?: Array<{
          institutionName: string | null;
          error: string;
        }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sync transactions.");
      }

      await Promise.all([refreshAccounts(), refreshTransactions()]);
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      const failureSuffix =
        payload.failedItems && payload.failedItems.length > 0
          ? ` ${payload.failedItems.length} institution(s) still need attention.`
          : "";
      setStatusMessage(
        `Transactions synced. Added ${payload.totalAdded ?? 0}, modified ${payload.totalModified ?? 0}, removed ${payload.totalRemoved ?? 0}.${failureSuffix}`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to sync transactions."
      );
    } finally {
      setIsSyncingTransactions(false);
    }
  }

  async function handleSyncInvestments() {
    setIsSyncingInvestments(true);
    setStatusMessage("Syncing investments from Plaid...");

    try {
      const response = await fetch("/api/investments/sync", {
        method: "POST"
      });
      const payload = (await response.json()) as {
        totalHoldings?: number;
        totalInvestmentTransactions?: number;
        failedItems?: Array<{
          institutionName: string | null;
          error: string;
        }>;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sync investments.");
      }

      await Promise.all([refreshAccounts(), refreshInvestmentsSummary()]);
      await refreshAdvisorPlan();
      const failureSuffix =
        payload.failedItems && payload.failedItems.length > 0
          ? ` ${payload.failedItems.length} institution(s) still need attention.`
          : "";
      setStatusMessage(
        `Investments synced. Captured ${payload.totalHoldings ?? 0} holdings and ${payload.totalInvestmentTransactions ?? 0} investment transactions.${failureSuffix}`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to sync investments."
      );
    } finally {
      setIsSyncingInvestments(false);
    }
  }

  async function handleDisconnectItem(plaidItemId: string, institutionName: string) {
    const confirmed = window.confirm(
      `Disconnect ${institutionName} and delete its linked accounts and transactions from this app?`
    );

    if (!confirmed) {
      return;
    }

    setDisconnectingPlaidItemId(plaidItemId);

    try {
      const response = await fetch(`/api/plaid/items/${plaidItemId}`, {
        method: "DELETE"
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to disconnect the institution.");
      }

      await refreshAccounts();
      await refreshTransactions();
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshInvestmentsSummary();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage(`${institutionName} was disconnected and removed.`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to disconnect the institution."
      );
    } finally {
      setDisconnectingPlaidItemId(null);
    }
  }

  async function handleCategoryChange(
    transactionId: string,
    categoryId: string | null
  ) {
    setSavingTransactionId(transactionId);

    try {
      const response = await fetch(`/api/transactions/${transactionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          categoryId
        })
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to update transaction category.");
      }

      setTransactions((currentTransactions) =>
        currentTransactions.map((transaction) =>
          transaction.id === transactionId
            ? {
                ...transaction,
                category:
                  categories.find((category) => category.id === categoryId) ?? null,
                reviewStatus: categoryId ? "user_categorized" : "uncategorized"
              }
            : transaction
        )
      );
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage("Transaction category updated.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to update transaction category."
      );
    } finally {
      setSavingTransactionId(null);
    }
  }

  async function handleAutoCategorizeTransactions() {
    setIsAutoCategorizing(true);
    setStatusMessage(
      reviewDate
        ? `Running AI review for transactions on ${reviewDate}...`
        : "Running AI review for the newest uncategorized transactions..."
    );

    try {
      const response = await fetch("/api/transactions/auto-categorize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          limit: reviewDate ? 100 : 75,
          localDateKey: reviewDate
        })
      });
      const payload = (await response.json()) as AutoCategorizeResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to auto-categorize transactions.");
      }

      await refreshTransactions();
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage(
        `AI reviewed ${payload.attemptedCount} transaction(s) with ${payload.model}. ` +
          `${payload.categorizedCount} were auto-categorized and ` +
          `${payload.leftUncategorizedCount} still need a manual look.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to auto-categorize transactions."
      );
    } finally {
      setIsAutoCategorizing(false);
    }
  }

  async function handleRunDailyReview(sendPing = false) {
    setIsRunningDailyReview(true);
    setStatusMessage(
      sendPing
        ? "Running the daily review cycle and sending the ping..."
        : "Running the daily review cycle..."
    );

    try {
      const response = await fetch("/api/daily-review/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sendPing
        })
      });
      const payload = (await response.json()) as DailyReviewRunResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to run the daily review cycle.");
      }

      await refreshTransactions();
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage(
        payload.status === "skipped"
          ? `Daily review skipped because it is not ${formatDailyReviewHour(payload.scheduledHourLocal)} ${payload.timezone} yet.`
          : `Daily review ready for ${payload.localDateKey}. ` +
            `${payload.categorization?.categorizedCount ?? 0} transactions were auto-categorized and ` +
            `${payload.digest?.uncategorizedCount ?? 0} still need review.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to run the daily review cycle."
      );
    } finally {
      setIsRunningDailyReview(false);
    }
  }

  function clearReviewDateFilter() {
    router.replace("/");
  }

  async function handleCreateRule(transactionId: string) {
    setCreatingRuleTransactionId(transactionId);

    try {
      const response = await fetch(`/api/transactions/${transactionId}/rule`, {
        method: "POST"
      });
      const payload = (await response.json()) as CreateRuleResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to create transaction rule.");
      }

      await refreshTransactions();
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage(
        payload.existed
          ? `Rule already existed. Reapplied to ${payload.appliedCount} matching transactions.`
          : `Rule created and applied to ${payload.appliedCount} matching transactions.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to create transaction rule."
      );
    } finally {
      setCreatingRuleTransactionId(null);
    }
  }

  async function handleApplySuggestedRules() {
    setIsApplyingSuggestedRules(true);
    setStatusMessage("Creating reusable rules from repeated AI-reviewed patterns...");

    try {
      const response = await fetch("/api/transaction-rules/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({})
      });
      const payload = (await response.json()) as ApplySuggestedTransactionRulesResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          payload.error ?? "Unable to create suggested transaction rules."
        );
      }

      await refreshTransactions();
      await refreshCashflowSummary();
      await refreshRetirementRecommendation();
      await refreshRecurringSummary();
      await refreshDailyReviewDigest();
      await refreshSuggestedRules();
      setStatusMessage(
        `Created ${payload.rulesCreatedCount} rule(s) from ${payload.appliedSuggestionCount} repeated pattern(s) and updated ${payload.transactionsAffectedCount} transactions.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to create suggested transaction rules."
      );
    } finally {
      setIsApplyingSuggestedRules(false);
    }
  }

  async function handleSaveProfile() {
    setIsSavingProfile(true);
    setStatusMessage("Saving advisor profile...");

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(profileForm)
      });
      const payload = (await response.json()) as UserProfileResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to save the advisor profile.");
      }

      setProfile(payload.profile);
      await refreshRetirementRecommendation();
      await refreshAdvisorPlan();
      setStatusMessage("Advisor profile saved.");
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "Unable to save the advisor profile."
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  return (
    <>
      <PlaidLinkLauncher
        key={linkLauncherKey}
        linkToken={linkToken}
        linkSession={linkSession}
        onExit={(error: PlaidLinkError | null) => {
          if (error) {
            setStatusMessage(
              error.error_message ?? "Plaid Link exited with an error."
            );
          } else {
            setStatusMessage(
              "Plaid Link closed before account connection completed."
            );
          }

          clearLinkState();
        }}
        onOpened={() => {
          setPendingOpen(false);
        }}
        onReadyChange={setIsLinkReady}
        onSuccess={async (
          publicToken: string,
          metadata: PlaidLinkOnSuccessMetadata,
          session: StoredPlaidLinkSession | null
        ) => {
          const activeSession = session ?? readPlaidLinkSession();
          setStatusMessage(
            activeSession?.mode === "update"
              ? "Refreshing the linked institution after re-authentication..."
              : "Exchanging public token and saving linked accounts..."
          );

          try {
            await completeLinkSession(publicToken, metadata, activeSession);
            setStatusMessage(
              activeSession?.mode === "update"
                ? "Institution re-authenticated successfully."
                : "Linked account saved successfully."
            );
          } catch (error) {
            setStatusMessage(
              error instanceof Error
                ? error.message
                : "Unable to exchange public token."
            );
          }
        }}
        pendingOpen={pendingOpen}
      />

      <section className="missionShell">
        <div className="missionHero">
          <div className="missionHeroCopy">
            <p className="eyebrow">Money flow command center</p>
            <h2>See the paycheck, the review queue, and the next move in one place.</h2>
            <p className="panelCopy missionIntro">
              This view is the product’s real center of gravity: money comes in,
              flows through retirement and brokerage accounts, and leaves behind a
              queue of transactions that still need your confirmation.
            </p>
            <div className="buttonRow missionActions">
              <button
                className="primaryButton"
                disabled={isCreatingLinkToken}
                onClick={() => void handleConnectClick()}
                type="button"
              >
                {isCreatingLinkToken ? "Preparing Link..." : "Connect bank/card"}
              </button>
              <button
                className="secondaryButton"
                disabled={isCreatingLinkToken}
                onClick={() => void handleConnectInvestmentsClick()}
                type="button"
              >
                Connect investment account
              </button>
              <button
                className="secondaryButton"
                disabled={isSyncingTransactions || accounts.length === 0}
                onClick={() => void handleSyncTransactions()}
                type="button"
              >
                {isSyncingTransactions ? "Syncing..." : "Sync transactions"}
              </button>
              <button
                className="secondaryButton"
                onClick={async () => {
                  await refreshRetirementRecommendation();
                  await refreshAdvisorPlan();
                }}
                type="button"
              >
                Refresh advisor
              </button>
            </div>
            <div className="missionStatus">
              <span className="statusPill">
                {statusMessage ?? "Ready. Link accounts, review transactions, and tighten the model."}
              </span>
              <span className="statusMeta">
                Link ready: {isLinkReady ? "yes" : linkToken ? "loading" : "not started"}
              </span>
            </div>
          </div>

          <div className="missionPulseGrid">
            <article className="pulseCard">
              <p className="pulseLabel">Needs Review</p>
              <p className="pulseValue">
                {dailyReviewDigest?.needsReviewCount ?? reviewQueue.length}
              </p>
              <p className="pulseMeta">
                {dailyReviewDigest
                  ? `${dailyReviewDigest.autoCategorizedCount} AI-labeled, ${dailyReviewDigest.uncategorizedCount} uncategorized`
                  : "Recent queue from the latest synced transactions"}
              </p>
            </article>
            <article className="pulseCard">
              <p className="pulseLabel">Linked Institutions</p>
              <p className="pulseValue">{linkedItems.length}</p>
              <p className="pulseMeta">
                {accounts.length} active account{accounts.length === 1 ? "" : "s"} across banks, cards, and cash.
              </p>
            </article>
            <article className="pulseCard">
              <p className="pulseLabel">Retirement Flow</p>
              <p className="pulseValue">
                {advisorPlan
                  ? formatCurrency(
                      advisorPlan.paycheckFlow.currentBiweeklyRetirementContribution
                    )
                  : "—"}
              </p>
              <p className="pulseMeta">
                Observed 401(k) and Fidelity retirement contribution pace per cycle.
              </p>
            </article>
            <article className="pulseCard">
              <p className="pulseLabel">Investment Events</p>
              <p className="pulseValue">
                {investmentsSummary?.totals.investmentTransactionCount ?? 0}
              </p>
              <p className="pulseMeta">
                Imported or synced Fidelity-side cashflow events ready for advisor analysis.
              </p>
            </article>
          </div>
        </div>

        <div className="missionGrid">
          <article className="missionCard flowCard">
            <div className="sectionLabelRow">
              <div>
                <p className="eyebrow">Money Flow</p>
                <h3>How the paycheck is moving right now</h3>
              </div>
              {missionFlow ? (
                <p className="flowHeadline">
                  {missionFlow.takeHomeBaseline > 0
                    ? `${formatCurrency(missionFlow.takeHomeBaseline.toFixed(2))} take-home baseline`
                    : "Observed retirement and brokerage cycles are available"}
                </p>
              ) : null}
            </div>
            {!advisorPlan || !missionFlow ? (
              <p className="panelCopy">
                Waiting on advisor data before the flow map can render.
              </p>
            ) : (
              <>
                <div className="flowGrid">
                  <section className="flowLane">
                    <div className="flowLaneHeader">
                      <h4>Payroll split</h4>
                      <p className="panelCopy">
                        Contributions observed before or alongside the net paycheck.
                      </p>
                    </div>
                    <div className="flowBars">
                      <article className="flowNode flowNodeSource">
                        <span className="flowNodeLabel">Paycheck</span>
                        <strong>
                          {missionFlow.takeHomeBaseline > 0
                            ? formatCurrency(missionFlow.takeHomeBaseline.toFixed(2))
                            : "Observed"}
                        </strong>
                      </article>
                      <div className="flowBranchList">
                        {[
                          {
                            label: "401(k)",
                            value: missionFlow.pretax401k,
                            note: "Pre-tax"
                          },
                          {
                            label: "Roth 401(k)",
                            value: missionFlow.roth401k,
                            note: "After-tax"
                          },
                          {
                            label: "HSA",
                            value: missionFlow.hsaEmployee,
                            note: missionFlow.hsaEmployer
                              ? `Employer + ${formatCurrency(missionFlow.hsaEmployer.toFixed(2))}`
                              : "Employee contribution"
                          }
                        ].map((branch) => {
                          const share = Math.max(
                            (branch.value / missionFlow.payrollTotal) * 100,
                            10
                          );

                          return (
                            <div
                              key={branch.label}
                              className="flowBranch"
                              style={
                                {
                                  "--flow-share": `${share}%`
                                } as CSSProperties
                              }
                            >
                              <div className="flowBranchBar" />
                              <div className="flowBranchBody">
                                <span className="flowNodeLabel">{branch.label}</span>
                                <strong>
                                  {formatCurrency(branch.value.toFixed(2))}
                                </strong>
                                <span className="flowBranchNote">{branch.note}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="flowLane">
                    <div className="flowLaneHeader">
                      <h4>Take-home split</h4>
                      <p className="panelCopy">
                        What the observed net paycheck appears to fund after it lands.
                      </p>
                    </div>
                    <div className="flowBars">
                      <article className="flowNode flowNodeSource flowNodeNet">
                        <span className="flowNodeLabel">Net cash</span>
                        <strong>
                          {missionFlow.takeHomeBaseline > 0
                            ? formatCurrency(missionFlow.takeHomeBaseline.toFixed(2))
                            : "Unknown"}
                        </strong>
                      </article>
                      <div className="flowBranchList">
                        {[
                          {
                            label: "Brokerage",
                            value: missionFlow.brokerage,
                            note: "Recurring Fidelity deposit"
                          },
                          {
                            label: "Spending",
                            value: missionFlow.spendingBiweekly,
                            note: "Biweekly estimate from reviewed spend"
                          },
                          {
                            label: "Flex cash",
                            value: missionFlow.flexCash,
                            note: "Residual room for buffer or decisions"
                          }
                        ].map((branch) => {
                          const share = Math.max(
                            (branch.value / missionFlow.takeHomeTotal) * 100,
                            10
                          );

                          return (
                            <div
                              key={branch.label}
                              className="flowBranch flowBranchNet"
                              style={
                                {
                                  "--flow-share": `${share}%`
                                } as CSSProperties
                              }
                            >
                              <div className="flowBranchBar" />
                              <div className="flowBranchBody">
                                <span className="flowNodeLabel">{branch.label}</span>
                                <strong>
                                  {formatCurrency(branch.value.toFixed(2))}
                                </strong>
                                <span className="flowBranchNote">{branch.note}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </div>

                <div className="flowNotes">
                  {advisorPlan.paycheckFlow.notes.slice(0, 3).map((note) => (
                    <p key={note} className="summaryMeta">
                      {note}
                    </p>
                  ))}
                </div>
              </>
            )}
          </article>

          <aside className="advisorRail">
            <article className="missionCard advisorSummaryCard">
              <div className="sectionLabelRow">
                <div>
                  <p className="eyebrow">Advisor</p>
                  <h3>Suggested actions</h3>
                </div>
                <span className="advisorStatusBadge">
                  {retirementRecommendation?.recommendation
                    ? formatRetirementStatus(
                        retirementRecommendation.recommendation.status
                      )
                    : "Loading"}
                </span>
              </div>
              {retirementRecommendation?.recommendation ? (
                <>
                  <p className="adviceHeadline">
                    {retirementRecommendation.recommendation.statusHeadline}
                  </p>
                  <p className="summaryMeta">
                    Current observed retirement flow:{" "}
                    {retirementRecommendation.recommendation
                      .currentObservedBiweeklyContribution
                      ? formatCurrency(
                          retirementRecommendation.recommendation
                            .currentObservedBiweeklyContribution
                        )
                      : "Not detected yet"}
                  </p>
                  <div className="advisorActionList">
                    {dashboardActionItems.map((item) => (
                      <article key={item.title} className="advisorActionCard">
                        <strong>{item.title}</strong>
                        <p>{item.detail}</p>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <p className="panelCopy">
                  Advisor recommendations are still loading.
                </p>
              )}
            </article>

            <AdvisorChat suggestedPrompts={chatSuggestedPrompts} />
          </aside>
        </div>

        <section className="missionCard reviewCard">
          <div className="sectionLabelRow">
            <div>
              <p className="eyebrow">Today&apos;s Review</p>
              <h3>Validate what the system still isn&apos;t fully sure about</h3>
            </div>
            <div className="buttonRow">
              <button
                className="secondaryButton"
                disabled={isAutoCategorizing || isRunningDailyReview}
                onClick={() => void handleAutoCategorizeTransactions()}
                type="button"
              >
                {isAutoCategorizing ? "Reviewing..." : "AI review uncategorized"}
              </button>
              <button
                className="secondaryButton"
                disabled={isAutoCategorizing || isRunningDailyReview}
                onClick={() => void handleRunDailyReview(false)}
                type="button"
              >
                {isRunningDailyReview ? "Running..." : "Run today’s review"}
              </button>
            </div>
          </div>
          {reviewQueue.length === 0 ? (
            <p className="panelCopy">
              No recent transactions are currently waiting on review.
            </p>
          ) : (
            <div className="reviewQueueList">
              {reviewQueue.map((transaction) => (
                <article key={transaction.id} className="reviewQueueItem">
                  <div className="reviewQueueMain">
                    <div>
                      <p className="reviewQueueTitle">
                        {transaction.merchantName ?? transaction.name}
                      </p>
                      <p className="reviewQueueMeta">
                        {formatCalendarDate(transaction.date)} ·{" "}
                        {transaction.account.plaidItem.institutionName ?? "Institution"} ·{" "}
                        {transaction.account.name}
                      </p>
                    </div>
                    <strong
                      className={
                        transaction.direction === "credit"
                          ? "amountPositive"
                          : "amountNegative"
                      }
                    >
                      {formatTransactionAmount(transaction)}
                    </strong>
                  </div>
                  <div className="reviewQueueControls">
                    <div className="reviewSuggestion">
                      <span className="reviewSuggestionLabel">
                        {transaction.reviewStatus === "uncategorized"
                          ? "Needs manual category"
                          : `AI suggests ${transaction.aiSuggestedCategory?.label ?? "a category"}`}
                      </span>
                      {transaction.aiSuggestedConfidence != null ? (
                        <span className="reviewSuggestionMeta">
                          {transaction.aiSuggestedConfidence}%
                        </span>
                      ) : null}
                    </div>
                    <select
                      className="categorySelect"
                      disabled={
                        savingTransactionId === transaction.id ||
                        creatingRuleTransactionId === transaction.id
                      }
                      onChange={(event) =>
                        void handleCategoryChange(
                          transaction.id,
                          event.target.value || null
                        )
                      }
                      value={transaction.category?.id ?? ""}
                    >
                      <option value="">No review category</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.parentKey
                            ? `${category.parentKey} / ${category.label}`
                            : category.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="inlineActionButton"
                      disabled={
                        !transaction.category ||
                        savingTransactionId === transaction.id ||
                        creatingRuleTransactionId === transaction.id
                      }
                      onClick={() => void handleCreateRule(transaction.id)}
                      type="button"
                    >
                      {creatingRuleTransactionId === transaction.id
                        ? "Saving rule..."
                        : "Save rule"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="panel opsPanel">
        <div className="panelHeader">
          <div>
            <h2>Operations console</h2>
            <p className="panelCopy">
              The command center above is the daily experience. This lower area
              keeps the detailed controls, raw summaries, imports, and tables that
              make the system auditable.
            </p>
          </div>
          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={isCreatingLinkToken}
              onClick={() => void handleConnectClick()}
              type="button"
            >
              {isCreatingLinkToken ? "Preparing Link..." : "Connect another bank/card"}
            </button>
            <button
              className="secondaryButton"
              disabled={isCreatingLinkToken}
              onClick={() => void handleConnectInvestmentsClick()}
              type="button"
            >
              Connect investment account
            </button>
          </div>
        </div>

      <div className="grid gridWide">
        <article className="card">
          <h3>Before you test</h3>
          <ol className="orderedList">
            {plaidSetupSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </article>

        <article className="card">
          <h3>Connection status</h3>
          <p className="metaLine">Bootstrap user: {userEmail}</p>
          <p className="statusLine">
            {statusMessage ?? "No Plaid Link session has been started yet."}
          </p>
          <p className="metaLine">
            Link ready: {isLinkReady ? "yes" : linkToken ? "loading" : "not started"}
          </p>
        </article>

        <article className="card">
          <h3>AI daily review loop</h3>
          {isLoadingDailyReview ? (
            <p className="panelCopy">Loading the latest review digest...</p>
          ) : dailyReviewError ? (
            <p className="errorLine">{dailyReviewError}</p>
          ) : dailyReviewDigest ? (
            <>
              <p className="metaLine">
                Latest digest: {dailyReviewDigest.localDateKey} ·{" "}
                {formatDailyReviewStatus(dailyReviewDigest.status)}
              </p>
              <p className="panelCopy">
                {dailyReviewDigest.needsReviewCount} transaction(s) need your
                review: {dailyReviewDigest.autoCategorizedCount} AI-categorized and{" "}
                {dailyReviewDigest.uncategorizedCount} still uncategorized.
              </p>
              <p className="metaLine">
                Schedule: {formatDailyReviewHour(dailyReviewDigest.scheduledHourLocal)}{" "}
                {dailyReviewDigest.timezone}
              </p>
            </>
          ) : (
            <p className="panelCopy">
              No digest yet. The first one appears after an AI review cycle or the
              nightly cron run.
            </p>
          )}
          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={isAutoCategorizing || isRunningDailyReview}
              onClick={() => void handleAutoCategorizeTransactions()}
              type="button"
            >
              {isAutoCategorizing ? "Reviewing..." : "AI review uncategorized"}
            </button>
            <button
              className="secondaryButton"
              disabled={isAutoCategorizing || isRunningDailyReview}
              onClick={() => void handleRunDailyReview(false)}
              type="button"
            >
              {isRunningDailyReview ? "Running..." : "Run today’s review"}
            </button>
            <button
              className="secondaryButton"
              disabled={isAutoCategorizing || isRunningDailyReview}
              onClick={() => void handleRunDailyReview(true)}
              type="button"
            >
              {isRunningDailyReview ? "Running..." : "Run and ping now"}
            </button>
          </div>
        </article>

        <article className="card">
          <h3>Suggested AI rules</h3>
          {isLoadingSuggestedRules ? (
            <p className="panelCopy">Looking for repeated reviewed patterns...</p>
          ) : suggestedRulesError ? (
            <p className="errorLine">{suggestedRulesError}</p>
          ) : suggestedRules.length === 0 ? (
            <p className="panelCopy">
              No repeated high-confidence patterns yet. After a few more reviewed
              transactions, this card will suggest reusable rules.
            </p>
          ) : (
            <>
              <p className="panelCopy">
                Repeated, high-confidence AI categorizations can be turned into
                permanent rules so tomorrow&apos;s syncs need less review.
              </p>
              <ul className="list tightList">
                {suggestedRules.slice(0, 4).map((suggestion) => (
                  <li key={suggestion.id}>
                    <strong>{suggestion.matchValue}</strong> → {suggestion.categoryLabel}
                    {" · "}
                    {suggestion.occurrenceCount} matches
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={
                isApplyingSuggestedRules ||
                isLoadingSuggestedRules ||
                suggestedRules.length === 0
              }
              onClick={() => void handleApplySuggestedRules()}
              type="button"
            >
              {isApplyingSuggestedRules ? "Creating..." : "Create suggested rules"}
            </button>
            <button
              className="secondaryButton"
              disabled={isApplyingSuggestedRules}
              onClick={() => void refreshSuggestedRules()}
              type="button"
            >
              Refresh suggestions
            </button>
          </div>
        </article>
      </div>

      <div className="cashflowBlock">
        <div className="accountsHeader">
          <div>
            <h3>Monthly cash flow</h3>
            <p className="panelCopy">
              Reviewed and auto-categorized transactions are rolled into a monthly
              readout. Uncategorized outflow stays separate so the numbers remain
              honest.
            </p>
          </div>
          <button
            className="secondaryButton"
            onClick={() => void refreshCashflowSummary()}
            type="button"
          >
            Refresh summary
          </button>
        </div>

        {isLoadingCashflow ? (
          <p className="panelCopy">Loading cash flow summary...</p>
        ) : cashflowError ? (
          <p className="errorLine">{cashflowError}</p>
        ) : !cashflowSummary?.latestMonth ? (
          <p className="panelCopy">
            Cash flow summary appears after you categorize or auto-categorize
            some transactions.
          </p>
        ) : (
          <>
            <div className="summaryGrid">
              <article className="summaryCard">
                <p className="summaryLabel">Current month income</p>
                <p className="summaryValue">
                  {formatCurrency(cashflowSummary.latestMonth.income)}
                </p>
                <p className="summaryMeta">{cashflowSummary.latestMonth.label}</p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Current month spending</p>
                <p className="summaryValue">
                  {formatCurrency(cashflowSummary.latestMonth.spending)}
                </p>
                <p className="summaryMeta">
                  Uncategorized outflow:{" "}
                  {formatCurrency(cashflowSummary.latestMonth.uncategorizedOutflow)}
                </p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Saving and investing</p>
                <p className="summaryValue">
                  {formatCurrency(cashflowSummary.latestMonth.investing)}
                </p>
                <p className="summaryMeta">
                  Transfers tracked separately:{" "}
                  {formatCurrency(cashflowSummary.latestMonth.transfers)}
                </p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Net cash flow</p>
                <p className="summaryValue">
                  {formatCurrency(cashflowSummary.latestMonth.netCashflow)}
                </p>
                <p className="summaryMeta">Income minus true spending</p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Reviewed coverage</p>
                <p className="summaryValue">
                  {(cashflowSummary.latestMonth.reviewedSpendRatioBps / 100).toFixed(0)}%
                </p>
                <p className="summaryMeta">
                  {cashflowSummary.latestMonth.reviewedTransactionCount} reviewed,
                  {" "}
                  {cashflowSummary.latestMonth.uncategorizedTransactionCount} uncategorized
                </p>
              </article>
            </div>

            <div className="grid gridWide cashflowInsights">
              <article className="card">
                <h3>Top reviewed spending categories</h3>
                {cashflowSummary.latestMonth.topCategories.length === 0 ? (
                  <p className="panelCopy">
                    No reviewed spending categories yet for {cashflowSummary.latestMonth.label}.
                  </p>
                ) : (
                  <ul className="list tightList">
                    {cashflowSummary.latestMonth.topCategories.map((category) => (
                      <li key={category.key}>
                        {category.label}: {formatCurrency(category.amount)} (
                        {(category.shareBps / 100).toFixed(0)}%)
                      </li>
                    ))}
                  </ul>
                )}
              </article>

              <article className="card">
                <h3>Six-month view</h3>
                <div className="tableWrap compactTableWrap">
                  <table className="summaryTable">
                    <thead>
                      <tr>
                        <th>Month</th>
                        <th>Income</th>
                        <th>Investing</th>
                        <th>Spend</th>
                        <th>Net</th>
                        <th>Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowSummary.months.map((month) => (
                        <tr key={month.month}>
                          <td>{month.label}</td>
                          <td>{formatCurrency(month.income)}</td>
                          <td>{formatCurrency(month.investing)}</td>
                          <td>{formatCurrency(month.spending)}</td>
                          <td>{formatCurrency(month.netCashflow)}</td>
                          <td>{(month.reviewedSpendRatioBps / 100).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </div>
          </>
        )}
      </div>

      <div className="advisorBlock">
        <div className="accountsHeader">
          <div>
            <h3>Investments groundwork</h3>
            <p className="panelCopy">
              This is the bridge to Fidelity. Once Plaid Investments is enabled
              and a brokerage or retirement institution is linked, the app can
              sync holdings and investment transactions into the same ledger.
              If Fidelity still blocks Plaid connectivity, use the manual CSV
              importer below and the imported data will flow into this same summary.
            </p>
          </div>
          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={isCreatingLinkToken}
              onClick={() => void handleConnectInvestmentsClick()}
              type="button"
            >
              {isCreatingLinkToken ? "Preparing Link..." : "Connect investment account"}
            </button>
            <button
              className="secondaryButton"
              disabled={isSyncingInvestments}
              onClick={() => void handleSyncInvestments()}
              type="button"
            >
              {isSyncingInvestments ? "Syncing..." : "Sync investments"}
            </button>
            <button
              className="secondaryButton"
              disabled={isLoadingInvestments}
              onClick={() => void refreshInvestmentsSummary()}
              type="button"
            >
              Refresh investments
            </button>
          </div>
        </div>

        <article className="card">
          <h3>Manual Fidelity CSV import</h3>
          <p className="panelCopy">
            This is the fallback lane for Fidelity if Plaid connectivity stays blocked.
            Export a CSV from Fidelity, save it somewhere easy like
            <code> /Users/devrai/Downloads/personal_finance_management/imports/fidelity/</code>,
            then upload it here. We support transaction-history imports now and holdings
            snapshots as a second step.
          </p>

          <div className="profileGrid">
            <label className="fieldLabel">
              Import type
              <select
                className="fieldInput"
                onChange={(event) => {
                  const nextKind = event.target.value === "holdings" ? "holdings" : "transactions";
                  setManualImportForm((current) => ({
                    ...current,
                    importKind: nextKind
                  }));
                }}
                value={manualImportForm.importKind}
              >
                <option value="transactions">Transactions CSV</option>
                <option value="holdings">Holdings snapshot CSV</option>
              </select>
            </label>

            <label className="fieldLabel">
              Account name
              <input
                className="fieldInput"
                onChange={(event) => {
                  setManualImportForm((current) => ({
                    ...current,
                    accountName: event.target.value
                  }));
                }}
                placeholder="Fidelity Roth IRA"
                type="text"
                value={manualImportForm.accountName}
              />
            </label>

            <label className="fieldLabel">
              Account subtype
              <input
                className="fieldInput"
                onChange={(event) => {
                  setManualImportForm((current) => ({
                    ...current,
                    accountSubtype: event.target.value
                  }));
                }}
                placeholder="Roth IRA, 401(k), Brokerage, BrokerageLink 401(k)"
                type="text"
                value={manualImportForm.accountSubtype}
              />
            </label>

            <label className="fieldLabel">
              Bucket
              <select
                className="fieldInput"
                onChange={(event) => {
                  const nextBucket =
                    event.target.value === "taxable"
                      ? "taxable"
                      : event.target.value === "other"
                        ? "other"
                        : "retirement";
                  setManualImportForm((current) => ({
                    ...current,
                    bucket: nextBucket
                  }));
                }}
                value={manualImportForm.bucket}
              >
                <option value="retirement">Retirement</option>
                <option value="taxable">Taxable</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="fieldLabel">
              Currency
              <input
                className="fieldInput"
                maxLength={3}
                onChange={(event) => {
                  setManualImportForm((current) => ({
                    ...current,
                    isoCurrencyCode: event.target.value.toUpperCase()
                  }));
                }}
                type="text"
                value={manualImportForm.isoCurrencyCode}
              />
            </label>

            <label className="fieldLabel">
              Holdings as-of date
              <input
                className="fieldInput"
                disabled={manualImportForm.importKind !== "holdings"}
                onChange={(event) => {
                  setManualImportForm((current) => ({
                    ...current,
                    asOfDate: event.target.value
                  }));
                }}
                type="date"
                value={manualImportForm.asOfDate}
              />
            </label>

            <label className="fieldLabel">
              Fidelity CSV file
              <input
                accept=".csv,text/csv"
                className="fieldInput"
                onChange={(event) => {
                  setManualImportFile(event.target.files?.[0] ?? null);
                }}
                type="file"
              />
            </label>
          </div>

          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={isPreviewingManualImport || isImportingManualInvestments}
              onClick={() => void handlePreviewManualImport()}
              type="button"
            >
              {isPreviewingManualImport ? "Previewing..." : "Preview Fidelity import"}
            </button>
            <button
              className="secondaryButton"
              disabled={
                !manualImportPreview ||
                isPreviewingManualImport ||
                isImportingManualInvestments
              }
              onClick={() => void handleCommitManualImport()}
              type="button"
            >
              {isImportingManualInvestments ? "Importing..." : "Import into portfolio"}
            </button>
          </div>

          {manualImportError ? <p className="errorLine">{manualImportError}</p> : null}

          {manualImportPreview ? (
            <div className="stackGap">
              <p className="panelCopy">
                Previewing {manualImportPreview.rowCount} {manualImportPreview.importKind} row(s)
                for {manualImportPreview.accountName}
                {manualImportPreview.accountSubtype
                  ? ` · ${manualImportPreview.accountSubtype}`
                  : ""}{" "}
                · {formatInvestmentBucket(manualImportPreview.bucket)}
                {manualImportPreview.importKind === "holdings"
                  ? ` · as of ${formatCalendarDate(manualImportPreview.asOf)}`
                  : ""}
              </p>

              {manualImportPreview.warnings.length > 0 ? (
                <ul className="list tightList">
                  {manualImportPreview.warnings.slice(0, 5).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              <p className="summaryMeta">
                Detected columns: {manualImportPreview.detectedColumns.join(", ")}
              </p>

              <div className="tableWrap compactTableWrap">
                <table className="summaryTable">
                  <thead>
                    <tr>
                      {manualImportPreview.importKind === "transactions" ? (
                        <>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Type</th>
                          <th>Amount</th>
                        </>
                      ) : (
                        <>
                          <th>Symbol</th>
                          <th>Security</th>
                          <th>Quantity</th>
                          <th>Value</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {manualImportPreview.importKind === "transactions"
                      ? manualImportPreview.previewRows.map((row) => (
                          <tr key={`${row.date}-${row.name}-${row.amount}`}>
                            <td>{formatCalendarDate(row.date)}</td>
                            <td>
                              {row.symbol ? `${row.symbol} · ${row.name}` : row.name}
                            </td>
                            <td>{row.subtype ?? row.type}</td>
                            <td>{formatCurrency(row.amount)}</td>
                          </tr>
                        ))
                      : manualImportPreview.previewRows.map((row) => (
                          <tr
                            key={`${row.asOf}-${row.symbol ?? row.securityName}-${row.institutionValue}`}
                          >
                            <td>{row.symbol ?? "—"}</td>
                            <td>{row.securityName}</td>
                            <td>{row.quantity ?? "—"}</td>
                            <td>{formatCurrency(row.institutionValue)}</td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </article>

        {isLoadingInvestments ? (
          <p className="panelCopy">Loading investments summary...</p>
        ) : investmentsError ? (
          <p className="errorLine">{investmentsError}</p>
        ) : !investmentsSummary || investmentsSummary.totals.accountCount === 0 ? (
          <p className="panelCopy">
            No investment accounts are synced yet. This section will populate
            after you enable Plaid Investments and link an institution such as Fidelity.
          </p>
        ) : (
          <>
            <div className="summaryGrid">
              <article className="summaryCard">
                <p className="summaryLabel">Total investment balance</p>
                <p className="summaryValue">
                  {formatCurrency(investmentsSummary.totals.totalBalance)}
                </p>
                <p className="summaryMeta">
                  Across {investmentsSummary.totals.accountCount} investment account(s)
                </p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Retirement balance</p>
                <p className="summaryValue">
                  {formatCurrency(investmentsSummary.totals.retirementBalance)}
                </p>
                <p className="summaryMeta">
                  Taxable balance: {formatCurrency(investmentsSummary.totals.taxableBalance)}
                </p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Latest holdings snapshot</p>
                <p className="summaryValue">
                  {investmentsSummary.totals.holdingsCount}
                </p>
                <p className="summaryMeta">
                  {investmentsSummary.totals.latestSnapshotAt
                    ? `As of ${formatTimestamp(
                        investmentsSummary.totals.latestSnapshotAt
                      )}`
                    : "Snapshot pending"}
                </p>
              </article>
              <article className="summaryCard">
                <p className="summaryLabel">Investment transactions</p>
                <p className="summaryValue">
                  {investmentsSummary.totals.investmentTransactionCount}
                </p>
                <p className="summaryMeta">Stored investment cashflow events</p>
              </article>
            </div>

            <div className="grid gridWide recurringGrid">
              <article className="card">
                <h3>Investment accounts</h3>
                <ul className="list tightList">
                  {investmentsSummary.accounts.map((account) => (
                    <li key={account.id}>
                      <strong>{account.institutionName ?? "Institution"} · {account.name}</strong>
                      {" · "}
                      {formatInvestmentSource(account.source)}
                      {" · "}
                      {formatInvestmentBucket(account.bucket)}
                      {" · "}
                      {formatCurrency(account.currentBalance)}
                      {account.subtype ? ` · ${account.subtype}` : ""}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="card">
                <h3>Largest current holdings</h3>
                {investmentsSummary.topHoldings.length === 0 ? (
                  <p className="panelCopy">
                    No holdings snapshot yet. Sync investments after linking an investments-enabled institution.
                  </p>
                ) : (
                  <ul className="list tightList">
                    {investmentsSummary.topHoldings.map((holding) => (
                      <li key={`${holding.accountId}-${holding.securityName}-${holding.asOf}`}>
                        <strong>{holding.symbol ?? holding.securityName}</strong>:{" "}
                        {formatCurrency(holding.institutionValue)}
                        {" · "}
                        {holding.accountName}
                        {" · "}
                        {formatInvestmentSource(holding.source)}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </div>

            <article className="card">
              <h3>Recent investment transactions</h3>
              {investmentsSummary.recentTransactions.length === 0 ? (
                <p className="panelCopy">
                  No investment transactions are stored yet. Once Fidelity or another investments institution is linked, this list can help us identify contribution patterns.
                </p>
              ) : (
                <div className="tableWrap compactTableWrap">
                  <table className="summaryTable">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Account</th>
                        <th>Type</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investmentsSummary.recentTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{formatCalendarDate(transaction.date)}</td>
                          <td>
                            {transaction.symbol
                              ? `${transaction.symbol} · ${transaction.name}`
                              : transaction.name}
                          </td>
                          <td>{transaction.accountName}</td>
                          <td>
                            {transaction.subtype ?? transaction.type}
                            {" · "}
                            {formatInvestmentSource(transaction.source)}
                          </td>
                          <td>{formatCurrency(transaction.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </>
        )}
      </div>

      <div className="advisorBlock">
        <div className="accountsHeader">
          <div>
            <h3>Advisor groundwork</h3>
            <p className="panelCopy">
              Save a few personal context inputs and the app can turn reviewed
              cash flow into a facts layer, emergency-fund view, and scenario-based
              paycheck allocation guidance.
            </p>
          </div>
          <button
            className="secondaryButton"
            disabled={isLoadingRetirementRecommendation || isLoadingAdvisorPlan}
            onClick={async () => {
              await refreshRetirementRecommendation();
              await refreshAdvisorPlan();
            }}
            type="button"
          >
            Refresh advisor
          </button>
        </div>

        <div className="grid gridWide">
          <article className="card">
            <h3>Profile inputs</h3>
            {isLoadingProfile ? (
              <p className="panelCopy">Loading your advisor profile...</p>
            ) : profileError ? (
              <p className="errorLine">{profileError}</p>
            ) : (
              <>
                <div className="profileGrid">
                  <label className="profileField">
                    <span>Housing status</span>
                    <select
                      className="categorySelect"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          housingStatus: event.target
                            .value as UserProfileSnapshot["housingStatus"]
                        }))
                      }
                      value={profileForm.housingStatus}
                    >
                      <option value="rent_free">Rent free</option>
                      <option value="rent">Rent</option>
                      <option value="mortgage">Mortgage</option>
                      <option value="other">Other</option>
                    </select>
                  </label>

                  <label className="profileField">
                    <span>Biweekly net pay</span>
                    <input
                      className="categorySelect"
                      inputMode="decimal"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          biweeklyNetPay: event.target.value
                        }))
                      }
                      placeholder="0.00"
                      value={profileForm.biweeklyNetPay}
                    />
                  </label>

                  <label className="profileField">
                    <span>Fixed monthly expenses</span>
                    <input
                      className="categorySelect"
                      inputMode="decimal"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          monthlyFixedExpense: event.target.value
                        }))
                      }
                      placeholder="0.00"
                      value={profileForm.monthlyFixedExpense}
                    />
                  </label>

                  <label className="profileField">
                    <span>Emergency fund target</span>
                    <input
                      className="categorySelect"
                      inputMode="decimal"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          emergencyFundTarget: event.target.value
                        }))
                      }
                      placeholder="0.00"
                      value={profileForm.emergencyFundTarget}
                    />
                  </label>

                  <label className="profileField">
                    <span>Target retirement savings rate (%)</span>
                    <input
                      className="categorySelect"
                      inputMode="decimal"
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          targetRetirementSavingsRate: event.target.value
                        }))
                      }
                      placeholder="15.00"
                      value={profileForm.targetRetirementSavingsRate}
                    />
                  </label>
                </div>

                <p className="metaLine">
                  Current profile: {profile ? formatHousingStatus(profile.housingStatus) : "Unknown"}
                </p>

                <div className="buttonRow">
                  <button
                    className="secondaryButton"
                    disabled={isSavingProfile}
                    onClick={() => void handleSaveProfile()}
                    type="button"
                  >
                    {isSavingProfile ? "Saving..." : "Save profile"}
                  </button>
                </div>
              </>
            )}
          </article>

          <article className="card">
            <h3>Retirement recommendation</h3>
            {isLoadingRetirementRecommendation ? (
              <p className="panelCopy">Calculating your contribution suggestion...</p>
            ) : retirementRecommendationError ? (
              <p className="errorLine">{retirementRecommendationError}</p>
            ) : !retirementRecommendation ? (
              <p className="panelCopy">
                Recommendation unavailable until the advisor inputs load.
              </p>
            ) : retirementRecommendation.recommendation ? (
              <>
                {retirementRecommendation.recommendation
                  .recommendedBiweeklyContribution ? (
                  <>
                    <p className="summaryValue">
                      {formatCurrency(
                        retirementRecommendation.recommendation
                          .recommendedBiweeklyContribution
                      )}
                    </p>
                    <p className="summaryMeta">
                      Recommended per paycheck based on reviewed spending and your
                      saved profile.
                    </p>
                  </>
                ) : (
                  <p className="panelCopy">
                    A fully modeled target still needs one or more profile inputs,
                    but the imported retirement flows are already available below.
                  </p>
                )}
                <p className="metaLine">
                  Observed status:{" "}
                  {formatRetirementStatus(
                    retirementRecommendation.recommendation.status
                  )}
                </p>
                <p className="panelCopy">
                  {retirementRecommendation.recommendation.statusHeadline}
                </p>
                {retirementRecommendation.recommendation
                  .currentObservedBiweeklyContribution ? (
                  <p className="metaLine">
                    Current observed retirement flow:{" "}
                    {formatCurrency(
                      retirementRecommendation.recommendation
                        .currentObservedBiweeklyContribution
                    )}
                    {retirementRecommendation.recommendation
                      .observedTakeHomeRetirementRatePercent
                      ? ` · ${retirementRecommendation.recommendation.observedTakeHomeRetirementRatePercent}% of take-home baseline`
                      : ""}
                  </p>
                ) : null}
                {retirementRecommendation.recommendation
                  .deltaFromObservedContribution ? (
                  <p className="metaLine">
                    Gap vs modeled target:{" "}
                    {formatCurrency(
                      retirementRecommendation.recommendation
                        .deltaFromObservedContribution
                    )}
                  </p>
                ) : null}
                <ul className="list tightList">
                  {retirementRecommendation.recommendation.reasoning.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="metaLine">
                  Observed spending + investing basis:{" "}
                  {formatCurrency(
                    retirementRecommendation.inputs.observedMonthlyOutflows
                  )}{" "}
                  per month
                </p>
                {retirementRecommendation.recommendation.targetSavingsRatePercent ? (
                  <p className="metaLine">
                    Target savings rate:{" "}
                    {retirementRecommendation.recommendation.targetSavingsRatePercent}%
                  </p>
                ) : null}
                <ul className="list tightList">
                  {retirementRecommendation.recommendation.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                {retirementRecommendation.missingFields.length > 0 ? (
                  <>
                    <p className="metaLine">Still needed for a stronger target:</p>
                    <ul className="list tightList">
                      {retirementRecommendation.missingFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <p className="panelCopy">
                  Add the missing inputs below before the app can recommend a
                  paycheck contribution.
                </p>
                <ul className="list tightList">
                  {retirementRecommendation.missingFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </div>

        <div className="grid gridWide advisorInsights">
          <article className="card">
            <h3>Advisor facts</h3>
            {isLoadingAdvisorPlan ? (
              <p className="panelCopy">Loading advisor facts...</p>
            ) : advisorPlanError ? (
              <p className="errorLine">{advisorPlanError}</p>
            ) : !advisorPlan ? (
              <p className="panelCopy">Advisor facts are not available yet.</p>
            ) : (
              <ul className="list tightList">
                <li>
                  Average monthly income:{" "}
                  {formatCurrency(advisorPlan.facts.averageMonthlyIncome)}
                </li>
                <li>
                  Average monthly spending:{" "}
                  {formatCurrency(advisorPlan.facts.averageMonthlySpending)}
                </li>
                <li>
                  Monthly free cash flow:{" "}
                  {formatCurrency(advisorPlan.facts.averageMonthlyFreeCashflow)}
                </li>
                <li>
                  Liquid cash balance:{" "}
                  {formatCurrency(advisorPlan.facts.liquidCashBalance)}
                </li>
                <li>
                  Reviewed spend coverage:{" "}
                  {advisorPlan.facts.reviewedSpendCoveragePercent}%
                </li>
              </ul>
            )}
          </article>

          <article className="card">
            <h3>Emergency fund</h3>
            {isLoadingAdvisorPlan ? (
              <p className="panelCopy">Loading emergency-fund guidance...</p>
            ) : advisorPlanError ? (
              <p className="errorLine">{advisorPlanError}</p>
            ) : !advisorPlan ? (
              <p className="panelCopy">Emergency-fund guidance is unavailable.</p>
            ) : (
              <>
                <p className="summaryValue">
                  {advisorPlan.emergencyFund.runwayMonths} months
                </p>
                <p className="summaryMeta">
                  Current runway against a {advisorPlan.emergencyFund.targetMonths}-month target
                </p>
                <ul className="list tightList">
                  <li>
                    Cash on hand:{" "}
                    {formatCurrency(advisorPlan.emergencyFund.currentLiquidSavings)}
                  </li>
                  <li>
                    Target fund: {formatCurrency(advisorPlan.emergencyFund.targetAmount)}
                  </li>
                  <li>
                    Shortfall: {formatCurrency(advisorPlan.emergencyFund.shortfallAmount)}
                  </li>
                </ul>
              </>
            )}
          </article>
        </div>

        <article className="panel advisorScenarioPanel">
          <h3>Paycheck allocation scenarios</h3>
          {isLoadingAdvisorPlan ? (
            <p className="panelCopy">Building paycheck allocation scenarios...</p>
          ) : advisorPlanError ? (
            <p className="errorLine">{advisorPlanError}</p>
          ) : !advisorPlan ? (
            <p className="panelCopy">Scenario planning is unavailable.</p>
          ) : (
            <>
              <p className="panelCopy">
                Available biweekly surplus:{" "}
                {formatCurrency(advisorPlan.paycheckAllocation.availableBiweeklySurplus)}.
                Monthly free cash flow basis:{" "}
                {formatCurrency(advisorPlan.paycheckAllocation.monthlyFreeCashflow)}.
              </p>
              <div className="tableWrap compactTableWrap">
                <table className="summaryTable">
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Retirement</th>
                      <th>Emergency fund</th>
                      <th>Taxable investing</th>
                      <th>Reserve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advisorPlan.paycheckAllocation.scenarios.map((scenario) => (
                      <tr key={scenario.key}>
                        <td>{scenario.label}</td>
                        <td>{formatCurrency(scenario.biweeklyAmounts.retirement)}</td>
                        <td>{formatCurrency(scenario.biweeklyAmounts.emergencyFund)}</td>
                        <td>
                          {formatCurrency(scenario.biweeklyAmounts.taxableInvesting)}
                        </td>
                        <td>{formatCurrency(scenario.biweeklyAmounts.reserve)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gridWide advisorScenarioNotes">
                {advisorPlan.paycheckAllocation.scenarios.map((scenario) => (
                  <article key={scenario.key} className="summaryCard">
                    <p className="summaryLabel">{scenario.label}</p>
                    <ul className="list tightList">
                      {scenario.reasoning.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </>
          )}
        </article>

        <article className="panel advisorScenarioPanel">
          <h3>Observed paycheck and account flow</h3>
          {isLoadingAdvisorPlan ? (
            <p className="panelCopy">Mapping paycheck flows into Fidelity accounts...</p>
          ) : advisorPlanError ? (
            <p className="errorLine">{advisorPlanError}</p>
          ) : !advisorPlan ? (
            <p className="panelCopy">Observed paycheck flow is unavailable.</p>
          ) : (
            <>
              <p className="panelCopy">
                This view combines detected paycheck deposits with recurring Fidelity
                contribution patterns so we can see how cash and retirement flows are
                showing up across accounts. Rows without take-home are contribution
                cycles that have not been cleanly matched to a bank paycheck yet.
              </p>
              <div className="summaryGrid">
                <article className="summaryCard">
                  <p className="summaryLabel">Take-home baseline</p>
                  <p className="summaryValue">
                    {advisorPlan.paycheckFlow.takeHomeBaselineBiweekly
                      ? formatCurrency(advisorPlan.paycheckFlow.takeHomeBaselineBiweekly)
                      : "—"}
                  </p>
                  <p className="summaryMeta">
                    Source: {advisorPlan.paycheckFlow.takeHomeSource}
                  </p>
                </article>
                <article className="summaryCard">
                  <p className="summaryLabel">401(k) per pay cycle</p>
                  <p className="summaryValue">
                    {formatCurrency(
                      advisorPlan.paycheckFlow.currentBiweeklyRetirementContribution
                    )}
                  </p>
                  <p className="summaryMeta">
                    {advisorPlan.paycheckFlow.percentOfTakeHomeToRetirement
                      ? `${advisorPlan.paycheckFlow.percentOfTakeHomeToRetirement}% of take-home baseline`
                      : "Take-home baseline not available yet"}
                  </p>
                </article>
                <article className="summaryCard">
                  <p className="summaryLabel">BrokerageLink Roth</p>
                  <p className="summaryValue">
                    {formatCurrency(
                      advisorPlan.paycheckFlow.currentBiweeklyRoth401kContribution
                    )}
                  </p>
                  <p className="summaryMeta">
                    {advisorPlan.paycheckFlow.percentOfTakeHomeToRoth401k
                      ? `${advisorPlan.paycheckFlow.percentOfTakeHomeToRoth401k}% of take-home baseline`
                      : "Waiting on paycheck baseline"}
                  </p>
                </article>
                <article className="summaryCard">
                  <p className="summaryLabel">Recurring brokerage deposit</p>
                  <p className="summaryValue">
                    {formatCurrency(
                      advisorPlan.paycheckFlow.currentBiweeklyTaxableBrokerageDeposit
                    )}
                  </p>
                  <p className="summaryMeta">
                    {advisorPlan.paycheckFlow.percentOfTakeHomeToTaxableBrokerage
                      ? `${advisorPlan.paycheckFlow.percentOfTakeHomeToTaxableBrokerage}% of take-home baseline`
                      : "Waiting on paycheck baseline"}
                  </p>
                </article>
              </div>

              <div className="tableWrap compactTableWrap">
                <table className="summaryTable">
                  <thead>
                    <tr>
                      <th>Cycle</th>
                      <th>Take-home</th>
                      <th>401(k) total</th>
                      <th>Pre-tax 401(k)</th>
                      <th>Roth 401(k)</th>
                      <th>Taxable brokerage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advisorPlan.paycheckFlow.recentPayPeriods.map((period) => (
                      <tr key={period.anchorDate}>
                        <td>
                          {formatCalendarDate(period.anchorDate)}
                          <div className="summaryMeta">{period.matchedBy}</div>
                        </td>
                        <td>
                          {period.takeHomePay
                            ? formatCurrency(period.takeHomePay)
                            : "—"}
                        </td>
                        <td>
                          {formatCurrency(period.totalRetirementContribution)}
                        </td>
                        <td>
                          {formatCurrency(period.traditional401kContribution)}
                        </td>
                        <td>{formatCurrency(period.roth401kContribution)}</td>
                        <td>
                          {formatCurrency(period.taxableBrokerageDeposit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="list tightList">
                {advisorPlan.paycheckFlow.notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </article>
      </div>

      <div className="recurringBlock">
        <div className="accountsHeader">
          <div>
            <h3>Recurring cash flow</h3>
            <p className="panelCopy">
              Repeated inflows and outflows are inferred from cadence and amount
              stability so you can spot payroll, subscriptions, and likely bills.
            </p>
          </div>
          <button
            className="secondaryButton"
            onClick={() => void refreshRecurringSummary()}
            type="button"
          >
            Refresh recurring
          </button>
        </div>

        {isLoadingRecurring ? (
          <p className="panelCopy">Loading recurring transactions...</p>
        ) : recurringError ? (
          <p className="errorLine">{recurringError}</p>
        ) : (
          <div className="grid gridWide recurringGrid">
            <article className="card">
              <h3>Likely recurring inflows</h3>
              {!recurringSummary || recurringSummary.inflows.length === 0 ? (
                <p className="panelCopy">No recurring inflows detected yet.</p>
              ) : (
                <ul className="list tightList">
                  {recurringSummary.inflows.map((candidate) => (
                    <li key={`${candidate.direction}-${candidate.displayName}`}>
                      <strong>{candidate.displayName}</strong>:{" "}
                      {formatFrequency(candidate.frequency)} ·{" "}
                      {formatCurrency(candidate.averageAmount)} average · next{" "}
                      {formatShortDate(candidate.nextExpectedDate)}
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="card">
              <h3>Likely recurring outflows</h3>
              {!recurringSummary || recurringSummary.outflows.length === 0 ? (
                <p className="panelCopy">No recurring outflows detected yet.</p>
              ) : (
                <ul className="list tightList">
                  {recurringSummary.outflows.map((candidate) => (
                    <li key={`${candidate.direction}-${candidate.displayName}`}>
                      <strong>{candidate.displayName}</strong>:{" "}
                      {formatFrequency(candidate.frequency)} ·{" "}
                      {formatCurrency(candidate.averageAmount)} average · next{" "}
                      {formatShortDate(candidate.nextExpectedDate)}
                      {candidate.categoryLabel ? ` · ${candidate.categoryLabel}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        )}
      </div>

      <div className="accountsBlock">
        <div className="accountsHeader">
          <div>
            <h3>Linked institutions</h3>
            <p className="panelCopy">
              Production-ready flows need item health, reconnect, and disconnect
              controls in addition to the raw account list.
            </p>
          </div>
          <div className="buttonRow">
            <button
              className="secondaryButton"
              disabled={isSyncingTransactions || accounts.length === 0}
              onClick={() => void handleSyncTransactions()}
              type="button"
            >
              {isSyncingTransactions ? "Syncing..." : "Sync transactions"}
            </button>
            <button
              className="secondaryButton"
              onClick={() => void refreshAccounts()}
              type="button"
            >
              Refresh list
            </button>
          </div>
        </div>

        {isLoadingAccounts ? (
          <p className="panelCopy">Loading linked accounts...</p>
        ) : accountsError ? (
          <p className="errorLine">{accountsError}</p>
        ) : linkedItems.length === 0 ? (
          <p className="panelCopy">
            No linked accounts yet. Once your Plaid sandbox credentials are in
            place, use the connect button to create the first Item.
          </p>
        ) : (
          <>
            <div className="accountsGrid">
              {linkedItems.map((item) => (
                <article key={item.id} className="accountCard">
                  <p className="eyebrow">{item.institutionName ?? "Linked institution"}</p>
                  <h4>{formatPlaidItemStatus(item.status)}</h4>
                  <p className="panelCopy">
                    {item.accountCount} account{item.accountCount === 1 ? "" : "s"} ·{" "}
                    {item.plaidEnvironment}
                  </p>
                  <p className="metaLine">
                    Last sync: {item.lastSyncedAt ? formatTimestamp(item.lastSyncedAt) : "Never"}
                  </p>
                  <p className="metaLine">
                    Last webhook:{" "}
                    {item.lastWebhookAt ? formatTimestamp(item.lastWebhookAt) : "Not received yet"}
                  </p>
                  {item.errorCode ? (
                    <p className="metaLine">Plaid signal: {item.errorCode}</p>
                  ) : null}
                  <div className="buttonRow">
                    <button
                      className="secondaryButton"
                      disabled={isCreatingLinkToken}
                      onClick={() => void handleReconnectClick(item.id)}
                      type="button"
                    >
                      {item.status === "needs_reauth" ? "Reconnect" : "Update access"}
                    </button>
                    <button
                      className="secondaryButton"
                      disabled={disconnectingPlaidItemId === item.id}
                      onClick={() =>
                        void handleDisconnectItem(
                          item.id,
                          item.institutionName ?? "this institution"
                        )
                      }
                      type="button"
                    >
                      {disconnectingPlaidItemId === item.id
                        ? "Disconnecting..."
                        : "Disconnect"}
                    </button>
                  </div>
                </article>
              ))}
            </div>

            <div className="accountsGrid">
              {accounts.map((account) => (
                <article key={account.id} className="accountCard">
                  <p className="eyebrow">
                    {account.plaidItem.institutionName ?? "Linked institution"}
                  </p>
                  <h4>{account.name}</h4>
                  <p className="panelCopy">
                    {account.officialName ?? `${account.type} / ${account.subtype ?? "other"}`}
                  </p>
                  <p className="balanceLine">{formatBalance(account)}</p>
                  <p className="metaLine">
                    {account.type}
                    {account.subtype ? ` · ${account.subtype}` : ""}
                    {account.mask ? ` · ••${account.mask}` : ""}
                  </p>
                </article>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="transactionsBlock">
        <div className="accountsHeader">
          <div>
            <h3>{reviewDate ? `Transactions for ${reviewDate}` : "Recent transactions"}</h3>
            <p className="panelCopy">
              {reviewDate
                ? "This is the date-filtered review view linked from the nightly reminder. Validate the AI suggestions, correct anything weak, and save rules where the pattern is durable."
                : "The newest transactions show both the active review category and the model’s latest suggestion so you can move quickly without losing the reasoning trail."}
            </p>
          </div>
          <div className="buttonRow">
            {reviewDate ? (
              <button
                className="secondaryButton"
                onClick={clearReviewDateFilter}
                type="button"
              >
                Clear day filter
              </button>
            ) : null}
            <button
              className="secondaryButton"
              onClick={() => void refreshTransactions()}
              type="button"
            >
              Refresh transactions
            </button>
          </div>
        </div>

        {isLoadingTransactions ? (
          <p className="panelCopy">Loading recent transactions...</p>
        ) : transactionsError ? (
          <p className="errorLine">{transactionsError}</p>
        ) : transactions.length === 0 ? (
          <p className="panelCopy">
            No synced transactions yet. Link a sandbox account, then click
            `Sync transactions`.
          </p>
        ) : (
          <div className="tableWrap">
            {categoriesError ? (
              <p className="errorLine">{categoriesError}</p>
            ) : null}
            <table className="transactionsTable">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Account</th>
                  <th>Plaid category</th>
                  <th>Review category</th>
                  <th>Rule</th>
                  <th>State</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatCalendarDate(transaction.date)}</td>
                    <td>
                      <div className="tablePrimary">
                        {transaction.merchantName ?? transaction.name}
                      </div>
                      {transaction.merchantName ? (
                        <div className="tableSecondary">{transaction.name}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="tablePrimary">
                        {transaction.account.plaidItem.institutionName ?? "Institution"}
                      </div>
                      <div className="tableSecondary">
                        {transaction.account.name}
                        {transaction.account.mask ? ` ••${transaction.account.mask}` : ""}
                      </div>
                    </td>
                    <td>{transaction.personalFinanceCategory ?? "Uncategorized"}</td>
                    <td>
                      <div className="cellStack">
                        <select
                          className="categorySelect"
                          disabled={
                            savingTransactionId === transaction.id ||
                            creatingRuleTransactionId === transaction.id
                          }
                          onChange={(event) =>
                            void handleCategoryChange(
                              transaction.id,
                              event.target.value || null
                            )
                          }
                          value={transaction.category?.id ?? ""}
                        >
                          <option value="">No review category</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.parentKey
                                ? `${category.parentKey} / ${category.label}`
                                : category.label}
                            </option>
                          ))}
                        </select>
                        <span className="tableSecondary">
                          {transaction.reviewStatus === "auto_categorized"
                            ? "Auto-categorized"
                            : transaction.reviewStatus === "user_categorized"
                              ? "Reviewed manually"
                              : "Needs review"}
                        </span>
                        {transaction.aiSuggestedCategory ? (
                          <span className="tableSecondary">
                            AI suggestion: {transaction.aiSuggestedCategory.label}
                            {transaction.aiSuggestedConfidence !== null
                              ? ` (${transaction.aiSuggestedConfidence}%)`
                              : ""}
                          </span>
                        ) : null}
                        {transaction.aiSuggestedReason ? (
                          <span className="tableSecondary">
                            {transaction.aiSuggestedReason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <button
                        className="inlineActionButton"
                        disabled={
                          !transaction.category ||
                          savingTransactionId === transaction.id ||
                          creatingRuleTransactionId === transaction.id
                        }
                        onClick={() => void handleCreateRule(transaction.id)}
                        type="button"
                      >
                        {creatingRuleTransactionId === transaction.id
                          ? "Saving rule..."
                          : "Save rule"}
                      </button>
                    </td>
                    <td>{transaction.isPending ? "Pending" : "Posted"}</td>
                    <td
                      className={
                        transaction.direction === "credit"
                          ? "amountPositive"
                          : "amountNegative"
                      }
                    >
                      {formatTransactionAmount(transaction)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </section>
    </>
  );
}

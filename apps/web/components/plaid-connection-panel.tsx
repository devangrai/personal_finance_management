"use client";

import { useEffect, useMemo, useState } from "react";
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
  category: {
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

function formatTransactionDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatCurrency(value: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value));
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

export function PlaidConnectionPanel() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [cashflowSummary, setCashflowSummary] =
    useState<CashflowSummaryResponse | null>(null);
  const [recurringSummary, setRecurringSummary] =
    useState<RecurringSummaryResponse | null>(null);
  const [userEmail, setUserEmail] = useState<string>("owner@example.com");
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [cashflowError, setCashflowError] = useState<string | null>(null);
  const [recurringError, setRecurringError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkSession, setLinkSession] = useState<StoredPlaidLinkSession | null>(null);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [isLoadingCashflow, setIsLoadingCashflow] = useState(true);
  const [isLoadingRecurring, setIsLoadingRecurring] = useState(true);
  const [isCreatingLinkToken, setIsCreatingLinkToken] = useState(false);
  const [isSyncingTransactions, setIsSyncingTransactions] = useState(false);
  const [disconnectingPlaidItemId, setDisconnectingPlaidItemId] = useState<
    string | null
  >(null);
  const [savingTransactionId, setSavingTransactionId] = useState<string | null>(null);
  const [creatingRuleTransactionId, setCreatingRuleTransactionId] = useState<
    string | null
  >(null);
  const [pendingOpen, setPendingOpen] = useState(false);

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
      const response = await fetch("/api/transactions?limit=25", {
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

  useEffect(() => {
    void refreshAccounts();
    void refreshTransactions();
    void refreshCategories();
    void refreshCashflowSummary();
    void refreshRecurringSummary();
  }, []);

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

  function clearLinkState() {
    setLinkToken(null);
    setLinkSession(null);
    setPendingOpen(false);
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
    await refreshRecurringSummary();
    clearLinkState();
  }

  const plaidConfig = useMemo(
    () => ({
      token: linkToken,
      onSuccess: async (
        publicToken: string,
        metadata: PlaidLinkOnSuccessMetadata
      ) => {
        const activeSession = linkSession ?? readPlaidLinkSession();
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
      },
      onExit: (error: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) => {
        if (error) {
          setStatusMessage(error.error_message ?? "Plaid Link exited with an error.");
        } else {
          setStatusMessage("Plaid Link closed before account connection completed.");
        }

        clearLinkState();
      }
    }),
    [linkSession, linkToken]
  );

  const { open, ready } = usePlaidLink(plaidConfig);

  useEffect(() => {
    if (ready && pendingOpen) {
      open();
      setPendingOpen(false);
    }
  }, [open, pendingOpen, ready]);

  async function handleStartLink(
    mode: StoredPlaidLinkSession["mode"],
    plaidItemId?: string
  ) {
    setIsCreatingLinkToken(true);
    setStatusMessage(
      mode === "update"
        ? "Preparing Plaid Link for re-authentication..."
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
          plaidItemId
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
        plaidItemId: plaidItemId ?? null
      } satisfies StoredPlaidLinkSession;

      setLinkSession(session);
      writePlaidLinkSession(session);
      setLinkToken(payload.linkToken);
      setPendingOpen(true);
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
    await handleStartLink("connect");
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
      await refreshRecurringSummary();
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
      await refreshRecurringSummary();
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
      await refreshRecurringSummary();
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

  return (
    <section className="panel">
      <div className="panelHeader">
        <div>
          <h2>Connect and inspect linked accounts</h2>
          <p className="panelCopy">
            This is the first usable milestone: create a Plaid Link token, link
            an institution, exchange the public token, and confirm the accounts
            were persisted.
          </p>
        </div>
        <button
          className="primaryButton"
          disabled={isCreatingLinkToken}
          onClick={() => void handleConnectClick()}
          type="button"
        >
          {isCreatingLinkToken ? "Preparing Link..." : "Connect account"}
        </button>
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
            Link ready: {ready ? "yes" : linkToken ? "loading" : "not started"}
          </p>
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
                <p className="summaryLabel">Net cash flow</p>
                <p className="summaryValue">
                  {formatCurrency(cashflowSummary.latestMonth.netCashflow)}
                </p>
                <p className="summaryMeta">
                  Transfers tracked separately:{" "}
                  {formatCurrency(cashflowSummary.latestMonth.transfers)}
                </p>
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
                    Last sync: {item.lastSyncedAt ? formatTransactionDate(item.lastSyncedAt) : "Never"}
                  </p>
                  <p className="metaLine">
                    Last webhook:{" "}
                    {item.lastWebhookAt ? formatTransactionDate(item.lastWebhookAt) : "Not received yet"}
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
          <h3>Recent transactions</h3>
          <button
            className="secondaryButton"
            onClick={() => void refreshTransactions()}
            type="button"
          >
            Refresh transactions
          </button>
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
                    <td>{formatTransactionDate(transaction.date)}</td>
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
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata,
  type PlaidLinkOnSuccessMetadata,
  usePlaidLink
} from "react-plaid-link";

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
    plaidEnvironment: string;
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

type CreateRuleResponse = {
  existed: boolean;
  appliedCount: number;
  rule: {
    id: string;
    name: string;
  };
};

const plaidSetupSteps = [
  "Create a free Plaid developer account and open the Dashboard.",
  "Copy your Sandbox client_id and secret into the app .env file.",
  "Add your local redirect URI to Plaid's allowed redirect URIs list if you plan to test OAuth institutions.",
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

export function PlaidConnectionPanel() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [userEmail, setUserEmail] = useState<string>("owner@example.com");
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState(true);
  const [isCreatingLinkToken, setIsCreatingLinkToken] = useState(false);
  const [isSyncingTransactions, setIsSyncingTransactions] = useState(false);
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

  useEffect(() => {
    void refreshAccounts();
    void refreshTransactions();
    void refreshCategories();
  }, []);

  const plaidConfig = useMemo(
    () => ({
      token: linkToken,
      onSuccess: async (
        publicToken: string,
        metadata: PlaidLinkOnSuccessMetadata
      ) => {
        setStatusMessage("Exchanging public token and saving linked accounts...");

        try {
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

          await refreshAccounts();
          await refreshTransactions();
          setStatusMessage("Linked account saved successfully.");
          setLinkToken(null);
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

        setPendingOpen(false);
      }
    }),
    [linkToken]
  );

  const { open, ready } = usePlaidLink(plaidConfig);

  useEffect(() => {
    if (ready && pendingOpen) {
      open();
      setPendingOpen(false);
    }
  }, [open, pendingOpen, ready]);

  async function handleConnectClick() {
    setIsCreatingLinkToken(true);
    setStatusMessage("Creating a Plaid Link token...");

    try {
      const response = await fetch("/api/plaid/link-token", {
        method: "POST"
      });
      const payload = (await response.json()) as {
        linkToken?: string;
        error?: string;
      };

      if (!response.ok || !payload.linkToken) {
        throw new Error(payload.error ?? "Unable to create a Plaid Link token.");
      }

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
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to sync transactions.");
      }

      await Promise.all([refreshAccounts(), refreshTransactions()]);
      setStatusMessage(
        `Transactions synced. Added ${payload.totalAdded ?? 0}, modified ${payload.totalModified ?? 0}, removed ${payload.totalRemoved ?? 0}.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to sync transactions."
      );
    } finally {
      setIsSyncingTransactions(false);
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

      <div className="accountsBlock">
        <div className="accountsHeader">
          <h3>Linked accounts</h3>
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
        ) : accounts.length === 0 ? (
          <p className="panelCopy">
            No linked accounts yet. Once your Plaid sandbox credentials are in
            place, use the connect button to create the first Item.
          </p>
        ) : (
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

import {
  CountryCode,
  type AccountsGetResponse,
  type LinkTokenCreateResponse,
  type RemovedTransaction,
  type Transaction as PlaidTransaction,
  type TransactionsSyncRequest
} from "plaid";
import {
  AccountType,
  PlaidEnvironment,
  PlaidItemStatus,
  TransactionDirection,
  TransactionReviewStatus,
  prisma
} from "@portfolio/db";
import { createPlaidClient } from "@portfolio/plaid";
import { decryptString, encryptString } from "./crypto";
import { getAppEnv } from "./env";
import {
  findMatchingTransactionRule,
  getActiveTransactionRules
} from "./transaction-rules";
import { getOrCreateDefaultUser } from "./user";

type ExchangePublicTokenInput = {
  publicToken: string;
  institutionId?: string;
  institutionName?: string;
};

export type LinkTokenMode = "connect" | "update";

type CreateLinkTokenInput = {
  mode?: LinkTokenMode;
  plaidItemId?: string;
  accountSelectionEnabled?: boolean;
};

type PersistPlaidItemInput = {
  accessToken: string;
  plaidItemId: string;
  accountsResponse: AccountsGetResponse;
  institutionId?: string;
  institutionName?: string;
};

type PlaidItemWithAccounts = Awaited<
  ReturnType<typeof listPersistedPlaidItems>
>[number];
type PersistedPlaidAccount = PlaidItemWithAccounts["accounts"][number];

function resolvePlaidItemEnvironment(value: string) {
  switch (value) {
    case "sandbox":
      return PlaidEnvironment.sandbox;
    case "development":
      return PlaidEnvironment.development;
    case "production":
      return PlaidEnvironment.production;
    default:
      throw new Error(`Unsupported Plaid environment: ${value}`);
  }
}

function mapAccountType(type: string) {
  switch (type) {
    case "depository":
      return AccountType.depository;
    case "credit":
      return AccountType.credit;
    case "investment":
      return AccountType.investment;
    case "loan":
      return AccountType.loan;
    default:
      return AccountType.other;
  }
}

function normalizeBalance(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toFixed(2);
}

export function getPlaidApi() {
  const env = getAppEnv();
  return createPlaidClient({
    clientId: env.plaidClientId,
    secret: env.plaidSecret,
    env: env.plaidEnv,
    redirectUri: env.plaidRedirectUri
  });
}

export async function createLinkToken(input: CreateLinkTokenInput = {}) {
  const env = getAppEnv();
  const user = await getOrCreateDefaultUser();
  const plaidClient = getPlaidApi();
  const linkTokenRequest = {
    client_name: env.plaidClientName,
    country_codes: env.plaidCountryCodes,
    language: "en" as const,
    user: {
      client_user_id: user.id
    },
    webhook: env.plaidWebhookUrl,
    redirect_uri: env.plaidRedirectUri
  };

  if (input.mode === "update") {
    if (!input.plaidItemId) {
      throw new Error("plaidItemId is required for update mode.");
    }

    const plaidItem = await findPersistedPlaidItemById(input.plaidItemId);
    if (!plaidItem) {
      throw new Error("Unable to find the linked institution to update.");
    }

    const response = await plaidClient.linkTokenCreate({
      ...linkTokenRequest,
      access_token: getAccessToken(plaidItem),
      update: input.accountSelectionEnabled
        ? {
            account_selection_enabled: true
          }
        : undefined
    });

    return response.data satisfies LinkTokenCreateResponse;
  }

  const response = await plaidClient.linkTokenCreate({
    ...linkTokenRequest,
    products: env.plaidProducts,
  });

  return response.data satisfies LinkTokenCreateResponse;
}

async function getInstitutionName(
  plaidClient: ReturnType<typeof getPlaidApi>,
  institutionId?: string,
  providedInstitutionName?: string
) {
  if (providedInstitutionName) {
    return providedInstitutionName;
  }

  if (!institutionId) {
    return undefined;
  }

  try {
    const response = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: [CountryCode.Us],
      options: {
        include_optional_metadata: true
      }
    });

    return response.data.institution.name;
  } catch {
    return undefined;
  }
}

async function persistPlaidItem(input: PersistPlaidItemInput) {
  const env = getAppEnv();
  const user = await getOrCreateDefaultUser();

  const plaidItem = await prisma.plaidItem.upsert({
    where: {
      plaidItemId: input.plaidItemId
    },
    update: {
      userId: user.id,
      plaidEnvironment: resolvePlaidItemEnvironment(env.plaidEnv),
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      accessTokenEncrypted: encryptString(input.accessToken, env.encryptionKey),
      status: PlaidItemStatus.active,
      errorCode: null
    },
    create: {
      userId: user.id,
      plaidItemId: input.plaidItemId,
      plaidEnvironment: resolvePlaidItemEnvironment(env.plaidEnv),
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      accessTokenEncrypted: encryptString(input.accessToken, env.encryptionKey),
      status: PlaidItemStatus.active,
      errorCode: null
    }
  });

  await prisma.account.updateMany({
    where: {
      plaidItemId: plaidItem.id
    },
    data: {
      isActive: false
    }
  });

  const persistedAccounts = await Promise.all(
    input.accountsResponse.accounts.map((account) =>
      prisma.account.upsert({
        where: {
          plaidAccountId: account.account_id
        },
        update: {
          userId: user.id,
          plaidItemId: plaidItem.id,
          name: account.name,
          officialName: account.official_name,
          mask: account.mask,
          subtype: account.subtype ?? null,
          type: mapAccountType(account.type),
          isoCurrencyCode:
            account.balances.iso_currency_code ?? account.balances.unofficial_currency_code,
          currentBalance: normalizeBalance(account.balances.current),
          availableBalance: normalizeBalance(account.balances.available),
          isActive: true
        },
        create: {
          userId: user.id,
          plaidItemId: plaidItem.id,
          plaidAccountId: account.account_id,
          name: account.name,
          officialName: account.official_name,
          mask: account.mask,
          subtype: account.subtype ?? null,
          type: mapAccountType(account.type),
          isoCurrencyCode:
            account.balances.iso_currency_code ?? account.balances.unofficial_currency_code,
          currentBalance: normalizeBalance(account.balances.current),
          availableBalance: normalizeBalance(account.balances.available),
          isActive: true
        },
        select: {
          id: true,
          plaidAccountId: true,
          name: true,
          type: true,
          subtype: true,
          mask: true
        }
      })
    )
  );

  return {
    plaidItem,
    accounts: persistedAccounts
  };
}

export async function exchangePublicToken(input: ExchangePublicTokenInput) {
  const plaidClient = getPlaidApi();
  const exchangeResponse = await plaidClient.itemPublicTokenExchange({
    public_token: input.publicToken
  });
  const accountsResponse = await plaidClient.accountsGet({
    access_token: exchangeResponse.data.access_token
  });

  const institutionId =
    input.institutionId ?? accountsResponse.data.item.institution_id ?? undefined;
  const institutionName = await getInstitutionName(
    plaidClient,
    institutionId,
    input.institutionName
  );

  const persisted = await persistPlaidItem({
    accessToken: exchangeResponse.data.access_token,
    plaidItemId: exchangeResponse.data.item_id,
    accountsResponse: accountsResponse.data,
    institutionId,
    institutionName
  });

  return {
    item: {
      id: persisted.plaidItem.id,
      plaidItemId: persisted.plaidItem.plaidItemId,
      institutionId,
      institutionName
    },
    accounts: persisted.accounts
  };
}

export async function listPersistedPlaidItems() {
  const user = await getOrCreateDefaultUser();

  return prisma.plaidItem.findMany({
    where: {
      userId: user.id,
      status: PlaidItemStatus.active
    },
    include: {
      accounts: {
        where: {
          isActive: true
        },
        select: {
          id: true,
          plaidAccountId: true,
          name: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
}

async function findPersistedPlaidItemById(id: string) {
  const user = await getOrCreateDefaultUser();

  return prisma.plaidItem.findFirst({
    where: {
      id,
      userId: user.id,
      status: {
        not: PlaidItemStatus.disconnected
      }
    },
    include: {
      accounts: {
        where: {
          isActive: true
        },
        select: {
          id: true,
          plaidAccountId: true,
          name: true
        }
      }
    }
  });
}

async function findPersistedPlaidItemByPlaidItemId(plaidItemId: string) {
  const user = await getOrCreateDefaultUser();

  return prisma.plaidItem.findFirst({
    where: {
      plaidItemId,
      userId: user.id,
      status: {
        not: PlaidItemStatus.disconnected
      }
    },
    include: {
      accounts: {
        where: {
          isActive: true
        },
        select: {
          id: true,
          plaidAccountId: true,
          name: true
        }
      }
    }
  });
}

function getAccessToken(plaidItem: { accessTokenEncrypted: string }) {
  const env = getAppEnv();
  return decryptString(plaidItem.accessTokenEncrypted, env.encryptionKey);
}

function mapTransactionDirection(amount: number) {
  return amount >= 0 ? TransactionDirection.debit : TransactionDirection.credit;
}

function normalizeTransactionAmount(amount: number) {
  return Math.abs(amount).toFixed(2);
}

function parseTransactionDate(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function normalizePlaidCategory(transaction: PlaidTransaction) {
  return {
    categories: transaction.category ?? [],
    category_id: transaction.category_id ?? null,
    payment_channel: transaction.payment_channel
      ? String(transaction.payment_channel)
      : null,
    personal_finance_category: transaction.personal_finance_category
      ? {
          primary: transaction.personal_finance_category.primary,
          detailed: transaction.personal_finance_category.detailed,
          confidence_level:
            transaction.personal_finance_category.confidence_level ?? null
        }
      : null
  };
}

function getPlaidErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error_code" in error.response.data
  ) {
    return String(error.response.data.error_code);
  }

  return undefined;
}

function getPlaidErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "error_message" in error.response.data
  ) {
    return String(error.response.data.error_message);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Plaid error.";
}

async function updatePlaidItemStatus(
  plaidItemId: string,
  status: PlaidItemStatus,
  errorCode?: string | null
) {
  await prisma.plaidItem.update({
    where: {
      id: plaidItemId
    },
    data: {
      status,
      errorCode: errorCode ?? null,
      lastWebhookAt: new Date()
    }
  });
}

async function deactivatePlaidItemAccounts(plaidItemId: string) {
  await prisma.account.updateMany({
    where: {
      plaidItemId
    },
    data: {
      isActive: false
    }
  });
}

async function deactivateSingleAccount(plaidItemId: string, plaidAccountId: string) {
  await prisma.account.updateMany({
    where: {
      plaidItemId,
      plaidAccountId
    },
    data: {
      isActive: false
    }
  });
}

async function markPlaidItemFromError(plaidItemId: string, error: unknown) {
  const errorCode = getPlaidErrorCode(error) ?? "PLAID_REQUEST_FAILED";
  const status =
    errorCode === "ITEM_LOGIN_REQUIRED" || errorCode === "PENDING_DISCONNECT"
      ? PlaidItemStatus.needs_reauth
      : errorCode === "ITEM_NOT_FOUND" ||
          errorCode === "ACCESS_NOT_GRANTED" ||
          errorCode === "NO_ACCOUNTS"
        ? PlaidItemStatus.disconnected
        : PlaidItemStatus.error;

  await updatePlaidItemStatus(plaidItemId, status, errorCode);

  if (status === PlaidItemStatus.disconnected) {
    await deactivatePlaidItemAccounts(plaidItemId);
  }

  return {
    errorCode,
    errorMessage: getPlaidErrorMessage(error)
  };
}

async function upsertTransactionsForItem(
  plaidItem: PlaidItemWithAccounts,
  transactions: PlaidTransaction[],
  activeRules: Awaited<ReturnType<typeof getActiveTransactionRules>>
) {
  if (transactions.length === 0) {
    return;
  }

  const accountIdByPlaidAccountId = new Map<string, string>(
    plaidItem.accounts.map((account: PersistedPlaidAccount) => [
      account.plaidAccountId,
      account.id
    ])
  );
  const accountNameByPlaidAccountId = new Map<string, string>(
    plaidItem.accounts.map((account: PersistedPlaidAccount) => [
      account.plaidAccountId,
      account.name
    ])
  );
  const existingTransactions = await prisma.transaction.findMany({
    where: {
      plaidTransactionId: {
        in: transactions.map((transaction) => transaction.transaction_id)
      }
    },
    select: {
      id: true,
      plaidTransactionId: true,
      categoryId: true,
      reviewStatus: true
    }
  });
  const existingTransactionByPlaidId = new Map(
    existingTransactions.map((transaction) => [
      transaction.plaidTransactionId,
      transaction
    ])
  );

  await Promise.all(
    transactions.map((transaction) => {
      const accountId = accountIdByPlaidAccountId.get(transaction.account_id);
      if (!accountId) {
        throw new Error(
          `Missing persisted account for Plaid account ${transaction.account_id}.`
        );
      }

      const date = parseTransactionDate(transaction.date);
      if (!date) {
        throw new Error(
          `Transaction ${transaction.transaction_id} is missing a posting date.`
        );
      }

      const existingTransaction = existingTransactionByPlaidId.get(
        transaction.transaction_id
      );
      const matchedRule = findMatchingTransactionRule(activeRules, {
        accountId,
        accountName:
          accountNameByPlaidAccountId.get(transaction.account_id) ?? null,
        merchantName: transaction.merchant_name ?? null,
        personalFinanceCategory:
          transaction.personal_finance_category?.detailed ?? null,
        transactionName: transaction.name
      });
      const categorization =
        existingTransaction?.reviewStatus === TransactionReviewStatus.user_categorized ||
        existingTransaction?.reviewStatus === TransactionReviewStatus.ignored
          ? {
              categoryId: existingTransaction.categoryId,
              reviewStatus: existingTransaction.reviewStatus
            }
          : matchedRule
            ? {
                categoryId: matchedRule.categoryId,
                reviewStatus: TransactionReviewStatus.auto_categorized
              }
            : {
                categoryId: null,
                reviewStatus: TransactionReviewStatus.uncategorized
              };
      const transactionData = {
        userId: plaidItem.userId,
        accountId,
        pendingTransactionId: transaction.pending_transaction_id ?? null,
        date,
        authorizedDate: parseTransactionDate(transaction.authorized_date),
        name: transaction.name,
        merchantName: transaction.merchant_name ?? null,
        amount: normalizeTransactionAmount(transaction.amount),
        isoCurrencyCode:
          transaction.iso_currency_code ?? transaction.unofficial_currency_code,
        direction: mapTransactionDirection(transaction.amount),
        isPending: transaction.pending,
        plaidCategory: normalizePlaidCategory(transaction),
        personalFinanceCategory:
          transaction.personal_finance_category?.detailed ?? null,
        ...categorization
      };

      if (existingTransaction) {
        return prisma.transaction.update({
          where: {
            id: existingTransaction.id
          },
          data: transactionData
        });
      }

      return prisma.transaction.create({
        data: {
          ...transactionData,
          plaidTransactionId: transaction.transaction_id
        }
      });
    })
  );
}

async function syncSinglePlaidItem(
  plaidItem: PlaidItemWithAccounts,
  activeRules: Awaited<ReturnType<typeof getActiveTransactionRules>>
) {
  const plaidClient = getPlaidApi();
  let cursor = plaidItem.transactionsCursor ?? undefined;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let hasMore = true;
  let restartCount = 0;

  while (hasMore) {
    try {
      const request: TransactionsSyncRequest = {
        access_token: getAccessToken(plaidItem),
        cursor
      };
      const response = await plaidClient.transactionsSync(request);
      const { added, modified, removed, next_cursor, has_more } = response.data;

      await upsertTransactionsForItem(plaidItem, added, activeRules);
      await upsertTransactionsForItem(plaidItem, modified, activeRules);
      removedCount += await removeTransactions(removed);

      addedCount += added.length;
      modifiedCount += modified.length;
      cursor = next_cursor;
      hasMore = has_more;
    } catch (error) {
      const plaidErrorCode = getPlaidErrorCode(error);

      if (
        plaidErrorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        restartCount < 1
      ) {
        cursor = plaidItem.transactionsCursor ?? undefined;
        hasMore = true;
        restartCount += 1;
        continue;
      }

      await markPlaidItemFromError(plaidItem.id, error);
      throw error;
    }
  }

  await prisma.plaidItem.update({
    where: {
      id: plaidItem.id
    },
    data: {
      transactionsCursor: cursor ?? null,
      lastSyncedAt: new Date(),
      status: PlaidItemStatus.active,
      errorCode: null
    }
  });

  return {
    plaidItemId: plaidItem.plaidItemId,
    institutionName: plaidItem.institutionName,
    addedCount,
    modifiedCount,
    removedCount,
    cursor
  };
}

export async function syncTransactionsForLinkedItems() {
  const plaidItems = await listPersistedPlaidItems();
  if (plaidItems.length === 0) {
    return {
      syncedItems: [],
      totalAdded: 0,
      totalModified: 0,
      totalRemoved: 0,
      failedItems: []
    };
  }

  const activeRules = await getActiveTransactionRules(plaidItems[0].userId);
  const syncedItems = [];
  const failedItems = [];

  for (const plaidItem of plaidItems) {
    try {
      syncedItems.push(await syncSinglePlaidItem(plaidItem, activeRules));
    } catch (error) {
      failedItems.push({
        plaidItemId: plaidItem.id,
        institutionName: plaidItem.institutionName,
        errorCode: getPlaidErrorCode(error) ?? null,
        error: getPlaidErrorMessage(error)
      });
    }
  }

  return {
    syncedItems,
    totalAdded: syncedItems.reduce((sum, item) => sum + item.addedCount, 0),
    totalModified: syncedItems.reduce((sum, item) => sum + item.modifiedCount, 0),
    totalRemoved: syncedItems.reduce((sum, item) => sum + item.removedCount, 0),
    failedItems
  };
}

async function syncTransactionsForPersistedItem(plaidItem: PlaidItemWithAccounts) {
  const activeRules = await getActiveTransactionRules(plaidItem.userId);
  return syncSinglePlaidItem(plaidItem, activeRules);
}

export async function syncTransactionsForPlaidItem(plaidItemId: string) {
  const plaidItem = await findPersistedPlaidItemById(plaidItemId);
  if (!plaidItem) {
    throw new Error("Unable to find the linked institution to sync.");
  }

  return syncTransactionsForPersistedItem(plaidItem);
}

export async function refreshPlaidItem(plaidItemId: string) {
  const plaidItem = await findPersistedPlaidItemById(plaidItemId);
  if (!plaidItem) {
    throw new Error("Unable to find the linked institution to refresh.");
  }

  const plaidClient = getPlaidApi();
  const accessToken = getAccessToken(plaidItem);
  const accountsResponse = await plaidClient.accountsGet({
    access_token: accessToken
  });
  const institutionId =
    accountsResponse.data.item.institution_id ?? plaidItem.institutionId ?? undefined;
  const institutionName = await getInstitutionName(
    plaidClient,
    institutionId,
    plaidItem.institutionName ?? undefined
  );

  const persisted = await persistPlaidItem({
    accessToken,
    plaidItemId: plaidItem.plaidItemId,
    accountsResponse: accountsResponse.data,
    institutionId,
    institutionName
  });

  let syncResult = null;

  try {
    syncResult = await syncTransactionsForPersistedItem({
      ...plaidItem,
      ...persisted.plaidItem,
      accounts: persisted.accounts
    });
  } catch (error) {
    await markPlaidItemFromError(persisted.plaidItem.id, error);
  }

  return {
    item: {
      id: persisted.plaidItem.id,
      plaidItemId: persisted.plaidItem.plaidItemId,
      institutionId,
      institutionName,
      status: persisted.plaidItem.status
    },
    accounts: persisted.accounts,
    syncResult
  };
}

type PlaidWebhookPayload = {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  account_id?: string;
  error?:
    | {
        error_code?: string | null;
      }
    | string
    | null;
};

export async function handlePlaidWebhook(payload: PlaidWebhookPayload) {
  if (!payload.item_id) {
    return {
      handled: false,
      reason: "missing_item_id"
    };
  }

  const plaidItem = await findPersistedPlaidItemByPlaidItemId(payload.item_id);
  if (!plaidItem) {
    return {
      handled: false,
      reason: "item_not_found"
    };
  }

  const updateLastWebhook = async () => {
    await prisma.plaidItem.update({
      where: {
        id: plaidItem.id
      },
      data: {
        lastWebhookAt: new Date()
      }
    });
  };

  if (payload.webhook_type === "TRANSACTIONS") {
    await updateLastWebhook();

    if (
      payload.webhook_code === "SYNC_UPDATES_AVAILABLE" ||
      payload.webhook_code === "INITIAL_UPDATE" ||
      payload.webhook_code === "HISTORICAL_UPDATE" ||
      payload.webhook_code === "DEFAULT_UPDATE" ||
      payload.webhook_code === "TRANSACTIONS_REMOVED"
    ) {
      try {
        const syncResult = await syncTransactionsForPersistedItem(plaidItem);

        return {
          handled: true,
          action: "synced_transactions",
          syncResult
        };
      } catch (error) {
        const plaidError = await markPlaidItemFromError(plaidItem.id, error);

        return {
          handled: false,
          action: "sync_failed",
          ...plaidError
        };
      }
    }

    return {
      handled: true,
      action: "ignored_transactions_webhook"
    };
  }

  if (payload.webhook_type === "ITEM") {
    await updateLastWebhook();

    switch (payload.webhook_code) {
      case "ERROR": {
        const webhookErrorCode =
          typeof payload.error === "object" &&
          payload.error !== null &&
          "error_code" in payload.error &&
          payload.error.error_code
            ? String(payload.error.error_code)
            : "ITEM_ERROR";
        const status =
          webhookErrorCode === "ITEM_LOGIN_REQUIRED"
            ? PlaidItemStatus.needs_reauth
            : PlaidItemStatus.error;

        await updatePlaidItemStatus(plaidItem.id, status, webhookErrorCode);

        return {
          handled: true,
          action: "updated_item_status",
          status
        };
      }
      case "LOGIN_REPAIRED":
        await updatePlaidItemStatus(plaidItem.id, PlaidItemStatus.active, null);
        return {
          handled: true,
          action: "login_repaired"
        };
      case "PENDING_DISCONNECT":
      case "PENDING_EXPIRATION":
        await updatePlaidItemStatus(
          plaidItem.id,
          PlaidItemStatus.needs_reauth,
          payload.webhook_code
        );
        return {
          handled: true,
          action: "needs_reauth"
        };
      case "USER_PERMISSION_REVOKED":
        await updatePlaidItemStatus(
          plaidItem.id,
          PlaidItemStatus.disconnected,
          payload.webhook_code
        );
        await deactivatePlaidItemAccounts(plaidItem.id);
        return {
          handled: true,
          action: "permission_revoked"
        };
      case "USER_ACCOUNT_REVOKED":
        if (payload.account_id) {
          await deactivateSingleAccount(plaidItem.id, payload.account_id);
        }
        return {
          handled: true,
          action: "account_revoked"
        };
      case "NEW_ACCOUNTS_AVAILABLE":
        await updatePlaidItemStatus(
          plaidItem.id,
          PlaidItemStatus.active,
          payload.webhook_code
        );
        return {
          handled: true,
          action: "new_accounts_available"
        };
      default:
        return {
          handled: true,
          action: "ignored_item_webhook"
        };
    }
  }

  return {
    handled: false,
    reason: "unsupported_webhook_type"
  };
}

export async function disconnectPlaidItem(plaidItemId: string) {
  const plaidItem = await findPersistedPlaidItemById(plaidItemId);
  if (!plaidItem) {
    throw new Error("Unable to find the linked institution to disconnect.");
  }

  const plaidClient = getPlaidApi();
  await plaidClient.itemRemove({
    access_token: getAccessToken(plaidItem)
  });

  await prisma.plaidItem.delete({
    where: {
      id: plaidItem.id
    }
  });

  return {
    plaidItemId: plaidItem.id,
    institutionName: plaidItem.institutionName
  };
}

async function removeTransactions(removedTransactions: RemovedTransaction[]) {
  if (removedTransactions.length === 0) {
    return 0;
  }

  const response = await prisma.transaction.deleteMany({
    where: {
      plaidTransactionId: {
        in: removedTransactions.map((transaction) => transaction.transaction_id)
      }
    }
  });

  return response.count;
}

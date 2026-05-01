import {
  CountryCode,
  type AccountsGetResponse,
  type Holding,
  type InvestmentTransaction as PlaidInvestmentTransaction,
  type LinkTokenCreateResponse,
  Products,
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
  productScope?: "default" | "transactions" | "investments";
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
type ExistingPersistedTransaction = {
  id: string;
  plaidTransactionId: string;
  categoryId: string | null;
  reviewStatus: TransactionReviewStatus;
};

type InvestmentSecurityRecord = {
  security_id: string;
  ticker_symbol: string | null;
  name: string | null;
};

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

function normalizePreciseNumber(
  value: number | null | undefined,
  precision: number
) {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toFixed(precision);
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

function resolveRequestedLinkProducts(
  configuredProducts: Products[],
  productScope: CreateLinkTokenInput["productScope"]
) {
  if (!productScope || productScope === "default") {
    return configuredProducts;
  }

  const scopedProducts = configuredProducts.filter((product) =>
    productScope === "transactions"
      ? product === Products.Transactions
      : product === Products.Investments
  );

  if (scopedProducts.length === 0) {
    throw new Error(
      productScope === "transactions"
        ? "Plaid Transactions is not enabled for this app."
        : "Plaid Investments is not enabled for this app."
    );
  }

  return scopedProducts;
}

export async function createLinkToken(input: CreateLinkTokenInput = {}) {
  const env = getAppEnv();
  const user = await getOrCreateDefaultUser();
  const plaidClient = getPlaidApi();
  const requestedProducts = resolveRequestedLinkProducts(
    env.plaidProducts,
    input.productScope
  );
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
    products: requestedProducts
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
          name: true,
          type: true,
          subtype: true,
          mask: true
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
          name: true,
          type: true,
          subtype: true,
          mask: true
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
          name: true,
          type: true,
          subtype: true,
          mask: true
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
  const existingTransactionByPlaidId = new Map<string, ExistingPersistedTransaction>(
    existingTransactions.map((transaction: ExistingPersistedTransaction) => [
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
      let categorization: {
        categoryId: string | null;
        reviewStatus: TransactionReviewStatus;
      };

      if (
        existingTransaction &&
        (existingTransaction.reviewStatus ===
          TransactionReviewStatus.user_categorized ||
          existingTransaction.reviewStatus === TransactionReviewStatus.ignored)
      ) {
        categorization = {
          categoryId: existingTransaction.categoryId,
          reviewStatus: existingTransaction.reviewStatus
        };
      } else if (matchedRule) {
        categorization = {
          categoryId: matchedRule.categoryId,
          reviewStatus: TransactionReviewStatus.auto_categorized
        };
      } else {
        categorization = {
          categoryId: null,
          reviewStatus: TransactionReviewStatus.uncategorized
        };
      }
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

type InvestmentSyncResult = {
  plaidItemId: string;
  institutionName: string | null;
  holdingsCount: number;
  investmentTransactionCount: number;
  accountCount: number;
  asOf: string;
};

function getInvestmentAccountIds(plaidItem: PlaidItemWithAccounts) {
  return plaidItem.accounts
    .filter((account) => account.type === AccountType.investment)
    .map((account) => account.plaidAccountId);
}

function buildSecurityMap(
  securities: InvestmentSecurityRecord[]
) {
  return new Map(
    securities.map((security) => [
      security.security_id,
      {
        symbol: security.ticker_symbol ?? null,
        name: security.name
      }
    ])
  );
}

async function upsertInvestmentAccountBalances(
  plaidItem: PlaidItemWithAccounts,
  accounts: Array<{
    account_id: string;
    balances: {
      available?: number | null;
      current?: number | null;
    };
  }>
) {
  await Promise.all(
    accounts.map((account) =>
      prisma.account.updateMany({
        where: {
          plaidItemId: plaidItem.id,
          plaidAccountId: account.account_id
        },
        data: {
          currentBalance: normalizeBalance(account.balances.current),
          availableBalance: normalizeBalance(account.balances.available),
          isActive: true
        }
      })
    )
  );
}

async function createHoldingSnapshotsForItem(
  plaidItem: PlaidItemWithAccounts,
  holdings: Holding[],
  securities: InvestmentSecurityRecord[],
  asOf: Date
) {
  if (holdings.length === 0) {
    return 0;
  }

  const securityMap = buildSecurityMap(securities);
  const accountIdByPlaidAccountId = new Map<string, string>(
    plaidItem.accounts.map((account: PersistedPlaidAccount) => [
      account.plaidAccountId,
      account.id
    ])
  );

  await prisma.holdingSnapshot.createMany({
    data: holdings
      .map((holding) => {
        const accountId = accountIdByPlaidAccountId.get(holding.account_id);
        if (!accountId) {
          return null;
        }

        const security = holding.security_id
          ? securityMap.get(holding.security_id)
          : null;

        return {
          userId: plaidItem.userId,
          accountId,
          asOf,
          securityId: holding.security_id ?? null,
          symbol: security?.symbol ?? null,
          securityName: security?.name ?? holding.security_id ?? "Unknown security",
          quantity: normalizePreciseNumber(holding.quantity, 8),
          institutionPrice: normalizePreciseNumber(holding.institution_price, 4),
          institutionValue: normalizeBalance(holding.institution_value),
          costBasis: normalizeBalance(holding.cost_basis),
          isoCurrencyCode:
            holding.iso_currency_code ?? holding.unofficial_currency_code ?? "USD"
        };
      })
      .filter((holding): holding is NonNullable<typeof holding> => holding !== null)
  });

  return holdings.length;
}

async function upsertInvestmentTransactionsForItem(
  plaidItem: PlaidItemWithAccounts,
  transactions: PlaidInvestmentTransaction[],
  securities: InvestmentSecurityRecord[]
) {
  if (transactions.length === 0) {
    return 0;
  }

  const securityMap = buildSecurityMap(securities);
  const accountIdByPlaidAccountId = new Map<string, string>(
    plaidItem.accounts.map((account: PersistedPlaidAccount) => [
      account.plaidAccountId,
      account.id
    ])
  );

  await Promise.all(
    transactions.map((transaction) => {
      const accountId = accountIdByPlaidAccountId.get(transaction.account_id);
      if (!accountId) {
        throw new Error(
          `Missing persisted account for investment account ${transaction.account_id}.`
        );
      }

      const date = parseTransactionDate(transaction.date);
      if (!date) {
        throw new Error(
          `Investment transaction ${transaction.investment_transaction_id} is missing a date.`
        );
      }

      const security = transaction.security_id
        ? securityMap.get(transaction.security_id)
        : null;

      return prisma.investmentTransaction.upsert({
        where: {
          plaidInvestmentTransactionId: transaction.investment_transaction_id
        },
        update: {
          userId: plaidItem.userId,
          accountId,
          securityId: transaction.security_id ?? null,
          symbol: security?.symbol ?? null,
          name: security?.name ?? transaction.name,
          type: transaction.type,
          subtype: transaction.subtype ?? null,
          amount: normalizeBalance(transaction.amount) ?? "0.00",
          quantity: normalizePreciseNumber(transaction.quantity, 8),
          price: normalizePreciseNumber(transaction.price, 4),
          fees: normalizeBalance(transaction.fees),
          date,
          isoCurrencyCode:
            transaction.iso_currency_code ??
            transaction.unofficial_currency_code ??
            "USD"
        },
        create: {
          userId: plaidItem.userId,
          accountId,
          plaidInvestmentTransactionId: transaction.investment_transaction_id,
          securityId: transaction.security_id ?? null,
          symbol: security?.symbol ?? null,
          name: security?.name ?? transaction.name,
          type: transaction.type,
          subtype: transaction.subtype ?? null,
          amount: normalizeBalance(transaction.amount) ?? "0.00",
          quantity: normalizePreciseNumber(transaction.quantity, 8),
          price: normalizePreciseNumber(transaction.price, 4),
          fees: normalizeBalance(transaction.fees),
          date,
          isoCurrencyCode:
            transaction.iso_currency_code ??
            transaction.unofficial_currency_code ??
            "USD"
        }
      });
    })
  );

  return transactions.length;
}

async function syncInvestmentsForPersistedItem(
  plaidItem: PlaidItemWithAccounts
): Promise<InvestmentSyncResult | null> {
  const investmentAccountIds = getInvestmentAccountIds(plaidItem);
  if (investmentAccountIds.length === 0) {
    return null;
  }

  const plaidClient = getPlaidApi();
  const accessToken = getAccessToken(plaidItem);
  const asOf = new Date();

  const holdingsResponse = await plaidClient.investmentsHoldingsGet({
    access_token: accessToken,
    options: {
      account_ids: investmentAccountIds
    }
  });

  await upsertInvestmentAccountBalances(plaidItem, holdingsResponse.data.accounts);
  const holdingsCount = await createHoldingSnapshotsForItem(
    plaidItem,
    holdingsResponse.data.holdings,
    holdingsResponse.data.securities,
    asOf
  );

  const endDate = asOf.toISOString().slice(0, 10);
  const startDate = new Date(asOf);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  const startDateKey = startDate.toISOString().slice(0, 10);
  const investmentTransactions: PlaidInvestmentTransaction[] = [];
  let offset = 0;
  const pageSize = 100;
  let totalInvestmentTransactions = 0;
  let securities = holdingsResponse.data.securities;

  do {
    const response = await plaidClient.investmentsTransactionsGet({
      access_token: accessToken,
      start_date: startDateKey,
      end_date: endDate,
      options: {
        account_ids: investmentAccountIds,
        count: pageSize,
        offset
      }
    });

    totalInvestmentTransactions = response.data.total_investment_transactions;
    securities = response.data.securities;
    investmentTransactions.push(...response.data.investment_transactions);
    offset += response.data.investment_transactions.length;
  } while (offset < totalInvestmentTransactions);

  const investmentTransactionCount = await upsertInvestmentTransactionsForItem(
    plaidItem,
    investmentTransactions,
    securities
  );

  await prisma.plaidItem.update({
    where: {
      id: plaidItem.id
    },
    data: {
      lastSyncedAt: new Date(),
      status: PlaidItemStatus.active,
      errorCode: null
    }
  });

  return {
    plaidItemId: plaidItem.plaidItemId,
    institutionName: plaidItem.institutionName,
    holdingsCount,
    investmentTransactionCount,
    accountCount: investmentAccountIds.length,
    asOf: asOf.toISOString()
  };
}

export async function syncInvestmentsForLinkedItems() {
  const plaidItems = await listPersistedPlaidItems();
  if (plaidItems.length === 0) {
    return {
      syncedItems: [],
      totalHoldings: 0,
      totalInvestmentTransactions: 0,
      failedItems: []
    };
  }

  const syncedItems: InvestmentSyncResult[] = [];
  const failedItems: Array<{
    plaidItemId: string;
    institutionName: string | null;
    errorCode: string | null;
    error: string;
  }> = [];

  for (const plaidItem of plaidItems) {
    try {
      const result = await syncInvestmentsForPersistedItem(plaidItem);
      if (result) {
        syncedItems.push(result);
      }
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
    totalHoldings: syncedItems.reduce((sum, item) => sum + item.holdingsCount, 0),
    totalInvestmentTransactions: syncedItems.reduce(
      (sum, item) => sum + item.investmentTransactionCount,
      0
    ),
    failedItems
  };
}

export async function syncInvestmentsForPlaidItem(plaidItemId: string) {
  const plaidItem = await findPersistedPlaidItemById(plaidItemId);
  if (!plaidItem) {
    throw new Error("Unable to find the linked institution to sync.");
  }

  return syncInvestmentsForPersistedItem(plaidItem);
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
  let investmentSyncResult = null;

  try {
    syncResult = await syncTransactionsForPersistedItem({
      ...plaidItem,
      ...persisted.plaidItem,
      accounts: persisted.accounts
    });
  } catch (error) {
    await markPlaidItemFromError(persisted.plaidItem.id, error);
  }

  try {
    investmentSyncResult = await syncInvestmentsForPersistedItem({
      ...plaidItem,
      ...persisted.plaidItem,
      accounts: persisted.accounts
    });
  } catch (error) {
    const plaidErrorCode = getPlaidErrorCode(error);
    if (plaidErrorCode !== "INVALID_PRODUCT") {
      await markPlaidItemFromError(persisted.plaidItem.id, error);
    }
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
    syncResult,
    investmentSyncResult
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

  if (
    payload.webhook_type === "HOLDINGS" ||
    payload.webhook_type === "INVESTMENTS_TRANSACTIONS"
  ) {
    await updateLastWebhook();

    try {
      const syncResult = await syncInvestmentsForPersistedItem(plaidItem);

      return {
        handled: true,
        action: "synced_investments",
        syncResult
      };
    } catch (error) {
      const plaidError = await markPlaidItemFromError(plaidItem.id, error);

      return {
        handled: false,
        action: "investment_sync_failed",
        ...plaidError
      };
    }
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

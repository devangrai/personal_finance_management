import {
  CountryCode,
  type AccountsGetResponse,
  type ItemPublicTokenExchangeResponse,
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
import { getOrCreateDefaultUser } from "./user";

type ExchangePublicTokenInput = {
  publicToken: string;
  institutionId?: string;
  institutionName?: string;
};

type PersistPlaidItemInput = {
  exchangeResponse: ItemPublicTokenExchangeResponse;
  accountsResponse: AccountsGetResponse;
  institutionId?: string;
  institutionName?: string;
};

type PlaidItemWithAccounts = Awaited<
  ReturnType<typeof listPersistedPlaidItems>
>[number];

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

export async function createLinkToken() {
  const env = getAppEnv();
  const user = await getOrCreateDefaultUser();
  const plaidClient = getPlaidApi();

  const response = await plaidClient.linkTokenCreate({
    client_name: env.plaidClientName,
    country_codes: env.plaidCountryCodes,
    language: "en",
    products: env.plaidProducts,
    user: {
      client_user_id: user.id
    },
    redirect_uri: env.plaidRedirectUri
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
      plaidItemId: input.exchangeResponse.item_id
    },
    update: {
      userId: user.id,
      plaidEnvironment: resolvePlaidItemEnvironment(env.plaidEnv),
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      accessTokenEncrypted: encryptString(
        input.exchangeResponse.access_token,
        env.encryptionKey
      ),
      status: PlaidItemStatus.active
    },
    create: {
      userId: user.id,
      plaidItemId: input.exchangeResponse.item_id,
      plaidEnvironment: resolvePlaidItemEnvironment(env.plaidEnv),
      institutionId: input.institutionId,
      institutionName: input.institutionName,
      accessTokenEncrypted: encryptString(
        input.exchangeResponse.access_token,
        env.encryptionKey
      ),
      status: PlaidItemStatus.active
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
    exchangeResponse: exchangeResponse.data,
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
          plaidAccountId: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
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

async function upsertTransactionsForItem(
  plaidItem: PlaidItemWithAccounts,
  transactions: PlaidTransaction[]
) {
  const user = await getOrCreateDefaultUser();
  const accountIdByPlaidAccountId = new Map(
    plaidItem.accounts.map((account) => [account.plaidAccountId, account.id])
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

      return prisma.transaction.upsert({
        where: {
          plaidTransactionId: transaction.transaction_id
        },
        update: {
          userId: user.id,
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
          reviewStatus: TransactionReviewStatus.uncategorized
        },
        create: {
          userId: user.id,
          accountId,
          plaidTransactionId: transaction.transaction_id,
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
          reviewStatus: TransactionReviewStatus.uncategorized
        }
      });
    })
  );
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

async function syncSinglePlaidItem(plaidItem: PlaidItemWithAccounts) {
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

      await upsertTransactionsForItem(plaidItem, added);
      await upsertTransactionsForItem(plaidItem, modified);
      removedCount += await removeTransactions(removed);

      addedCount += added.length;
      modifiedCount += modified.length;
      cursor = next_cursor;
      hasMore = has_more;
    } catch (error) {
      const plaidErrorCode =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof error.response === "object" &&
        error.response !== null &&
        "data" in error.response &&
        typeof error.response.data === "object" &&
        error.response.data !== null &&
        "error_code" in error.response.data
          ? String(error.response.data.error_code)
          : undefined;

      if (
        plaidErrorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        restartCount < 1
      ) {
        cursor = plaidItem.transactionsCursor ?? undefined;
        hasMore = true;
        restartCount += 1;
        continue;
      }

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
      totalRemoved: 0
    };
  }

  const syncedItems = [];

  for (const plaidItem of plaidItems) {
    syncedItems.push(await syncSinglePlaidItem(plaidItem));
  }

  return {
    syncedItems,
    totalAdded: syncedItems.reduce((sum, item) => sum + item.addedCount, 0),
    totalModified: syncedItems.reduce((sum, item) => sum + item.modifiedCount, 0),
    totalRemoved: syncedItems.reduce((sum, item) => sum + item.removedCount, 0)
  };
}

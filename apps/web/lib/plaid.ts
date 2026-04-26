import {
  CountryCode,
  Products,
  type AccountsGetResponse,
  type ItemPublicTokenExchangeResponse,
  type LinkTokenCreateResponse
} from "plaid";
import { AccountType, PlaidEnvironment, PlaidItemStatus, prisma } from "@portfolio/db";
import { createPlaidClient } from "@portfolio/plaid";
import { encryptString } from "./crypto";
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

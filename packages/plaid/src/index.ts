import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products
} from "plaid";

export type PlaidEnvironmentName = "sandbox" | "development" | "production";

export type PlaidConfig = {
  clientId: string;
  secret: string;
  env: PlaidEnvironmentName;
  redirectUri?: string;
};

export type PlaidSyncCursor = {
  itemId: string;
  cursor: string | null;
};

const supportedProducts = new Set<string>(Object.values(Products));
const supportedCountryCodes = new Set<string>(Object.values(CountryCode));

export function assertPlaidConfig(config: PlaidConfig) {
  if (!config.clientId || !config.secret) {
    throw new Error("Missing Plaid credentials.");
  }
}

export function createPlaidClient(config: PlaidConfig) {
  assertPlaidConfig(config);

  const basePath = PlaidEnvironments[config.env];
  if (!basePath) {
    throw new Error(`Unsupported Plaid environment: ${config.env}`);
  }

  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.clientId,
          "PLAID-SECRET": config.secret
        }
      }
    })
  );
}

export function parsePlaidProducts(rawValue?: string) {
  const requestedProducts = (rawValue ?? "transactions,investments")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (requestedProducts.length === 0) {
    throw new Error("PLAID_PRODUCTS must include at least one product.");
  }

  return requestedProducts.map((product) => {
    if (!supportedProducts.has(product)) {
      throw new Error(`Unsupported Plaid product: ${product}`);
    }

    return product as Products;
  });
}

export function parsePlaidCountryCodes(rawValue?: string) {
  const requestedCountryCodes = (rawValue ?? "US")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

  if (requestedCountryCodes.length === 0) {
    throw new Error("PLAID_COUNTRY_CODES must include at least one country.");
  }

  return requestedCountryCodes.map((countryCode) => {
    if (!supportedCountryCodes.has(countryCode)) {
      throw new Error(`Unsupported Plaid country code: ${countryCode}`);
    }

    return countryCode as CountryCode;
  });
}

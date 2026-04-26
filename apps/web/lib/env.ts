import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  type CountryCode,
  type Products
} from "plaid";
import {
  type PlaidEnvironmentName,
  parsePlaidCountryCodes,
  parsePlaidProducts
} from "@portfolio/plaid";

loadEnvConfig(path.resolve(process.cwd(), "../.."));

type AppEnv = {
  appUrl: string;
  plaidClientId: string;
  plaidSecret: string;
  plaidEnv: PlaidEnvironmentName;
  plaidClientName: string;
  plaidCountryCodes: CountryCode[];
  plaidProducts: Products[];
  plaidRedirectUri?: string;
  encryptionKey: string;
  defaultUserEmail: string;
};

const supportedPlaidEnvironments = new Set<PlaidEnvironmentName>([
  "sandbox",
  "development",
  "production"
]);

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolvePlaidSecret(plaidEnv: PlaidEnvironmentName) {
  const envSpecificSecretName =
    plaidEnv === "sandbox"
      ? "PLAID_SANDBOX_SECRET"
      : plaidEnv === "development"
        ? "PLAID_DEVELOPMENT_SECRET"
        : "PLAID_PRODUCTION_SECRET";

  return optionalEnv(envSpecificSecretName) ?? requireEnv("PLAID_SECRET");
}

export function getAppEnv(): AppEnv {
  const plaidEnvValue = requireEnv("PLAID_ENV");
  if (!supportedPlaidEnvironments.has(plaidEnvValue as PlaidEnvironmentName)) {
    throw new Error(
      "PLAID_ENV must be one of: sandbox, development, production."
    );
  }

  const appUrl = requireEnv("NEXT_PUBLIC_APP_URL");
  new URL(appUrl);

  return {
    appUrl,
    plaidClientId: requireEnv("PLAID_CLIENT_ID"),
    plaidSecret: resolvePlaidSecret(plaidEnvValue as PlaidEnvironmentName),
    plaidEnv: plaidEnvValue as PlaidEnvironmentName,
    plaidClientName:
      optionalEnv("PLAID_CLIENT_NAME") ?? "Personal Finance Management",
    plaidCountryCodes: parsePlaidCountryCodes(
      optionalEnv("PLAID_COUNTRY_CODES")
    ),
    plaidProducts: parsePlaidProducts(optionalEnv("PLAID_PRODUCTS")),
    plaidRedirectUri: optionalEnv("PLAID_REDIRECT_URI"),
    encryptionKey: requireEnv("ENCRYPTION_KEY"),
    defaultUserEmail:
      optionalEnv("DEFAULT_USER_EMAIL") ?? "owner@example.com"
  };
}

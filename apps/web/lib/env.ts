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
  plaidWebhookUrl: string;
  plaidClientId: string;
  plaidSecret: string;
  plaidEnv: PlaidEnvironmentName;
  plaidClientName: string;
  plaidCountryCodes: CountryCode[];
  plaidProducts: Products[];
  plaidRedirectUri?: string;
  openAiApiKey?: string;
  openAiModel: string;
  geminiApiKey?: string;
  geminiModel: string;
  dailyReviewTimezone: string;
  dailyReviewHourLocal: number;
  dailyReviewWebhookUrl?: string;
  dailyReviewWebhookBearerToken?: string;
  encryptionKey: string;
  defaultUserEmail: string;
  cronSecret?: string;
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

function parseOptionalInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const appUrlObject = new URL(appUrl);

  return {
    appUrl,
    plaidWebhookUrl:
      optionalEnv("PLAID_WEBHOOK_URL") ??
      new URL("/api/plaid/webhook", appUrlObject).toString(),
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
    openAiApiKey: optionalEnv("OPENAI_API_KEY"),
    openAiModel: optionalEnv("OPENAI_MODEL") ?? "gpt-4.1-mini",
    geminiApiKey: optionalEnv("GEMINI_API_KEY"),
    geminiModel: optionalEnv("GEMINI_MODEL") ?? "gemini-2.5-flash",
    dailyReviewTimezone:
      optionalEnv("DAILY_REVIEW_TIMEZONE") ?? "America/Los_Angeles",
    dailyReviewHourLocal: parseOptionalInt(
      optionalEnv("DAILY_REVIEW_HOUR_LOCAL"),
      20
    ),
    dailyReviewWebhookUrl: optionalEnv("DAILY_REVIEW_WEBHOOK_URL"),
    dailyReviewWebhookBearerToken: optionalEnv(
      "DAILY_REVIEW_WEBHOOK_BEARER_TOKEN"
    ),
    encryptionKey: requireEnv("ENCRYPTION_KEY"),
    defaultUserEmail:
      optionalEnv("DEFAULT_USER_EMAIL") ?? "owner@example.com",
    cronSecret: optionalEnv("CRON_SECRET")
  };
}

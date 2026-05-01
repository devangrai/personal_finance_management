import { PrismaClient } from "@prisma/client";

export const PlaidEnvironment = {
  sandbox: "sandbox",
  development: "development",
  production: "production"
} as const;

export type PlaidEnvironment =
  (typeof PlaidEnvironment)[keyof typeof PlaidEnvironment];

export const PlaidItemStatus = {
  active: "active",
  error: "error",
  needs_reauth: "needs_reauth",
  disconnected: "disconnected"
} as const;

export type PlaidItemStatus =
  (typeof PlaidItemStatus)[keyof typeof PlaidItemStatus];

export const AccountType = {
  depository: "depository",
  credit: "credit",
  investment: "investment",
  loan: "loan",
  other: "other"
} as const;

export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const TransactionDirection = {
  debit: "debit",
  credit: "credit"
} as const;

export type TransactionDirection =
  (typeof TransactionDirection)[keyof typeof TransactionDirection];

export const TransactionReviewStatus = {
  uncategorized: "uncategorized",
  auto_categorized: "auto_categorized",
  user_categorized: "user_categorized",
  ignored: "ignored"
} as const;

export type TransactionReviewStatus =
  (typeof TransactionReviewStatus)[keyof typeof TransactionReviewStatus];

export const RuleMatchType = {
  merchant_name: "merchant_name",
  transaction_name: "transaction_name",
  plaid_category: "plaid_category",
  account_name: "account_name",
  exact: "exact",
  contains: "contains",
  regex: "regex"
} as const;

export type RuleMatchType =
  (typeof RuleMatchType)[keyof typeof RuleMatchType];

export const DailyReviewDigestStatus = {
  pending: "pending",
  sent: "sent",
  acknowledged: "acknowledged",
  failed: "failed"
} as const;

export type DailyReviewDigestStatus =
  (typeof DailyReviewDigestStatus)[keyof typeof DailyReviewDigestStatus];

export const ManualInvestmentBucket = {
  retirement: "retirement",
  taxable: "taxable",
  other: "other"
} as const;

export type ManualInvestmentBucket =
  (typeof ManualInvestmentBucket)[keyof typeof ManualInvestmentBucket];

declare global {
  // eslint-disable-next-line no-var
  var __portfolioPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__portfolioPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__portfolioPrisma__ = prisma;
}

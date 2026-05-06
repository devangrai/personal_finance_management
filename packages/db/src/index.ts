import { Prisma, PrismaClient } from "@prisma/client";
export { Prisma };

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

export const RecommendationType = {
  budget: "budget",
  emergency_fund: "emergency_fund",
  retirement: "retirement",
  portfolio: "portfolio",
  tax: "tax",
  general: "general"
} as const;

export type RecommendationType =
  (typeof RecommendationType)[keyof typeof RecommendationType];

export const RecommendationRunStatus = {
  succeeded: "succeeded",
  failed: "failed",
  partial: "partial"
} as const;

export type RecommendationRunStatus =
  (typeof RecommendationRunStatus)[keyof typeof RecommendationRunStatus];

export const UserFactSource = {
  conversation: "conversation",
  profile: "profile",
  import: "import",
  manual: "manual"
} as const;

export type UserFactSource =
  (typeof UserFactSource)[keyof typeof UserFactSource];

export const LessonKind = {
  preference: "preference",
  advice_lesson: "advice_lesson"
} as const;

export type LessonKind = (typeof LessonKind)[keyof typeof LessonKind];

export const LessonTopic = {
  tax: "tax",
  retirement: "retirement",
  spending: "spending",
  portfolio: "portfolio",
  goals: "goals",
  general: "general"
} as const;

export type LessonTopic = (typeof LessonTopic)[keyof typeof LessonTopic];

export const SnapTradeConnectionStatus = {
  active: "active",
  disabled: "disabled",
  error: "error"
} as const;

export type SnapTradeConnectionStatus =
  (typeof SnapTradeConnectionStatus)[keyof typeof SnapTradeConnectionStatus];

export const CandidateLessonStatus = {
  pending: "pending",
  graduated: "graduated",
  rejected: "rejected",
  reopened: "reopened"
} as const;

export type CandidateLessonStatus =
  (typeof CandidateLessonStatus)[keyof typeof CandidateLessonStatus];

export const ExtractedFactKind = {
  fact: "fact",
  goal: "goal",
  goal_progress: "goal_progress",
  obligation: "obligation",
  revert: "revert"
} as const;

export type ExtractedFactKind =
  (typeof ExtractedFactKind)[keyof typeof ExtractedFactKind];

export const ExtractedFactStatus = {
  auto_applied: "auto_applied",
  staged: "staged",
  confirmed: "confirmed",
  rejected: "rejected",
  superseded: "superseded",
  reverted: "reverted"
} as const;

export type ExtractedFactStatus =
  (typeof ExtractedFactStatus)[keyof typeof ExtractedFactStatus];

export const ProactiveNudgeKind = {
  spending_anomaly: "spending_anomaly",
  goal_checkin: "goal_checkin",
  portfolio_drift: "portfolio_drift",
  cash_sweep: "cash_sweep",
  budget_exceeded: "budget_exceeded",
  other: "other"
} as const;

export type ProactiveNudgeKind =
  (typeof ProactiveNudgeKind)[keyof typeof ProactiveNudgeKind];

export const ProactiveNudgeStatus = {
  pending: "pending",
  surfaced: "surfaced",
  dismissed: "dismissed",
  acted_on: "acted_on"
} as const;

export type ProactiveNudgeStatus =
  (typeof ProactiveNudgeStatus)[keyof typeof ProactiveNudgeStatus];

export const UserDocumentStatus = {
  pending: "pending",
  processing: "processing",
  ready: "ready",
  failed: "failed"
} as const;

export type UserDocumentStatus =
  (typeof UserDocumentStatus)[keyof typeof UserDocumentStatus];

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

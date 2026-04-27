import {
  AccountType,
  PlaidEnvironment,
  PlaidItemStatus,
  RuleMatchType,
  TransactionDirection,
  TransactionReviewStatus,
  PrismaClient
} from "@prisma/client";

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

export {
  AccountType,
  PlaidEnvironment,
  PlaidItemStatus,
  RuleMatchType,
  TransactionDirection,
  TransactionReviewStatus
};

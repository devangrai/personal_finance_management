-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlaidEnvironment" AS ENUM ('sandbox', 'development', 'production');

-- CreateEnum
CREATE TYPE "PlaidItemStatus" AS ENUM ('active', 'error', 'needs_reauth', 'disconnected');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('depository', 'credit', 'investment', 'loan', 'other');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "TransactionReviewStatus" AS ENUM ('uncategorized', 'auto_categorized', 'user_categorized', 'ignored');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('merchant_name', 'transaction_name', 'plaid_category', 'account_name', 'exact', 'contains', 'regex');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('budget', 'emergency_fund', 'retirement', 'portfolio', 'tax', 'general');

-- CreateEnum
CREATE TYPE "RecommendationRunStatus" AS ENUM ('succeeded', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('weekly', 'biweekly', 'semimonthly', 'monthly', 'quarterly', 'annually', 'ad_hoc');

-- CreateEnum
CREATE TYPE "HousingStatus" AS ENUM ('rent_free', 'rent', 'mortgage', 'other');

-- CreateEnum
CREATE TYPE "RiskTolerance" AS ENUM ('conservative', 'moderate', 'aggressive', 'unknown');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "birthYear" INTEGER,
    "stateCode" TEXT,
    "housingStatus" "HousingStatus" NOT NULL DEFAULT 'rent_free',
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "annualIncomeCents" BIGINT,
    "biweeklyNetPayCents" BIGINT,
    "monthlyFixedExpenseCents" BIGINT,
    "paycheckFrequency" "RecurrenceFrequency",
    "currentEmergencyFundTargetCents" BIGINT,
    "targetRetirementSavingsRateBps" INTEGER,
    "riskTolerance" "RiskTolerance" NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidEnvironment" "PlaidEnvironment" NOT NULL DEFAULT 'sandbox',
    "institutionId" TEXT,
    "institutionName" TEXT,
    "accessTokenEncrypted" TEXT NOT NULL,
    "status" "PlaidItemStatus" NOT NULL DEFAULT 'active',
    "transactionsCursor" TEXT,
    "lastWebhookAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "subtype" TEXT,
    "type" "AccountType" NOT NULL,
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "currentBalance" DECIMAL(18,2),
    "availableBalance" DECIMAL(18,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentKey" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plaidTransactionId" TEXT NOT NULL,
    "pendingTransactionId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "authorizedDate" TIMESTAMP(3),
    "name" TEXT NOT NULL,
    "merchantName" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "direction" "TransactionDirection" NOT NULL,
    "isPending" BOOLEAN NOT NULL DEFAULT false,
    "plaidCategory" JSONB,
    "personalFinanceCategory" TEXT,
    "categoryId" TEXT,
    "reviewStatus" "TransactionReviewStatus" NOT NULL DEFAULT 'uncategorized',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "matchType" "RuleMatchType" NOT NULL,
    "matchValue" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HoldingSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "securityId" TEXT,
    "symbol" TEXT,
    "securityName" TEXT NOT NULL,
    "quantity" DECIMAL(24,8),
    "institutionPrice" DECIMAL(18,4),
    "institutionValue" DECIMAL(18,2),
    "costBasis" DECIMAL(18,2),
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "plaidInvestmentTransactionId" TEXT NOT NULL,
    "securityId" TEXT,
    "symbol" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "quantity" DECIMAL(24,8),
    "price" DECIMAL(18,4),
    "fees" DECIMAL(18,2),
    "date" TIMESTAMP(3) NOT NULL,
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "status" "RecommendationRunStatus" NOT NULL DEFAULT 'succeeded',
    "inputSnapshot" JSONB NOT NULL,
    "outputPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidItem_plaidItemId_key" ON "PlaidItem"("plaidItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_plaidAccountId_key" ON "Account"("plaidAccountId");

-- CreateIndex
CREATE INDEX "Account_userId_type_idx" ON "Account"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCategory_userId_key_key" ON "TransactionCategory"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plaidTransactionId_key" ON "Transaction"("plaidTransactionId");

-- CreateIndex
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_date_idx" ON "Transaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_date_idx" ON "Transaction"("categoryId", "date");

-- CreateIndex
CREATE INDEX "TransactionRule_userId_priority_idx" ON "TransactionRule"("userId", "priority");

-- CreateIndex
CREATE INDEX "HoldingSnapshot_userId_asOf_idx" ON "HoldingSnapshot"("userId", "asOf");

-- CreateIndex
CREATE INDEX "HoldingSnapshot_accountId_asOf_idx" ON "HoldingSnapshot"("accountId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_plaidInvestmentTransactionId_key" ON "InvestmentTransaction"("plaidInvestmentTransactionId");

-- CreateIndex
CREATE INDEX "InvestmentTransaction_userId_date_idx" ON "InvestmentTransaction"("userId", "date");

-- CreateIndex
CREATE INDEX "InvestmentTransaction_accountId_date_idx" ON "InvestmentTransaction"("accountId", "date");

-- CreateIndex
CREATE INDEX "RecommendationRun_userId_type_createdAt_idx" ON "RecommendationRun"("userId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRule" ADD CONSTRAINT "TransactionRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionRule" ADD CONSTRAINT "TransactionRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingSnapshot" ADD CONSTRAINT "HoldingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingSnapshot" ADD CONSTRAINT "HoldingSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


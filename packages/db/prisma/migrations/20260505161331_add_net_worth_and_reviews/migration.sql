-- CreateTable
CREATE TABLE "ManualAssetLiability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualAssetLiability_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManualAssetLiability_userId_kind_idx" ON "ManualAssetLiability"("userId", "kind");
ALTER TABLE "ManualAssetLiability" ADD CONSTRAINT "ManualAssetLiability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "NetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "cashCents" BIGINT NOT NULL,
    "investmentsCents" BIGINT NOT NULL,
    "manualAssetsCents" BIGINT NOT NULL,
    "creditCardDebtCents" BIGINT NOT NULL,
    "loanDebtCents" BIGINT NOT NULL,
    "manualLiabilitiesCents" BIGINT NOT NULL,
    "netWorthCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetWorthSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NetWorthSnapshot_userId_snapshotDate_key" ON "NetWorthSnapshot"("userId", "snapshotDate");
CREATE INDEX "NetWorthSnapshot_userId_snapshotDate_idx" ON "NetWorthSnapshot"("userId", "snapshotDate");
ALTER TABLE "NetWorthSnapshot" ADD CONSTRAINT "NetWorthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MonthlyReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshotJson" JSONB NOT NULL,
    "summaryText" TEXT,
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "MonthlyReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonthlyReview_userId_month_key" ON "MonthlyReview"("userId", "month");
CREATE INDEX "MonthlyReview_userId_generatedAt_idx" ON "MonthlyReview"("userId", "generatedAt");
ALTER TABLE "MonthlyReview" ADD CONSTRAINT "MonthlyReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

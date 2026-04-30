-- CreateEnum
CREATE TYPE "DailyReviewDigestStatus" AS ENUM ('pending', 'sent', 'acknowledged', 'failed');

-- AlterTable
ALTER TABLE "Transaction"
ADD COLUMN "aiSuggestedAt" TIMESTAMP(3),
ADD COLUMN "aiSuggestedByModel" TEXT,
ADD COLUMN "aiSuggestedCategoryId" TEXT,
ADD COLUMN "aiSuggestedConfidence" INTEGER,
ADD COLUMN "aiSuggestedReason" TEXT;

-- CreateTable
CREATE TABLE "DailyReviewDigest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDateKey" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledHourLocal" INTEGER NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "autoCategorizedCount" INTEGER NOT NULL DEFAULT 0,
    "uncategorizedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewUrl" TEXT,
    "pingSummary" TEXT,
    "status" "DailyReviewDigestStatus" NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReviewDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReviewDigest_userId_status_idx" ON "DailyReviewDigest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReviewDigest_userId_localDateKey_key" ON "DailyReviewDigest"("userId", "localDateKey");

-- CreateIndex
CREATE INDEX "Transaction_aiSuggestedCategoryId_date_idx" ON "Transaction"("aiSuggestedCategoryId", "date");

-- AddForeignKey
ALTER TABLE "Transaction"
ADD CONSTRAINT "Transaction_aiSuggestedCategoryId_fkey"
FOREIGN KEY ("aiSuggestedCategoryId") REFERENCES "TransactionCategory"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReviewDigest"
ADD CONSTRAINT "DailyReviewDigest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

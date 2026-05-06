-- CreateTable
CREATE TABLE "UserGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetValueCents" BIGINT,
    "targetDate" TIMESTAMP(3),
    "commitment" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserGoal_userId_isActive_idx" ON "UserGoal"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserGoal_userId_goalKey_key" ON "UserGoal"("userId", "goalKey");

-- AddForeignKey
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ManualHoldingSnapshot_account_asOf_fingerprint_key" RENAME TO "ManualHoldingSnapshot_manualInvestmentAccountId_asOf_rowFin_key";

-- RenameIndex
ALTER INDEX "ManualInvestmentTransaction_account_fingerprint_key" RENAME TO "ManualInvestmentTransaction_manualInvestmentAccountId_rowFi_key";

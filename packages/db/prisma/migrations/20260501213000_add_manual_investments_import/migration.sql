-- CreateEnum
CREATE TYPE "ManualInvestmentBucket" AS ENUM ('retirement', 'taxable', 'other');

-- CreateTable
CREATE TABLE "ManualInvestmentAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtype" TEXT,
    "bucket" "ManualInvestmentBucket" NOT NULL DEFAULT 'other',
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "lastImportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualInvestmentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualHoldingSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualInvestmentAccountId" TEXT NOT NULL,
    "rowFingerprint" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "securityId" TEXT,
    "symbol" TEXT,
    "securityName" TEXT NOT NULL,
    "quantity" DECIMAL(24,8),
    "institutionPrice" DECIMAL(18,4),
    "institutionValue" DECIMAL(18,2),
    "costBasis" DECIMAL(18,2),
    "isoCurrencyCode" TEXT DEFAULT 'USD',
    "rawRow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualHoldingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualInvestmentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "manualInvestmentAccountId" TEXT NOT NULL,
    "rowFingerprint" TEXT NOT NULL,
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
    "rawRow" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualInvestmentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualInvestmentAccount_accountKey_key" ON "ManualInvestmentAccount"("accountKey");

-- CreateIndex
CREATE INDEX "ManualInvestmentAccount_userId_source_idx" ON "ManualInvestmentAccount"("userId", "source");

-- CreateIndex
CREATE INDEX "ManualInvestmentAccount_userId_bucket_idx" ON "ManualInvestmentAccount"("userId", "bucket");

-- CreateIndex
CREATE INDEX "ManualHoldingSnapshot_userId_asOf_idx" ON "ManualHoldingSnapshot"("userId", "asOf");

-- CreateIndex
CREATE INDEX "ManualHoldingSnapshot_manualInvestmentAccountId_asOf_idx" ON "ManualHoldingSnapshot"("manualInvestmentAccountId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "ManualHoldingSnapshot_account_asOf_fingerprint_key" ON "ManualHoldingSnapshot"("manualInvestmentAccountId", "asOf", "rowFingerprint");

-- CreateIndex
CREATE INDEX "ManualInvestmentTransaction_userId_date_idx" ON "ManualInvestmentTransaction"("userId", "date");

-- CreateIndex
CREATE INDEX "ManualInvestmentTransaction_manualInvestmentAccountId_date_idx" ON "ManualInvestmentTransaction"("manualInvestmentAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ManualInvestmentTransaction_account_fingerprint_key" ON "ManualInvestmentTransaction"("manualInvestmentAccountId", "rowFingerprint");

-- AddForeignKey
ALTER TABLE "ManualInvestmentAccount" ADD CONSTRAINT "ManualInvestmentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualHoldingSnapshot" ADD CONSTRAINT "ManualHoldingSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualHoldingSnapshot" ADD CONSTRAINT "ManualHoldingSnapshot_manualInvestmentAccountId_fkey" FOREIGN KEY ("manualInvestmentAccountId") REFERENCES "ManualInvestmentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualInvestmentTransaction" ADD CONSTRAINT "ManualInvestmentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualInvestmentTransaction" ADD CONSTRAINT "ManualInvestmentTransaction_manualInvestmentAccountId_fkey" FOREIGN KEY ("manualInvestmentAccountId") REFERENCES "ManualInvestmentAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

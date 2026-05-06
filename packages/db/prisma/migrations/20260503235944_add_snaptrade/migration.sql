-- CreateEnum
CREATE TYPE "SnapTradeConnectionStatus" AS ENUM ('active', 'disabled', 'error');

-- AlterTable
ALTER TABLE "ManualInvestmentAccount" ADD COLUMN     "snapTradeConnectionId" TEXT;

-- CreateTable
CREATE TABLE "SnapTradeUser" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snaptradeUserId" TEXT NOT NULL,
    "snaptradeUserSecretEncrypted" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapTradeUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnapTradeConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapTradeUserId" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "brokerageSlug" TEXT NOT NULL,
    "brokerageName" TEXT NOT NULL,
    "status" "SnapTradeConnectionStatus" NOT NULL DEFAULT 'active',
    "disabledReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastHoldingsUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnapTradeConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SnapTradeUser_userId_key" ON "SnapTradeUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapTradeUser_snaptradeUserId_key" ON "SnapTradeUser"("snaptradeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SnapTradeConnection_authorizationId_key" ON "SnapTradeConnection"("authorizationId");

-- CreateIndex
CREATE INDEX "SnapTradeConnection_userId_status_idx" ON "SnapTradeConnection"("userId", "status");

-- CreateIndex
CREATE INDEX "ManualInvestmentAccount_snapTradeConnectionId_idx" ON "ManualInvestmentAccount"("snapTradeConnectionId");

-- AddForeignKey
ALTER TABLE "ManualInvestmentAccount" ADD CONSTRAINT "ManualInvestmentAccount_snapTradeConnectionId_fkey" FOREIGN KEY ("snapTradeConnectionId") REFERENCES "SnapTradeConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeUser" ADD CONSTRAINT "SnapTradeUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeConnection" ADD CONSTRAINT "SnapTradeConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnapTradeConnection" ADD CONSTRAINT "SnapTradeConnection_snapTradeUserId_fkey" FOREIGN KEY ("snapTradeUserId") REFERENCES "SnapTradeUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

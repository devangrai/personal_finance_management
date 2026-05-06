-- CreateEnum
CREATE TYPE "ExtractedFactKind" AS ENUM ('fact', 'goal', 'goal_progress', 'obligation', 'revert');

-- CreateEnum
CREATE TYPE "ExtractedFactStatus" AS ENUM ('auto_applied', 'staged', 'confirmed', 'rejected', 'superseded', 'reverted');

-- CreateEnum
CREATE TYPE "ProactiveNudgeKind" AS ENUM ('spending_anomaly', 'goal_checkin', 'portfolio_drift', 'cash_sweep', 'other');

-- CreateEnum
CREATE TYPE "ProactiveNudgeStatus" AS ENUM ('pending', 'surfaced', 'dismissed', 'acted_on');

-- CreateTable
CREATE TABLE "ExtractedFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "sessionId" TEXT,
    "kind" "ExtractedFactKind" NOT NULL,
    "status" "ExtractedFactStatus" NOT NULL,
    "factKey" TEXT,
    "goalKey" TEXT,
    "newValue" JSONB NOT NULL,
    "previousValue" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "reasoning" TEXT,
    "stakesLevel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractedFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProactiveNudge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ProactiveNudgeKind" NOT NULL,
    "headline" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "suggestedAction" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "status" "ProactiveNudgeStatus" NOT NULL DEFAULT 'pending',
    "evidencePayload" JSONB,
    "surfacedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProactiveNudge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtractedFact_userId_status_createdAt_idx" ON "ExtractedFact"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractedFact_userId_kind_createdAt_idx" ON "ExtractedFact"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ProactiveNudge_userId_status_createdAt_idx" ON "ProactiveNudge"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ExtractedFact" ADD CONSTRAINT "ExtractedFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProactiveNudge" ADD CONSTRAINT "ProactiveNudge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

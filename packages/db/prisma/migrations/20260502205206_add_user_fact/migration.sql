-- CreateEnum
CREATE TYPE "UserFactSource" AS ENUM ('conversation', 'profile', 'import', 'manual');

-- CreateTable
CREATE TABLE "UserFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "factValue" JSONB NOT NULL,
    "confidence" INTEGER,
    "source" "UserFactSource" NOT NULL DEFAULT 'conversation',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserFact_userId_source_idx" ON "UserFact"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "UserFact_userId_factKey_key" ON "UserFact"("userId", "factKey");

-- AddForeignKey
ALTER TABLE "UserFact" ADD CONSTRAINT "UserFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

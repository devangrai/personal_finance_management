-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SignupInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "intendedEmail" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignupInvite_code_key" ON "SignupInvite"("code");

-- CreateIndex
CREATE INDEX "SignupInvite_expiresAt_usedAt_idx" ON "SignupInvite"("expiresAt", "usedAt");

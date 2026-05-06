-- CreateEnum
CREATE TYPE "UserDocumentStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "ExtractedFact" ADD COLUMN     "page" INTEGER,
ADD COLUMN     "sourceRegion" JSONB,
ADD COLUMN     "userDocumentId" TEXT;

-- CreateTable
CREATE TABLE "UserDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "storageKey" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'other',
    "status" "UserDocumentStatus" NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "UserDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserDocument_storageKey_key" ON "UserDocument"("storageKey");

-- CreateIndex
CREATE INDEX "UserDocument_userId_status_idx" ON "UserDocument"("userId", "status");

-- CreateIndex
CREATE INDEX "UserDocument_userId_uploadedAt_idx" ON "UserDocument"("userId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ExtractedFact_userDocumentId_status_idx" ON "ExtractedFact"("userDocumentId", "status");

-- AddForeignKey
ALTER TABLE "ExtractedFact" ADD CONSTRAINT "ExtractedFact_userDocumentId_fkey" FOREIGN KEY ("userDocumentId") REFERENCES "UserDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDocument" ADD CONSTRAINT "UserDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

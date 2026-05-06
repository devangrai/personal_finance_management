-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "excludeFromNetWorth" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ManualInvestmentAccount" ADD COLUMN     "excludeFromNetWorth" BOOLEAN NOT NULL DEFAULT false;

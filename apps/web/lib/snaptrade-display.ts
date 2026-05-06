import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

/**
 * Minimal shape the Overview "Accounts" section needs. Mirrors the Plaid
 * account shape so both can be merged in a single list.
 */
export type DisplayAccount = {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: string | null;
  isoCurrencyCode: string | null;
  institutionName: string | null;
  lastSyncedAt: string | null;
};

/**
 * Return ManualInvestmentAccounts with source="snaptrade" in the shape
 * the AccountsList component expects. We read the aggregate-value
 * holding snapshot (the one we write with rowFingerprint "account-total-*")
 * to display a current balance.
 */
export async function listSnapTradeAccountsForOverview(): Promise<DisplayAccount[]> {
  const userId = await getDefaultUserId();
  const accounts = await prisma.manualInvestmentAccount.findMany({
    where: { userId, source: "snaptrade" },
    include: {
      snapTradeConnection: {
        select: {
          brokerageName: true,
          lastSyncedAt: true,
          status: true
        }
      },
      holdingSnapshots: {
        orderBy: { asOf: "desc" },
        where: { rowFingerprint: { startsWith: "account-total-" } },
        take: 1
      }
    }
  });

  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    officialName: null,
    mask: null,
    type: "investment",
    subtype: a.subtype ?? a.bucket,
    currentBalance:
      a.holdingSnapshots[0]?.institutionValue !== undefined &&
      a.holdingSnapshots[0]?.institutionValue !== null
        ? String(a.holdingSnapshots[0].institutionValue)
        : null,
    isoCurrencyCode: a.isoCurrencyCode ?? "USD",
    institutionName: a.snapTradeConnection?.brokerageName ?? "SnapTrade",
    lastSyncedAt:
      a.snapTradeConnection?.lastSyncedAt?.toISOString() ??
      a.lastImportedAt?.toISOString() ??
      null
  }));
}

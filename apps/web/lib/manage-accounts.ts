import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";
import type {
  ManagedAccount,
  ManagedConnection
} from "@/components/overview/manage-accounts-section";

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

/**
 * Build the data the Manage-Accounts section needs: every account + every
 * connection (Plaid item or SnapTrade authorization), with a duplicate
 * flag applied to any connection sharing an institution name with
 * another active connection.
 */
export async function buildManageAccountsData(): Promise<{
  accounts: ManagedAccount[];
  connections: ManagedConnection[];
}> {
  const userId = await getDefaultUserId();

  const [plaidItems, plaidAccounts, snaptradeConnections, manualAccounts] =
    await Promise.all([
      prisma.plaidItem.findMany({
        where: { userId },
        select: {
          id: true,
          institutionName: true,
          status: true,
          accounts: { select: { id: true, isActive: true } }
        }
      }),
      prisma.account.findMany({
        where: { userId, isActive: true },
        select: {
          id: true,
          name: true,
          currentBalance: true,
          excludeFromNetWorth: true,
          plaidItemId: true,
          plaidItem: { select: { institutionName: true, id: true } }
        }
      }),
      prisma.snapTradeConnection.findMany({
        where: { userId },
        select: {
          id: true,
          brokerageName: true,
          status: true,
          accounts: { select: { id: true } }
        }
      }),
      prisma.manualInvestmentAccount.findMany({
        where: { userId },
        select: {
          id: true,
          name: true,
          source: true,
          excludeFromNetWorth: true,
          snapTradeConnectionId: true,
          snapTradeConnection: {
            select: { id: true, brokerageName: true }
          },
          holdingSnapshots: {
            where: { rowFingerprint: { startsWith: "account-total-" } },
            orderBy: { asOf: "desc" },
            take: 1,
            select: { institutionValue: true }
          }
        }
      })
    ]);

  // Connections — group by institution name to find duplicates.
  const institutionCounts = new Map<string, number>();
  const bumpInst = (name: string) =>
    institutionCounts.set(name, (institutionCounts.get(name) ?? 0) + 1);

  for (const p of plaidItems) {
    if (p.institutionName) bumpInst(p.institutionName);
  }
  for (const s of snaptradeConnections) {
    if (s.brokerageName) bumpInst(s.brokerageName);
  }

  const connections: ManagedConnection[] = [];
  for (const p of plaidItems) {
    const instName = p.institutionName ?? "Unknown institution";
    connections.push({
      id: p.id,
      label: instName,
      institutionName: instName,
      source: "plaid",
      accountCount: p.accounts.filter((a) => a.isActive).length,
      status: p.status,
      isDuplicate: (institutionCounts.get(instName) ?? 0) > 1
    });
  }
  for (const s of snaptradeConnections) {
    const instName = s.brokerageName ?? "Unknown brokerage";
    connections.push({
      id: s.id,
      label: instName,
      institutionName: instName,
      source: "snaptrade",
      accountCount: s.accounts.length,
      status: s.status,
      isDuplicate: (institutionCounts.get(instName) ?? 0) > 1
    });
  }

  // Accounts
  const accounts: ManagedAccount[] = [];
  for (const a of plaidAccounts) {
    accounts.push({
      id: a.id,
      name: a.name,
      institutionName: a.plaidItem?.institutionName ?? null,
      balance: a.currentBalance ? fmtUsd(Number(a.currentBalance)) : null,
      source: "plaid",
      excludeFromNetWorth: a.excludeFromNetWorth,
      connectionId: a.plaidItemId,
      connectionLabel: a.plaidItem?.institutionName ?? "Plaid"
    });
  }
  for (const m of manualAccounts) {
    const bal = m.holdingSnapshots[0]?.institutionValue;
    accounts.push({
      id: m.id,
      name: m.name,
      institutionName:
        m.source === "snaptrade"
          ? (m.snapTradeConnection?.brokerageName ?? "SnapTrade")
          : "Manual / CSV",
      balance: bal !== undefined && bal !== null ? fmtUsd(Number(bal)) : null,
      source:
        m.source === "snaptrade"
          ? ("snaptrade" as const)
          : ("manual" as const),
      excludeFromNetWorth: m.excludeFromNetWorth,
      connectionId: m.snapTradeConnectionId,
      connectionLabel:
        m.snapTradeConnection?.brokerageName ?? m.source ?? "Manual"
    });
  }

  return { accounts, connections };
}

import { NetWorthCard, WeekSummaryCard } from "@/components/overview/headline-cards";
import { AccountsList } from "@/components/overview/accounts-list";
import { RecentTransactions } from "@/components/overview/recent-transactions";
import { ManageAccountsSection } from "@/components/overview/manage-accounts-section";
import { listLinkedAccounts } from "@/lib/accounts";
import { listRecentTransactions } from "@/lib/transactions";
import { listCategories } from "@/lib/categories";
import { listSnapTradeAccountsForOverview } from "@/lib/snaptrade-display";
import { buildManageAccountsData } from "@/lib/manage-accounts";
import { computeOverviewSnapshot } from "@/lib/overview-snapshot";

export const metadata = { title: "Overview · PFM" };
export const dynamic = "force-dynamic";

type SnapshotResponse = {
  netWorth: number;
  bankAssets: number;
  liabilities: number;
  investmentBalance: number;
  accountCount: number;
  week: {
    income: number;
    spent: number;
    net: number;
    source: string | null;
  };
  needsReviewCount: number;
};

async function fetchSnapshot(): Promise<SnapshotResponse> {
  // Direct function call — avoids the "fetch my own API route" pattern
  // which doesn't forward session cookies from server components and
  // was also an unnecessary HTTP hop.
  try {
    return await computeOverviewSnapshot();
  } catch {
    return {
      netWorth: 0,
      bankAssets: 0,
      liabilities: 0,
      investmentBalance: 0,
      accountCount: 0,
      week: { income: 0, spent: 0, net: 0, source: null },
      needsReviewCount: 0
    };
  }
}

export default async function OverviewPage() {
  const [snapshot, accountsData, txns, categories, snapTradeAccounts, manageData] = await Promise.all([
    fetchSnapshot(),
    listLinkedAccounts(),
    listRecentTransactions({ limit: 20 }),
    listCategories(),
    listSnapTradeAccountsForOverview().catch(() => []),
    buildManageAccountsData().catch(() => ({ accounts: [], connections: [] }))
  ]);

  const plaidAccountRows = accountsData.accounts.map((a) => ({
    id: a.id,
    name: a.name,
    officialName: a.officialName,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currentBalance:
      a.currentBalance !== null && a.currentBalance !== undefined
        ? String(a.currentBalance)
        : null,
    isoCurrencyCode: a.isoCurrencyCode,
    institutionName: a.plaidItem?.institutionName ?? null,
    lastSyncedAt: a.plaidItem?.lastSyncedAt
      ? a.plaidItem.lastSyncedAt.toISOString()
      : null
  }));

  const accountRows = [...plaidAccountRows, ...snapTradeAccounts];

  const txnRows = txns.map((t) => ({
    id: t.id,
    date: t.date.toISOString(),
    name: t.name,
    merchantName: t.merchantName,
    amount: String(t.amount),
    direction: t.direction as "outflow" | "inflow",
    isPending: t.isPending,
    reviewStatus: t.reviewStatus as string,
    aiSuggestedConfidence: t.aiSuggestedConfidence,
    aiSuggestedReason: t.aiSuggestedReason,
    category: t.category,
    aiSuggestedCategory: t.aiSuggestedCategory,
    account: {
      id: t.account.id,
      name: t.account.name,
      mask: t.account.mask,
      type: t.account.type,
      subtype: t.account.subtype
    }
  }));

  return (
    <>
      <div className="headlineGrid">
        <NetWorthCard
          netWorth={snapshot.netWorth}
          bankAssets={snapshot.bankAssets}
          investmentBalance={snapshot.investmentBalance}
          liabilities={snapshot.liabilities}
          accountCount={snapshot.accountCount}
        />
        <WeekSummaryCard
          income={snapshot.week.income}
          spent={snapshot.week.spent}
          net={snapshot.week.net}
          source={snapshot.week.source}
        />
      </div>
      <AccountsList accounts={accountRows} />
      <ManageAccountsSection
        accounts={manageData.accounts}
        connections={manageData.connections}
      />
      <RecentTransactions
        transactions={txnRows}
        categories={categories.map((c) => ({
          id: c.id,
          key: c.key,
          label: c.label
        }))}
      />
    </>
  );
}

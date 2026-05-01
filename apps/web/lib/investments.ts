import { prisma } from "@portfolio/db";
import { getAppEnv } from "./env";

type InvestmentBucket = "retirement" | "taxable" | "other";
type InvestmentDataSource = "plaid" | "manual";

type InvestmentAccountSummary = {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  subtype: string | null;
  currentBalance: string;
  institutionName: string | null;
  bucket: InvestmentBucket;
  holdingCount: number;
  lastHoldingsAsOf: string | null;
  source: InvestmentDataSource;
};

type InvestmentHoldingSummary = {
  accountId: string;
  accountName: string;
  institutionName: string | null;
  securityName: string;
  symbol: string | null;
  institutionValue: string;
  quantity: string | null;
  asOf: string;
  source: InvestmentDataSource;
};

type InvestmentTransactionSummary = {
  id: string;
  date: string;
  name: string;
  type: string;
  subtype: string | null;
  amount: string;
  quantity: string | null;
  price: string | null;
  symbol: string | null;
  accountName: string;
  accountSubtype: string | null;
  institutionName: string | null;
  source: InvestmentDataSource;
};

function centsToDollarsString(value: number) {
  return (value / 100).toFixed(2);
}

function decimalStringToCents(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  return Math.round(Number(value) * 100);
}

function classifyInvestmentBucket(input: {
  subtype: string | null;
  name: string;
  officialName: string | null;
}): InvestmentBucket {
  const combined = `${input.subtype ?? ""} ${input.name} ${input.officialName ?? ""}`
    .trim()
    .toLowerCase();

  if (
    /\b(401k|401\(k\)|403b|403\(b\)|457|ira|roth|sep|simple|pension|retirement|brokeragelink)\b/.test(
      combined
    )
  ) {
    return "retirement";
  }

  if (
    /\b(brokerage|individual|taxable|investment|stock plan|annuity)\b/.test(
      combined
    )
  ) {
    return "taxable";
  }

  return "other";
}

export async function getInvestmentsSummary() {
  const { defaultUserEmail } = getAppEnv();

  const user = await prisma.user.findUnique({
    where: {
      email: defaultUserEmail
    },
    select: {
      id: true,
      accounts: {
        where: {
          isActive: true,
          type: "investment"
        },
        orderBy: [
          {
            plaidItem: {
              institutionName: "asc"
            }
          },
          {
            name: "asc"
          }
        ],
        select: {
          id: true,
          name: true,
          officialName: true,
          mask: true,
          subtype: true,
          currentBalance: true,
          plaidItem: {
            select: {
              institutionName: true
            }
          }
        }
      },
      manualInvestmentAccounts: {
        orderBy: [
          {
            source: "asc"
          },
          {
            name: "asc"
          }
        ],
        select: {
          id: true,
          name: true,
          subtype: true,
          bucket: true,
          source: true,
          isoCurrencyCode: true
        }
      }
    }
  });

  const plaidAccountIds = user?.accounts.map((account) => account.id) ?? [];
  const manualAccountIds = user?.manualInvestmentAccounts.map((account) => account.id) ?? [];

  const [
    recentPlaidInvestmentTransactions,
    plaidInvestmentTransactionCount,
    recentManualInvestmentTransactions,
    manualInvestmentTransactionCount,
    latestPlaidSnapshotsByAccount,
    latestManualSnapshotsByAccount
  ] = await Promise.all([
    plaidAccountIds.length
      ? prisma.investmentTransaction.findMany({
          where: {
            accountId: {
              in: plaidAccountIds
            }
          },
          orderBy: {
            date: "desc"
          },
          take: 24,
          select: {
            id: true,
            date: true,
            name: true,
            type: true,
            subtype: true,
            amount: true,
            quantity: true,
            price: true,
            symbol: true,
            account: {
              select: {
                name: true,
                subtype: true,
                plaidItem: {
                  select: {
                    institutionName: true
                  }
                }
              }
            }
          }
        })
      : [],
    plaidAccountIds.length
      ? prisma.investmentTransaction.count({
          where: {
            accountId: {
              in: plaidAccountIds
            }
          }
        })
      : 0,
    manualAccountIds.length
      ? prisma.manualInvestmentTransaction.findMany({
          where: {
            manualInvestmentAccountId: {
              in: manualAccountIds
            }
          },
          orderBy: {
            date: "desc"
          },
          take: 24,
          select: {
            id: true,
            date: true,
            name: true,
            type: true,
            subtype: true,
            amount: true,
            quantity: true,
            price: true,
            symbol: true,
            manualInvestmentAccount: {
              select: {
                name: true,
                subtype: true,
                source: true
              }
            }
          }
        })
      : [],
    manualAccountIds.length
      ? prisma.manualInvestmentTransaction.count({
          where: {
            manualInvestmentAccountId: {
              in: manualAccountIds
            }
          }
        })
      : 0,
    plaidAccountIds.length
      ? prisma.holdingSnapshot.findMany({
          where: {
            accountId: {
              in: plaidAccountIds
            }
          },
          orderBy: [
            {
              accountId: "asc"
            },
            {
              asOf: "desc"
            }
          ],
          distinct: ["accountId"],
          select: {
            accountId: true,
            asOf: true
          }
        })
      : [],
    manualAccountIds.length
      ? prisma.manualHoldingSnapshot.findMany({
          where: {
            manualInvestmentAccountId: {
              in: manualAccountIds
            }
          },
          orderBy: [
            {
              manualInvestmentAccountId: "asc"
            },
            {
              asOf: "desc"
            }
          ],
          distinct: ["manualInvestmentAccountId"],
          select: {
            manualInvestmentAccountId: true,
            asOf: true
          }
        })
      : []
  ]);

  const latestPlaidSnapshotClauses = latestPlaidSnapshotsByAccount.map((snapshot) => ({
    accountId: snapshot.accountId,
    asOf: snapshot.asOf
  }));

  const latestPlaidHoldings = latestPlaidSnapshotClauses.length
    ? await prisma.holdingSnapshot.findMany({
        where: {
          OR: latestPlaidSnapshotClauses
        },
        orderBy: {
          institutionValue: "desc"
        },
        select: {
          accountId: true,
          asOf: true,
          securityName: true,
          symbol: true,
          institutionValue: true,
          quantity: true,
          account: {
            select: {
              name: true,
              plaidItem: {
                select: {
                  institutionName: true
                }
              }
            }
          }
        }
      })
    : [];

  const latestManualSnapshotClauses = latestManualSnapshotsByAccount.map((snapshot) => ({
    manualInvestmentAccountId: snapshot.manualInvestmentAccountId,
    asOf: snapshot.asOf
  }));

  const latestManualHoldings = latestManualSnapshotClauses.length
    ? await prisma.manualHoldingSnapshot.findMany({
        where: {
          OR: latestManualSnapshotClauses
        },
        orderBy: {
          institutionValue: "desc"
        },
        select: {
          manualInvestmentAccountId: true,
          asOf: true,
          securityName: true,
          symbol: true,
          institutionValue: true,
          quantity: true,
          manualInvestmentAccount: {
            select: {
              name: true,
              source: true
            }
          }
        }
      })
    : [];

  const plaidHoldingsCountByAccount = new Map<string, number>();
  for (const holding of latestPlaidHoldings) {
    plaidHoldingsCountByAccount.set(
      holding.accountId,
      (plaidHoldingsCountByAccount.get(holding.accountId) ?? 0) + 1
    );
  }

  const manualHoldingsCountByAccount = new Map<string, number>();
  const manualBalanceByAccount = new Map<string, number>();
  for (const holding of latestManualHoldings) {
    manualHoldingsCountByAccount.set(
      holding.manualInvestmentAccountId,
      (manualHoldingsCountByAccount.get(holding.manualInvestmentAccountId) ?? 0) + 1
    );
    manualBalanceByAccount.set(
      holding.manualInvestmentAccountId,
      (manualBalanceByAccount.get(holding.manualInvestmentAccountId) ?? 0) +
        decimalStringToCents(holding.institutionValue?.toString())
    );
  }

  const latestPlaidSnapshotByAccount = new Map(
    latestPlaidSnapshotsByAccount.map((snapshot) => [snapshot.accountId, snapshot.asOf])
  );
  const latestManualSnapshotByAccount = new Map(
    latestManualSnapshotsByAccount.map((snapshot) => [
      snapshot.manualInvestmentAccountId,
      snapshot.asOf
    ])
  );
  const latestSnapshotAt =
    [...latestPlaidSnapshotsByAccount, ...latestManualSnapshotsByAccount].length > 0
      ? new Date(
          Math.max(
            ...[...latestPlaidSnapshotsByAccount, ...latestManualSnapshotsByAccount].map(
              (snapshot) => snapshot.asOf.getTime()
            )
          )
        ).toISOString()
      : null;

  const plaidAccounts: InvestmentAccountSummary[] =
    user?.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      officialName: account.officialName,
      mask: account.mask,
      subtype: account.subtype,
      currentBalance: account.currentBalance?.toString() ?? "0.00",
      institutionName: account.plaidItem.institutionName,
      bucket: classifyInvestmentBucket({
        subtype: account.subtype,
        name: account.name,
        officialName: account.officialName
      }),
      holdingCount: plaidHoldingsCountByAccount.get(account.id) ?? 0,
      lastHoldingsAsOf:
        latestPlaidSnapshotByAccount.get(account.id)?.toISOString() ?? null,
      source: "plaid"
    })) ?? [];

  const manualAccounts: InvestmentAccountSummary[] =
    user?.manualInvestmentAccounts.map((account) => ({
      id: account.id,
      name: account.name,
      officialName: null,
      mask: null,
      subtype: account.subtype,
      currentBalance: centsToDollarsString(
        manualBalanceByAccount.get(account.id) ?? 0
      ),
      institutionName: "Fidelity (manual import)",
      bucket: account.bucket,
      holdingCount: manualHoldingsCountByAccount.get(account.id) ?? 0,
      lastHoldingsAsOf:
        latestManualSnapshotByAccount.get(account.id)?.toISOString() ?? null,
      source: "manual"
    })) ?? [];

  const accounts = [...plaidAccounts, ...manualAccounts];
  const totalBalanceCents = accounts.reduce(
    (sum, account) => sum + decimalStringToCents(account.currentBalance),
    0
  );
  const retirementBalanceCents = accounts
    .filter((account) => account.bucket === "retirement")
    .reduce((sum, account) => sum + decimalStringToCents(account.currentBalance), 0);
  const taxableBalanceCents = accounts
    .filter((account) => account.bucket === "taxable")
    .reduce((sum, account) => sum + decimalStringToCents(account.currentBalance), 0);

  const topHoldings: InvestmentHoldingSummary[] = [
    ...latestPlaidHoldings.map((holding) => ({
      accountId: holding.accountId,
      accountName: holding.account.name,
      institutionName: holding.account.plaidItem.institutionName,
      securityName: holding.securityName,
      symbol: holding.symbol,
      institutionValue: holding.institutionValue?.toString() ?? "0.00",
      quantity: holding.quantity?.toString() ?? null,
      asOf: holding.asOf.toISOString(),
      source: "plaid" as const
    })),
    ...latestManualHoldings.map((holding) => ({
      accountId: holding.manualInvestmentAccountId,
      accountName: holding.manualInvestmentAccount.name,
      institutionName: "Fidelity (manual import)",
      securityName: holding.securityName,
      symbol: holding.symbol,
      institutionValue: holding.institutionValue?.toString() ?? "0.00",
      quantity: holding.quantity?.toString() ?? null,
      asOf: holding.asOf.toISOString(),
      source: "manual" as const
    }))
  ]
    .sort(
      (left, right) =>
        decimalStringToCents(right.institutionValue) -
        decimalStringToCents(left.institutionValue)
    )
    .slice(0, 10);

  const recentTransactions: InvestmentTransactionSummary[] = [
    ...recentPlaidInvestmentTransactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date.toISOString(),
      name: transaction.name,
      type: transaction.type,
      subtype: transaction.subtype,
      amount: transaction.amount.toString(),
      quantity: transaction.quantity?.toString() ?? null,
      price: transaction.price?.toString() ?? null,
      symbol: transaction.symbol,
      accountName: transaction.account.name,
      accountSubtype: transaction.account.subtype,
      institutionName: transaction.account.plaidItem.institutionName,
      source: "plaid" as const
    })),
    ...recentManualInvestmentTransactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date.toISOString(),
      name: transaction.name,
      type: transaction.type,
      subtype: transaction.subtype,
      amount: transaction.amount.toString(),
      quantity: transaction.quantity?.toString() ?? null,
      price: transaction.price?.toString() ?? null,
      symbol: transaction.symbol,
      accountName: transaction.manualInvestmentAccount.name,
      accountSubtype: transaction.manualInvestmentAccount.subtype,
      institutionName: "Fidelity (manual import)",
      source: "manual" as const
    }))
  ]
    .sort(
      (left, right) =>
        new Date(right.date).getTime() - new Date(left.date).getTime()
    )
    .slice(0, 12);

  return {
    totals: {
      accountCount: accounts.length,
      holdingsCount: latestPlaidHoldings.length + latestManualHoldings.length,
      investmentTransactionCount:
        plaidInvestmentTransactionCount + manualInvestmentTransactionCount,
      totalBalance: centsToDollarsString(totalBalanceCents),
      retirementBalance: centsToDollarsString(retirementBalanceCents),
      taxableBalance: centsToDollarsString(taxableBalanceCents),
      latestSnapshotAt
    },
    accounts,
    topHoldings,
    recentTransactions
  };
}

import { prisma } from "@portfolio/db";
import { getAppEnv } from "./env";

type InvestmentBucket = "retirement" | "taxable" | "other";

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
      }
    }
  });

  const accountIds = user?.accounts.map((account) => account.id) ?? [];
  const [recentInvestmentTransactions, investmentTransactionCount] = accountIds.length
    ? await Promise.all([
        prisma.investmentTransaction.findMany({
          where: {
            accountId: {
              in: accountIds
            }
          },
          orderBy: {
            date: "desc"
          },
          take: 12,
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
        }),
        prisma.investmentTransaction.count({
          where: {
            accountId: {
              in: accountIds
            }
          }
        })
      ])
    : [[], 0];
  const latestSnapshotsByAccount = accountIds.length
    ? await prisma.holdingSnapshot.findMany({
        where: {
          accountId: {
            in: accountIds
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
    : [];

  const latestSnapshotClauses = latestSnapshotsByAccount.map((snapshot) => ({
    accountId: snapshot.accountId,
    asOf: snapshot.asOf
  }));

  const latestHoldings = latestSnapshotClauses.length
    ? await prisma.holdingSnapshot.findMany({
        where: {
          OR: latestSnapshotClauses
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

  const holdingsCountByAccount = new Map<string, number>();
  for (const holding of latestHoldings) {
    holdingsCountByAccount.set(
      holding.accountId,
      (holdingsCountByAccount.get(holding.accountId) ?? 0) + 1
    );
  }

  const latestSnapshotByAccount = new Map(
    latestSnapshotsByAccount.map((snapshot) => [snapshot.accountId, snapshot.asOf])
  );
  const latestSnapshotAt =
    latestSnapshotsByAccount.length > 0
      ? new Date(
          Math.max(
            ...latestSnapshotsByAccount.map((snapshot) => snapshot.asOf.getTime())
          )
        ).toISOString()
      : null;

  const accounts =
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
      holdingCount: holdingsCountByAccount.get(account.id) ?? 0,
      lastHoldingsAsOf:
        latestSnapshotByAccount.get(account.id)?.toISOString() ?? null
    })) ?? [];

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

  return {
    totals: {
      accountCount: accounts.length,
      holdingsCount: latestHoldings.length,
      investmentTransactionCount,
      totalBalance: centsToDollarsString(totalBalanceCents),
      retirementBalance: centsToDollarsString(retirementBalanceCents),
      taxableBalance: centsToDollarsString(taxableBalanceCents),
      latestSnapshotAt
    },
    accounts,
    topHoldings: latestHoldings.slice(0, 10).map((holding) => ({
      accountId: holding.accountId,
      accountName: holding.account.name,
      institutionName: holding.account.plaidItem.institutionName,
      securityName: holding.securityName,
      symbol: holding.symbol,
      institutionValue: holding.institutionValue?.toString() ?? "0.00",
      quantity: holding.quantity?.toString() ?? null,
      asOf: holding.asOf.toISOString()
    })),
    recentTransactions: recentInvestmentTransactions.map((transaction) => ({
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
        institutionName: transaction.account.plaidItem.institutionName
      }))
  };
}

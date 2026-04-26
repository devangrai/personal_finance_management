import { prisma } from "@portfolio/db";
import { getAppEnv } from "./env";

export async function listRecentTransactions(limit = 50) {
  const { defaultUserEmail } = getAppEnv();

  const user = await prisma.user.findUnique({
    where: {
      email: defaultUserEmail
    },
    select: {
      id: true
    }
  });

  if (!user) {
    return [];
  }

  return prisma.transaction.findMany({
    where: {
      userId: user.id
    },
    orderBy: [
      {
        date: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    take: limit,
    select: {
      id: true,
      plaidTransactionId: true,
      date: true,
      authorizedDate: true,
      name: true,
      merchantName: true,
      amount: true,
      direction: true,
      isPending: true,
      personalFinanceCategory: true,
      reviewStatus: true,
      account: {
        select: {
          id: true,
          name: true,
          mask: true,
          type: true,
          subtype: true,
          plaidItem: {
            select: {
              institutionName: true
            }
          }
        }
      }
    }
  });
}

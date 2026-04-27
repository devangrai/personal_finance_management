import { prisma } from "@portfolio/db";
import { ensureDefaultCategories, getDefaultUserId } from "./categories";
import { getAppEnv } from "./env";

export async function listRecentTransactions(limit = 50) {
  const userId = await getDefaultUserId();
  await ensureDefaultCategories(userId);

  return prisma.transaction.findMany({
    where: {
      userId
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
      category: {
        select: {
          id: true,
          key: true,
          label: true
        }
      },
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

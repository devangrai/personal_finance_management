import { prisma } from "@portfolio/db";
import { ensureDefaultCategories, getDefaultUserId } from "./categories";

type ListRecentTransactionsOptions = {
  limit?: number;
  localDateKey?: string | null;
};

function buildUtcDateRange(localDateKey: string) {
  const start = new Date(`${localDateKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    gte: start,
    lt: end
  };
}

export async function listRecentTransactions(
  options: ListRecentTransactionsOptions = {}
) {
  const userId = await getDefaultUserId();
  await ensureDefaultCategories(userId);
  const limit = options.limit ?? 50;

  return prisma.transaction.findMany({
    where: {
      userId,
      ...(options.localDateKey
        ? {
            date: buildUtcDateRange(options.localDateKey)
          }
        : {})
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
      aiSuggestedConfidence: true,
      aiSuggestedReason: true,
      aiSuggestedByModel: true,
      aiSuggestedAt: true,
      category: {
        select: {
          id: true,
          key: true,
          label: true
        }
      },
      aiSuggestedCategory: {
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

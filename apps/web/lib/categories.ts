import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { getOrCreateDefaultUser } from "./user";

type CategorySeed = {
  key: string;
  label: string;
  parentKey?: string;
};

const defaultCategorySeeds: CategorySeed[] = [
  { key: "income", label: "Income" },
  { key: "paycheck", label: "Paycheck", parentKey: "income" },
  { key: "transfer", label: "Transfer" },
  { key: "investing", label: "Investing" },
  { key: "retirement_contribution", label: "Retirement Contribution", parentKey: "investing" },
  { key: "housing", label: "Housing" },
  { key: "rent", label: "Rent", parentKey: "housing" },
  { key: "utilities", label: "Utilities" },
  { key: "groceries", label: "Groceries" },
  { key: "dining", label: "Dining" },
  { key: "transportation", label: "Transportation" },
  { key: "travel", label: "Travel" },
  { key: "shopping", label: "Shopping" },
  { key: "healthcare", label: "Healthcare" },
  { key: "insurance", label: "Insurance" },
  { key: "subscription", label: "Subscription" },
  { key: "entertainment", label: "Entertainment" },
  { key: "fees", label: "Fees" },
  { key: "tax", label: "Tax" },
  { key: "charity", label: "Charity" },
  { key: "education", label: "Education" },
  { key: "gifts", label: "Gifts" },
  { key: "uncategorized", label: "Uncategorized" }
];

export async function getDefaultUserId() {
  const user = await getOrCreateDefaultUser();
  return user.id;
}

export async function ensureDefaultCategories(userId: string) {
  await Promise.all(
    defaultCategorySeeds.map((category) =>
      prisma.transactionCategory.upsert({
        where: {
          userId_key: {
            userId,
            key: category.key
          }
        },
        update: {
          label: category.label,
          parentKey: category.parentKey ?? null,
          isSystem: true
        },
        create: {
          userId,
          key: category.key,
          label: category.label,
          parentKey: category.parentKey ?? null,
          isSystem: true
        }
      })
    )
  );
}

export async function listCategories() {
  const userId = await getDefaultUserId();
  await ensureDefaultCategories(userId);

  return prisma.transactionCategory.findMany({
    where: {
      userId
    },
    orderBy: [
      {
        parentKey: "asc"
      },
      {
        label: "asc"
      }
    ],
    select: {
      id: true,
      key: true,
      label: true,
      parentKey: true,
      isSystem: true
    }
  });
}

export async function updateTransactionCategory(input: {
  transactionId: string;
  categoryId: string | null;
}) {
  const userId = await getDefaultUserId();

  const transaction = await prisma.transaction.findFirst({
    where: {
      id: input.transactionId,
      userId
    },
    select: {
      id: true
    }
  });

  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  if (input.categoryId) {
    const category = await prisma.transactionCategory.findFirst({
      where: {
        id: input.categoryId,
        userId
      },
      select: {
        id: true
      }
    });

    if (!category) {
      throw new Error("Category not found.");
    }
  }

  return prisma.transaction.update({
    where: {
      id: input.transactionId
    },
    data: {
      categoryId: input.categoryId,
      reviewStatus: input.categoryId
        ? TransactionReviewStatus.user_categorized
        : TransactionReviewStatus.uncategorized
    },
    select: {
      id: true,
      categoryId: true,
      reviewStatus: true
    }
  });
}

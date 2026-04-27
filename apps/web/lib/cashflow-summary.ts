import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { ensureDefaultCategories, getDefaultUserId } from "./categories";

type SummaryCategory = {
  amountCents: number;
  key: string;
  label: string;
};

type MonthlyAccumulator = {
  incomeCents: number;
  netCashflowCents: number;
  reviewedTransactionCount: number;
  spendingByCategory: Map<string, SummaryCategory>;
  spendingCents: number;
  transferCents: number;
  uncategorizedOutflowCents: number;
  uncategorizedTransactionCount: number;
};

function formatMonthKey(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthStartOffset(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function createEmptyAccumulator(): MonthlyAccumulator {
  return {
    incomeCents: 0,
    netCashflowCents: 0,
    reviewedTransactionCount: 0,
    spendingByCategory: new Map(),
    spendingCents: 0,
    transferCents: 0,
    uncategorizedOutflowCents: 0,
    uncategorizedTransactionCount: 0
  };
}

function decimalToCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

function addToSpendingCategory(
  accumulator: MonthlyAccumulator,
  key: string,
  label: string,
  amountCents: number
) {
  const current = accumulator.spendingByCategory.get(key);
  if (current) {
    current.amountCents += amountCents;
    return;
  }

  accumulator.spendingByCategory.set(key, {
    key,
    label,
    amountCents
  });
}

export async function getCashflowSummary(months = 6) {
  const userId = await getDefaultUserId();
  await ensureDefaultCategories(userId);

  const boundedMonths = Math.min(Math.max(months, 1), 12);
  const startDate = getMonthStartOffset(boundedMonths - 1);
  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: {
        gte: startDate
      },
      reviewStatus: {
        not: TransactionReviewStatus.ignored
      }
    },
    orderBy: [
      {
        date: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    select: {
      id: true,
      amount: true,
      date: true,
      direction: true,
      reviewStatus: true,
      category: {
        select: {
          key: true,
          label: true,
          parentKey: true
        }
      }
    }
  });

  const categoryLabels = await prisma.transactionCategory.findMany({
    where: {
      userId
    },
    select: {
      key: true,
      label: true
    }
  });
  const categoryLabelByKey = new Map(
    categoryLabels.map((category) => [category.key, category.label])
  );

  const summaryByMonth = new Map<string, MonthlyAccumulator>();

  for (const transaction of transactions) {
    const monthKey = formatMonthKey(transaction.date);
    const accumulator =
      summaryByMonth.get(monthKey) ?? createEmptyAccumulator();
    summaryByMonth.set(monthKey, accumulator);

    const amountCents = decimalToCents(transaction.amount);
    const signedCents =
      transaction.direction === "credit" ? amountCents : -amountCents;

    if (
      transaction.reviewStatus === TransactionReviewStatus.uncategorized ||
      !transaction.category
    ) {
      if (transaction.direction === "debit") {
        accumulator.uncategorizedOutflowCents += amountCents;
      }
      accumulator.uncategorizedTransactionCount += 1;
      continue;
    }

    accumulator.reviewedTransactionCount += 1;

    const topLevelKey = transaction.category.parentKey ?? transaction.category.key;
    const topLevelLabel =
      categoryLabelByKey.get(topLevelKey) ?? transaction.category.label;

    if (topLevelKey === "income") {
      accumulator.incomeCents += signedCents;
      accumulator.netCashflowCents += signedCents;
      continue;
    }

    if (topLevelKey === "transfer") {
      accumulator.transferCents += amountCents;
      continue;
    }

    if (transaction.direction === "debit") {
      accumulator.spendingCents += amountCents;
      addToSpendingCategory(
        accumulator,
        topLevelKey,
        topLevelLabel,
        amountCents
      );
    } else {
      accumulator.spendingCents -= amountCents;
      addToSpendingCategory(
        accumulator,
        topLevelKey,
        topLevelLabel,
        -amountCents
      );
    }

    accumulator.netCashflowCents += signedCents;
  }

  const monthsPayload = [...summaryByMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([monthKey, accumulator]) => {
      const topCategories = [...accumulator.spendingByCategory.values()]
        .filter((category) => category.amountCents > 0)
        .sort((left, right) => right.amountCents - left.amountCents)
        .slice(0, 4)
        .map((category) => ({
          key: category.key,
          label: category.label,
          amount: (category.amountCents / 100).toFixed(2),
          shareBps:
            accumulator.spendingCents > 0
              ? Math.round((category.amountCents / accumulator.spendingCents) * 10000)
              : 0
        }));

      const reviewedSpendRatioBps =
        accumulator.spendingCents + accumulator.uncategorizedOutflowCents > 0
          ? Math.round(
              (accumulator.spendingCents /
                (accumulator.spendingCents + accumulator.uncategorizedOutflowCents)) *
                10000
            )
          : 0;

      return {
        month: monthKey,
        label: formatMonthLabel(monthKey),
        income: (accumulator.incomeCents / 100).toFixed(2),
        spending: (accumulator.spendingCents / 100).toFixed(2),
        transfers: (accumulator.transferCents / 100).toFixed(2),
        netCashflow: (accumulator.netCashflowCents / 100).toFixed(2),
        uncategorizedOutflow: (accumulator.uncategorizedOutflowCents / 100).toFixed(2),
        reviewedTransactionCount: accumulator.reviewedTransactionCount,
        uncategorizedTransactionCount: accumulator.uncategorizedTransactionCount,
        reviewedSpendRatioBps,
        topCategories
      };
    });

  const latestMonth = monthsPayload[0] ?? null;

  return {
    months: monthsPayload,
    latestMonth
  };
}

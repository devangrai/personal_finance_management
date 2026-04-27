import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

type Frequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "unknown";

type FrequencyProfile = {
  cadenceDays: number;
  toleranceDays: number;
  value: Frequency;
};

type RecurringGroupTransaction = {
  amount: number;
  categoryLabel: string | null;
  date: Date;
  direction: "credit" | "debit";
  displayName: string;
  reviewStatus: TransactionReviewStatus;
};

const frequencyProfiles: FrequencyProfile[] = [
  { value: "weekly", cadenceDays: 7, toleranceDays: 2 },
  { value: "biweekly", cadenceDays: 14, toleranceDays: 3 },
  { value: "monthly", cadenceDays: 30, toleranceDays: 5 },
  { value: "quarterly", cadenceDays: 91, toleranceDays: 10 }
];

function differenceInDays(left: Date, right: Date) {
  return Math.round(
    (left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;

  return Math.sqrt(variance);
}

function normalizeName(value: string) {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function detectFrequency(intervals: number[]) {
  if (intervals.length === 0) {
    return {
      cadenceDays: 0,
      frequency: "unknown" as const,
      intervalScore: 0
    };
  }

  const averageInterval = mean(intervals);
  const matchingProfile =
    frequencyProfiles.find(
      (profile) =>
        Math.abs(profile.cadenceDays - averageInterval) <= profile.toleranceDays
    ) ?? null;

  if (!matchingProfile) {
    return {
      cadenceDays: Math.round(averageInterval),
      frequency: "unknown" as const,
      intervalScore: 0
    };
  }

  const matchingIntervals = intervals.filter(
    (interval) =>
      Math.abs(interval - matchingProfile.cadenceDays) <= matchingProfile.toleranceDays
  ).length;

  return {
    cadenceDays: matchingProfile.cadenceDays,
    frequency: matchingProfile.value,
    intervalScore: matchingIntervals / intervals.length
  };
}

function getNextExpectedDate(lastDate: Date, cadenceDays: number) {
  if (!cadenceDays) {
    return null;
  }

  return new Date(lastDate.getTime() + cadenceDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function getRecurringSummary() {
  const userId = await getDefaultUserId();
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 180);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      isPending: false,
      reviewStatus: {
        not: TransactionReviewStatus.ignored
      },
      date: {
        gte: startDate
      }
    },
    orderBy: {
      date: "desc"
    },
    select: {
      amount: true,
      date: true,
      direction: true,
      merchantName: true,
      name: true,
      reviewStatus: true,
      category: {
        select: {
          label: true
        }
      }
    }
  });

  const groupedTransactions = new Map<string, RecurringGroupTransaction[]>();

  for (const transaction of transactions) {
    const displayName = transaction.merchantName ?? transaction.name;
    const groupKey = `${transaction.direction}:${normalizeName(displayName)}`;
    const bucket = groupedTransactions.get(groupKey) ?? [];
    bucket.push({
      amount: Number(transaction.amount),
      categoryLabel: transaction.category?.label ?? null,
      date: transaction.date,
      direction: transaction.direction,
      displayName,
      reviewStatus: transaction.reviewStatus
    });
    groupedTransactions.set(groupKey, bucket);
  }

  const candidates = [...groupedTransactions.values()]
    .map((group) => {
      const orderedGroup = [...group].sort(
        (left, right) => left.date.getTime() - right.date.getTime()
      );
      if (orderedGroup.length < 3) {
        return null;
      }

      const intervals = orderedGroup
        .slice(1)
        .map((transaction, index) =>
          differenceInDays(transaction.date, orderedGroup[index].date)
        );
      const frequencyDetection = detectFrequency(intervals);
      if (frequencyDetection.frequency === "unknown") {
        return null;
      }

      const amounts = orderedGroup.map((transaction) => transaction.amount);
      const averageAmount = mean(amounts);
      const amountDeviation = standardDeviation(amounts);
      const amountScore =
        averageAmount === 0
          ? 1
          : Math.max(0, 1 - amountDeviation / averageAmount);
      const countScore = Math.min(orderedGroup.length / 6, 1);
      const confidence =
        frequencyDetection.intervalScore * 0.5 +
        amountScore * 0.35 +
        countScore * 0.15;

      if (confidence < 0.68) {
        return null;
      }

      const latest = orderedGroup[orderedGroup.length - 1];

      return {
        averageAmount: averageAmount.toFixed(2),
        categoryLabel:
          [...orderedGroup]
            .reverse()
            .find((transaction) => transaction.categoryLabel)?.categoryLabel ?? null,
        confidenceScore: Number(confidence.toFixed(2)),
        direction: latest.direction,
        displayName: latest.displayName,
        frequency: frequencyDetection.frequency,
        latestAmount: latest.amount.toFixed(2),
        lastDate: latest.date.toISOString().slice(0, 10),
        nextExpectedDate: getNextExpectedDate(
          latest.date,
          frequencyDetection.cadenceDays
        ),
        occurrenceCount: orderedGroup.length,
        reviewState:
          [...orderedGroup]
            .reverse()
            .find(
              (transaction) =>
                transaction.reviewStatus === TransactionReviewStatus.user_categorized ||
                transaction.reviewStatus === TransactionReviewStatus.auto_categorized
            )?.reviewStatus ?? TransactionReviewStatus.uncategorized
      };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => right.confidenceScore - left.confidenceScore);

  return {
    inflows: candidates.filter((candidate) => candidate.direction === "credit"),
    outflows: candidates.filter((candidate) => candidate.direction === "debit")
  };
}

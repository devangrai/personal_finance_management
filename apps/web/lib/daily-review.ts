import {
  DailyReviewDigestStatus,
  TransactionReviewStatus,
  prisma
} from "@portfolio/db";
import { autoCategorizeTransactions } from "./ai-categorization";
import { getAppEnv } from "./env";
import { getOrCreateDefaultUser } from "./user";

type RunDailyReviewCycleInput = {
  force?: boolean;
  sendPing?: boolean;
};

type RunDailyReviewCycleResult = {
  localDateKey: string;
  timezone: string;
  scheduledHourLocal: number;
  status: "skipped" | "created" | "updated";
  digest: {
    id: string;
    localDateKey: string;
    timezone: string;
    scheduledHourLocal: number;
    transactionCount: number;
    autoCategorizedCount: number;
    uncategorizedCount: number;
    reviewUrl: string | null;
    status: string;
    sentAt: string | null;
    acknowledgedAt: string | null;
    lastError: string | null;
  } | null;
  categorization: {
    attemptedCount: number;
    categorizedCount: number;
    leftUncategorizedCount: number;
    model: string | null;
  } | null;
};

function formatLocalDateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function getLocalHour(date: Date, timeZone: string) {
  return Number.parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false
    }).format(date),
    10
  );
}

async function listTransactionsForLocalDate(userId: string, localDateKey: string, timeZone: string) {
  const recentTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      date: {
        gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5)
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
      reviewStatus: true,
      aiSuggestedAt: true,
      date: true
    }
  });

  return recentTransactions.filter(
    (transaction) => formatLocalDateKey(transaction.date, timeZone) === localDateKey
  );
}

async function sendDailyReviewPing(input: {
  localDateKey: string;
  reviewUrl: string;
  transactionCount: number;
  autoCategorizedCount: number;
  uncategorizedCount: number;
}) {
  const env = getAppEnv();
  if (!env.dailyReviewWebhookUrl) {
    return {
      delivered: false,
      error: null as string | null
    };
  }

  try {
    const response = await fetch(env.dailyReviewWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.dailyReviewWebhookBearerToken
          ? {
              Authorization: `Bearer ${env.dailyReviewWebhookBearerToken}`
            }
          : {})
      },
      body: JSON.stringify({
        title: `Daily transaction review for ${input.localDateKey}`,
        message:
          `${input.transactionCount} transaction(s) need a look. ` +
          `${input.autoCategorizedCount} were AI-categorized and ` +
          `${input.uncategorizedCount} still need a manual category.`,
        reviewUrl: input.reviewUrl,
        date: input.localDateKey
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Webhook returned a non-200 response.");
    }

    return {
      delivered: true,
      error: null as string | null
    };
  } catch (error) {
    return {
      delivered: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to deliver the daily review ping."
    };
  }
}

function serializeDigest(
  digest: {
    id: string;
    localDateKey: string;
    timezone: string;
    scheduledHourLocal: number;
    transactionCount: number;
    autoCategorizedCount: number;
    uncategorizedCount: number;
    reviewUrl: string | null;
    status: DailyReviewDigestStatus;
    sentAt: Date | null;
    acknowledgedAt: Date | null;
    lastError: string | null;
  } | null
) {
  if (!digest) {
    return null;
  }

  return {
    ...digest,
    sentAt: digest.sentAt?.toISOString() ?? null,
    acknowledgedAt: digest.acknowledgedAt?.toISOString() ?? null
  };
}

export async function getLatestDailyReviewDigest() {
  const user = await getOrCreateDefaultUser();
  const digest = await prisma.dailyReviewDigest.findFirst({
    where: {
      userId: user.id
    },
    orderBy: {
      createdAt: "desc"
    },
    select: {
      id: true,
      localDateKey: true,
      timezone: true,
      scheduledHourLocal: true,
      transactionCount: true,
      autoCategorizedCount: true,
      uncategorizedCount: true,
      reviewUrl: true,
      status: true,
      sentAt: true,
      acknowledgedAt: true,
      lastError: true
    }
  });

  return serializeDigest(digest);
}

export async function runDailyReviewCycle(
  input: RunDailyReviewCycleInput = {}
): Promise<RunDailyReviewCycleResult> {
  const env = getAppEnv();
  const user = await getOrCreateDefaultUser();
  const now = new Date();
  const localDateKey = formatLocalDateKey(now, env.dailyReviewTimezone);
  const localHour = getLocalHour(now, env.dailyReviewTimezone);

  if (!input.force && localHour !== env.dailyReviewHourLocal) {
    return {
      localDateKey,
      timezone: env.dailyReviewTimezone,
      scheduledHourLocal: env.dailyReviewHourLocal,
      status: "skipped",
      digest: await getLatestDailyReviewDigest(),
      categorization: null
    };
  }

  const todaysTransactionsBefore = await listTransactionsForLocalDate(
    user.id,
    localDateKey,
    env.dailyReviewTimezone
  );
  const uncategorizedIds = todaysTransactionsBefore
    .filter(
      (transaction) => transaction.reviewStatus === TransactionReviewStatus.uncategorized
    )
    .map((transaction) => transaction.id);

  const categorization =
    uncategorizedIds.length > 0
      ? await autoCategorizeTransactions({
          transactionIds: uncategorizedIds.slice(0, 100),
          limit: Math.min(uncategorizedIds.length, 100)
        })
      : null;

  const todaysTransactionsAfter = await listTransactionsForLocalDate(
    user.id,
    localDateKey,
    env.dailyReviewTimezone
  );

  const autoCategorizedCount = todaysTransactionsAfter.filter(
    (transaction) => transaction.reviewStatus === TransactionReviewStatus.auto_categorized
  ).length;
  const uncategorizedCount = todaysTransactionsAfter.filter(
    (transaction) => transaction.reviewStatus === TransactionReviewStatus.uncategorized
  ).length;
  const reviewUrl = `${env.appUrl}/?reviewDate=${localDateKey}`;
  const pingSummary =
    `${todaysTransactionsAfter.length} transaction(s) for ${localDateKey}. ` +
    `${autoCategorizedCount} AI-categorized, ${uncategorizedCount} still uncategorized.`;

  const existingDigest = await prisma.dailyReviewDigest.findUnique({
    where: {
      userId_localDateKey: {
        userId: user.id,
        localDateKey
      }
    },
    select: {
      id: true,
      sentAt: true
    }
  });

  let status: (typeof DailyReviewDigestStatus)[keyof typeof DailyReviewDigestStatus] =
    DailyReviewDigestStatus.pending;
  let sentAt: Date | null = null;
  let lastError: string | null = null;

  if (input.sendPing !== false) {
    if (!existingDigest?.sentAt || input.force) {
      const pingResult = await sendDailyReviewPing({
        localDateKey,
        reviewUrl,
        transactionCount: todaysTransactionsAfter.length,
        autoCategorizedCount,
        uncategorizedCount
      });

      if (pingResult.delivered) {
        status = DailyReviewDigestStatus.sent;
        sentAt = new Date();
      } else if (pingResult.error) {
        status = DailyReviewDigestStatus.failed;
        lastError = pingResult.error;
      }
    } else {
      status = DailyReviewDigestStatus.sent;
      sentAt = existingDigest.sentAt;
    }
  }

  const digest = await prisma.dailyReviewDigest.upsert({
    where: {
      userId_localDateKey: {
        userId: user.id,
        localDateKey
      }
    },
    update: {
      timezone: env.dailyReviewTimezone,
      scheduledHourLocal: env.dailyReviewHourLocal,
      transactionCount: todaysTransactionsAfter.length,
      autoCategorizedCount,
      uncategorizedCount,
      reviewUrl,
      pingSummary,
      status,
      sentAt,
      lastError
    },
    create: {
      userId: user.id,
      localDateKey,
      timezone: env.dailyReviewTimezone,
      scheduledHourLocal: env.dailyReviewHourLocal,
      transactionCount: todaysTransactionsAfter.length,
      autoCategorizedCount,
      uncategorizedCount,
      reviewUrl,
      pingSummary,
      status,
      sentAt,
      lastError
    },
    select: {
      id: true,
      localDateKey: true,
      timezone: true,
      scheduledHourLocal: true,
      transactionCount: true,
      autoCategorizedCount: true,
      uncategorizedCount: true,
      reviewUrl: true,
      status: true,
      sentAt: true,
      acknowledgedAt: true,
      lastError: true
    }
  });

  return {
    localDateKey,
    timezone: env.dailyReviewTimezone,
    scheduledHourLocal: env.dailyReviewHourLocal,
    status: existingDigest ? "updated" : "created",
    digest: serializeDigest(digest),
    categorization: categorization
      ? {
          attemptedCount: categorization.attemptedCount,
          categorizedCount: categorization.categorizedCount,
          leftUncategorizedCount: categorization.leftUncategorizedCount,
          model: categorization.model
        }
      : null
  };
}

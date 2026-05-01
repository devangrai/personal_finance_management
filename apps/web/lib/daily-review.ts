import {
  DailyReviewDigestStatus,
  TransactionReviewStatus,
  prisma
} from "@portfolio/db";
import { autoCategorizeTransactions } from "./ai-categorization";
import { toCanonicalDateKey } from "./date-utils";
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
    needsReviewCount: number;
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

async function listTransactionsForLocalDate(
  userId: string,
  localDateKey: string
) {
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
    (transaction) => toCanonicalDateKey(transaction.date) === localDateKey
  );
}

async function sendDailyReviewPing(input: {
  localDateKey: string;
  reviewUrl: string;
  transactionCount: number;
  autoCategorizedCount: number;
  uncategorizedCount: number;
  needsReviewCount: number;
}) {
  const env = getAppEnv();
  const deliveryErrors: string[] = [];
  let delivered = false;
  const hasEmailConfig =
    Boolean(env.resendApiKey) &&
    Boolean(env.dailyReviewEmailTo) &&
    Boolean(env.dailyReviewEmailFrom);
  const hasPartialEmailConfig =
    Boolean(env.resendApiKey) ||
    Boolean(env.dailyReviewEmailTo) ||
    Boolean(env.dailyReviewEmailFrom);

  if (!hasEmailConfig && hasPartialEmailConfig) {
    deliveryErrors.push(
      "Email delivery is partially configured. Set RESEND_API_KEY, DAILY_REVIEW_EMAIL_TO, and DAILY_REVIEW_EMAIL_FROM together."
    );
  }

  if (hasEmailConfig) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.resendApiKey}`
        },
        body: JSON.stringify({
          from: env.dailyReviewEmailFrom,
          to: [env.dailyReviewEmailTo],
          ...(env.dailyReviewEmailReplyTo
            ? {
                reply_to: env.dailyReviewEmailReplyTo
              }
            : {}),
          subject: `Daily transaction review for ${input.localDateKey}`,
          text:
            `Your daily transaction review for ${input.localDateKey} is ready.\n\n` +
            `${input.transactionCount} transaction(s) posted today.\n` +
            `${input.autoCategorizedCount} were AI-categorized and should be checked.\n` +
            `${input.uncategorizedCount} still need a manual category.\n` +
            `${input.needsReviewCount} total transaction(s) need your review.\n\n` +
            `Open the review queue: ${input.reviewUrl}`,
          html:
            `<div style="font-family: Georgia, serif; line-height: 1.6; color: #1a1712;">` +
            `<h2 style="margin-bottom: 8px;">Daily transaction review</h2>` +
            `<p style="margin-top: 0;">${input.localDateKey}</p>` +
            `<p><strong>${input.transactionCount}</strong> transaction(s) posted today.</p>` +
            `<ul>` +
            `<li><strong>${input.autoCategorizedCount}</strong> were AI-categorized and should be checked.</li>` +
            `<li><strong>${input.uncategorizedCount}</strong> still need a manual category.</li>` +
            `<li><strong>${input.needsReviewCount}</strong> total transaction(s) need your review.</li>` +
            `</ul>` +
            `<p><a href="${input.reviewUrl}">Open today's review queue</a></p>` +
            `</div>`
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Email provider returned a non-200 response.");
      }

      delivered = true;
    } catch (error) {
      deliveryErrors.push(
        error instanceof Error
          ? `Email delivery failed: ${error.message}`
          : "Email delivery failed."
      );
    }
  }

  if (env.dailyReviewWebhookUrl) {
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
            `${input.transactionCount} transaction(s) posted today. ` +
            `${input.autoCategorizedCount} were AI-categorized, ` +
            `${input.uncategorizedCount} still need a manual category, ` +
            `and ${input.needsReviewCount} total need your review.`,
          reviewUrl: input.reviewUrl,
          date: input.localDateKey
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Webhook returned a non-200 response.");
      }

      delivered = true;
    } catch (error) {
      deliveryErrors.push(
        error instanceof Error
          ? `Webhook delivery failed: ${error.message}`
          : "Webhook delivery failed."
      );
    }
  }

  if (!env.dailyReviewWebhookUrl && !hasEmailConfig && !hasPartialEmailConfig) {
    return {
      delivered: false,
      error: null as string | null
    };
  }

  return {
    delivered,
    error: delivered ? null : deliveryErrors.join(" ")
  };
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
    needsReviewCount: digest.autoCategorizedCount + digest.uncategorizedCount,
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
    localDateKey
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
    localDateKey
  );

  const autoCategorizedCount = todaysTransactionsAfter.filter(
    (transaction) => transaction.reviewStatus === TransactionReviewStatus.auto_categorized
  ).length;
  const uncategorizedCount = todaysTransactionsAfter.filter(
    (transaction) => transaction.reviewStatus === TransactionReviewStatus.uncategorized
  ).length;
  const needsReviewCount = autoCategorizedCount + uncategorizedCount;
  const reviewUrl = `${env.appUrl}/?reviewDate=${localDateKey}`;
  const pingSummary =
    `${todaysTransactionsAfter.length} transaction(s) for ${localDateKey}. ` +
    `${autoCategorizedCount} AI-categorized, ${uncategorizedCount} still uncategorized, ` +
    `${needsReviewCount} total need review.`;

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
        uncategorizedCount,
        needsReviewCount
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

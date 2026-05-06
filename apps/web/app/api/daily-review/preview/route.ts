import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { getAppEnv } from "@/lib/env";
import { getOrCreateDefaultUser } from "@/lib/user";
import { toCanonicalDateKey } from "@/lib/date-utils";
import { detectAnomaliesForTransactions } from "@/lib/anomaly-detection";
import { buildDailyReviewEmail } from "@/lib/daily-review-email";

/**
 * Renders TODAY's daily-review email as raw HTML (no send). Useful for
 * iterating on the template without burning Resend quota or cluttering
 * the inbox. Hit from /admin preview button.
 */
export async function GET() {
  try {
    const env = getAppEnv();
    const user = await getOrCreateDefaultUser();
    const localDateKey = toCanonicalDateKey(new Date());

    const txns = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        date: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5) }
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        date: true,
        name: true,
        merchantName: true,
        amount: true,
        direction: true,
        reviewStatus: true,
        category: { select: { id: true, label: true } },
        aiSuggestedCategory: { select: { id: true, label: true, key: true } },
        account: { select: { name: true } }
      }
    });
    const today = txns.filter(
      (t) =>
        toCanonicalDateKey(t.date) === localDateKey &&
        t.reviewStatus !== TransactionReviewStatus.ignored
    );

    const anomalyMap = await detectAnomaliesForTransactions({
      userId: user.id,
      transactionIds: today.map((t) => t.id)
    });

    const categories = await prisma.transactionCategory.findMany({
      where: { userId: user.id },
      orderBy: { label: "asc" },
      take: 12,
      select: { id: true, label: true }
    });

    const built = buildDailyReviewEmail({
      localDateKey,
      appUrl: env.appUrl,
      secret: env.encryptionKey,
      transactions: today.map((t) => ({
        id: t.id,
        displayName: t.merchantName ?? t.name,
        amount:
          t.direction === "debit"
            ? Math.abs(Number(t.amount))
            : -Math.abs(Number(t.amount)),
        accountName: t.account.name,
        aiSuggestedCategory: t.aiSuggestedCategory
          ? {
              id: t.aiSuggestedCategory.id,
              label: t.aiSuggestedCategory.label,
              key: t.aiSuggestedCategory.key
            }
          : null,
        currentCategory: t.category
          ? { id: t.category.id, label: t.category.label }
          : null,
        reviewStatus: t.reviewStatus
      })),
      anomalies: anomalyMap,
      suggestedCategories: categories,
      totals: {
        count: today.length,
        autoCategorized: today.filter(
          (t) =>
            t.reviewStatus === TransactionReviewStatus.auto_categorized
        ).length,
        uncategorized: today.filter(
          (t) => t.reviewStatus === TransactionReviewStatus.uncategorized
        ).length,
        anomalies: anomalyMap.size
      }
    });

    return new NextResponse(built.html, {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to render preview.") },
      { status: 500 }
    );
  }
}

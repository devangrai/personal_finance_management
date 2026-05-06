import { NextRequest, NextResponse } from "next/server";
import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { getErrorMessage } from "@/lib/errors";
import { getDefaultUserId, updateTransactionCategory } from "@/lib/categories";

type RouteContext = {
  params: Promise<{
    transactionId: string;
  }>;
};

type UpdateTransactionPayload = {
  categoryId?: string | null;
  /**
   * When supplied and no categoryId is passed, this becomes the sole
   * change — useful for "skip" flow where the user defers reviewing.
   */
  reviewStatus?: TransactionReviewStatus;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { transactionId } = await context.params;

  let payload: UpdateTransactionPayload;

  try {
    payload = (await request.json()) as UpdateTransactionPayload;
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be valid JSON."
      },
      {
        status: 400
      }
    );
  }

  try {
    // Category update path: writes reviewStatus=confirmed implicitly.
    if (payload.categoryId !== undefined) {
      const transaction = await updateTransactionCategory({
        transactionId,
        categoryId: payload.categoryId ?? null
      });
      return NextResponse.json(transaction);
    }

    // reviewStatus-only path (skip / reopen). Guard: only allow status
    // values that are safe for the user-facing quick-review UX.
    if (payload.reviewStatus !== undefined) {
      const allowed: TransactionReviewStatus[] = [
        "uncategorized",
        "auto_categorized",
        "user_categorized",
        "ignored"
      ];
      if (!allowed.includes(payload.reviewStatus)) {
        return NextResponse.json(
          { error: `Invalid reviewStatus: ${payload.reviewStatus}` },
          { status: 400 }
        );
      }
      const userId = await getDefaultUserId();
      const updated = await prisma.transaction.updateMany({
        where: { id: transactionId, userId },
        data: { reviewStatus: payload.reviewStatus }
      });
      if (updated.count === 0) {
        return NextResponse.json(
          { error: "Transaction not found." },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "Must provide categoryId or reviewStatus to patch." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to update transaction.")
      },
      {
        status: 500
      }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { updateTransactionCategory } from "@/lib/categories";

type RouteContext = {
  params: Promise<{
    transactionId: string;
  }>;
};

type UpdateTransactionPayload = {
  categoryId?: string | null;
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
    const transaction = await updateTransactionCategory({
      transactionId,
      categoryId: payload.categoryId ?? null
    });

    return NextResponse.json(transaction);
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

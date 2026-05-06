import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { createRuleFromTransaction } from "@/lib/transaction-rules";

type RouteContext = {
  params: Promise<{
    transactionId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { transactionId } = await context.params;

  try {
    const result = await createRuleFromTransaction({
      transactionId
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to create transaction rule.")
      },
      {
        status: 500
      }
    );
  }
}

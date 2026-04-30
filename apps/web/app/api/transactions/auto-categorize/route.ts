import { NextRequest, NextResponse } from "next/server";
import { autoCategorizeTransactions } from "@/lib/ai-categorization";
import { getErrorMessage } from "@/lib/errors";

type AutoCategorizePayload = {
  limit?: number;
  localDateKey?: string;
};

export async function POST(request: NextRequest) {
  let payload: AutoCategorizePayload = {};

  try {
    payload = (await request.json()) as AutoCategorizePayload;
  } catch {
    payload = {};
  }

  try {
    const result = await autoCategorizeTransactions({
      limit: payload.limit,
      localDateKey: payload.localDateKey
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to auto-categorize transactions.")
      },
      {
        status: 500
      }
    );
  }
}

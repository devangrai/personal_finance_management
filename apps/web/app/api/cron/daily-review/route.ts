import { NextRequest, NextResponse } from "next/server";
import { runDailyReviewCycle } from "@/lib/daily-review";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const env = getAppEnv();
  const authHeader = request.headers.get("authorization");

  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json(
      {
        error: "Unauthorized."
      },
      {
        status: 401
      }
    );
  }

  try {
    const result = await runDailyReviewCycle();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to run the cron daily review.")
      },
      {
        status: 500
      }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { runDailyReviewCycle } from "@/lib/daily-review";

type DailyReviewRunPayload = {
  sendPing?: boolean;
};

export async function POST(request: NextRequest) {
  let payload: DailyReviewRunPayload = {};

  try {
    payload = (await request.json()) as DailyReviewRunPayload;
  } catch {
    payload = {};
  }

  try {
    const result = await runDailyReviewCycle({
      force: true,
      sendPing: payload.sendPing
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to run the daily review cycle.")
      },
      {
        status: 500
      }
    );
  }
}

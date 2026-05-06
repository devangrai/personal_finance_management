import { NextResponse } from "next/server";
import { getLatestDailyReviewDigest } from "@/lib/daily-review";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  try {
    const digest = await getLatestDailyReviewDigest();

    return NextResponse.json({
      digest
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to load the latest daily review.")
      },
      {
        status: 500
      }
    );
  }
}

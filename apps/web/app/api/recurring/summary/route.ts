import { NextResponse } from "next/server";
import { getRecurringSummary } from "@/lib/recurring-summary";

export async function GET() {
  try {
    const summary = await getRecurringSummary();
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load recurring summary.";

    return NextResponse.json(
      {
        error: message
      },
      {
        status: 500
      }
    );
  }
}

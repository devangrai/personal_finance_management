import { NextRequest, NextResponse } from "next/server";
import { getCashflowSummary } from "@/lib/cashflow-summary";

export async function GET(request: NextRequest) {
  const monthsValue = request.nextUrl.searchParams.get("months");
  const parsedMonths = monthsValue ? Number(monthsValue) : 6;

  try {
    const summary = await getCashflowSummary(
      Number.isFinite(parsedMonths) ? parsedMonths : 6
    );

    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load cash flow summary.";

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

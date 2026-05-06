import { NextRequest, NextResponse } from "next/server";
import { getFlowAggregation, type FlowWindow } from "@/lib/flow-aggregation";
import { computeTopMovers, computeStaleRecurring } from "@/lib/flow-insights";
import { getErrorMessage } from "@/lib/errors";

const VALID_WINDOWS: FlowWindow[] = [
  "this-month",
  "last-month",
  "avg-3mo",
  "avg-12mo"
];

function parseWindow(raw: string | null): FlowWindow {
  if (raw && VALID_WINDOWS.includes(raw as FlowWindow)) {
    return raw as FlowWindow;
  }
  return "this-month";
}

export async function GET(request: NextRequest) {
  const window = parseWindow(request.nextUrl.searchParams.get("window"));
  try {
    const [aggregation, topCategories, staleRecurring] = await Promise.all([
      getFlowAggregation(window),
      computeTopMovers(window),
      computeStaleRecurring()
    ]);

    return NextResponse.json({
      window: aggregation.window,
      totals: aggregation.totals,
      sankey: aggregation.sankey,
      topCategories,
      staleRecurring
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to compute flow.") },
      { status: 500 }
    );
  }
}

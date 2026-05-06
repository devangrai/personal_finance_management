import { FlowView } from "@/components/flow/flow-view";
import { getFlowAggregation } from "@/lib/flow-aggregation";
import { computeTopMovers, computeStaleRecurring } from "@/lib/flow-insights";

export const metadata = { title: "Flow · PFM" };
export const dynamic = "force-dynamic";

export default async function FlowPage() {
  const initialWindow = "this-month" as const;
  const [aggregation, topCategories, staleRecurring] = await Promise.all([
    getFlowAggregation(initialWindow),
    computeTopMovers(initialWindow),
    computeStaleRecurring()
  ]);

  return (
    <FlowView
      initialWindow={initialWindow}
      initial={{
        window: aggregation.window,
        totals: aggregation.totals,
        sankey: aggregation.sankey,
        topCategories,
        staleRecurring
      }}
    />
  );
}

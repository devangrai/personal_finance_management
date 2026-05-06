"use client";

import { useEffect, useState, useTransition } from "react";
import { FlowSankey } from "./flow-sankey";
import { TopMovers } from "./top-movers";
import { StaleRecurringList } from "./stale-recurring";
import { FlowSidePanel } from "./flow-side-panel";

type FlowWindow = "this-month" | "last-month" | "avg-3mo" | "avg-12mo";

type SankeyNode = {
  id: string;
  label: string;
  type: "income" | "account" | "spending" | "investment" | "debt";
};
type SankeyLink = {
  source: string;
  target: string;
  value: number;
  count: number;
};

type FlowResponse = {
  window: {
    label: string;
    start: string;
    end: string;
    monthsSpanned: number;
  };
  totals: { inflow: number; outflow: number; net: number };
  sankey: { nodes: SankeyNode[]; links: SankeyLink[] };
  topCategories: Array<{
    categoryKey: string;
    label: string;
    amount: number;
    previousAmount: number;
    deltaPct: number | null;
    flag: "up" | "down" | "flat";
  }>;
  staleRecurring: Array<{
    displayName: string;
    amount: number;
    frequency: string;
    direction: "credit" | "debit";
    lastSeen: string;
    ageMonths: number;
    note: string;
  }>;
};

const WINDOW_LABELS: Record<FlowWindow, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "avg-3mo": "Last 3 months (avg)",
  "avg-12mo": "Last 12 months (avg)"
};

function currency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function FlowView(props: { initial: FlowResponse; initialWindow: FlowWindow }) {
  const [selectedWindow, setSelectedWindow] = useState<FlowWindow>(
    props.initialWindow
  );
  const [data, setData] = useState<FlowResponse>(props.initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<
    Parameters<typeof FlowSidePanel>[0]["selection"]
  >(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Window changed → refetch.
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/flow?window=${selectedWindow}`);
        const body = (await res.json()) as FlowResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `fetch failed ${res.status}`);
        if (!cancelled) startTransition(() => setData(body));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (selectedWindow !== props.initialWindow) void run();
    return () => {
      cancelled = true;
    };
  }, [selectedWindow, props.initialWindow]);

  return (
    <div className="flowPage">
      <div className="flowHeader">
        <div className="flowHeaderLeft">
          <p className="eyebrow">Where your money goes</p>
          <h1 className="flowTitle">Flow</h1>
        </div>
        <div className="flowHeaderRight">
          <label className="flowWindowLabel">
            <span className="srOnly">Time window</span>
            <select
              value={selectedWindow}
              onChange={(e) => setSelectedWindow(e.target.value as FlowWindow)}
              className="flowWindowSelect"
              disabled={loading}
            >
              {(Object.keys(WINDOW_LABELS) as FlowWindow[]).map((w) => (
                <option key={w} value={w}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flowTotalsRow">
        <div className="flowTotalItem">
          <span className="flowTotalLabel">Inflow</span>
          <span className="flowTotalValue positive">
            {currency(data.totals.inflow)}
          </span>
        </div>
        <div className="flowTotalItem">
          <span className="flowTotalLabel">Outflow</span>
          <span className="flowTotalValue negative">
            {currency(data.totals.outflow)}
          </span>
        </div>
        <div className="flowTotalItem">
          <span className="flowTotalLabel">Net</span>
          <span
            className={
              data.totals.net >= 0
                ? "flowTotalValue positive"
                : "flowTotalValue negative"
            }
          >
            {data.totals.net >= 0 ? "+" : ""}
            {currency(data.totals.net)}
          </span>
        </div>
        <div className="flowTotalItem flowTotalItemRight">
          <span className="flowTotalLabel">Window</span>
          <span className="flowTotalValue">{data.window.label}</span>
        </div>
      </div>

      {error ? <p className="errorLine flowErrorLine">{error}</p> : null}

      <div className="flowSankeyHost">
        <FlowSankey
          nodes={data.sankey.nodes}
          links={data.sankey.links}
          width={1100}
          onLinkClick={(l) => {
            // Find labels for source/target for display.
            const nodesById = new Map(data.sankey.nodes.map((n) => [n.id, n]));
            setSelection({
              kind: "link",
              sourceLabel: nodesById.get(l.source)?.label ?? l.source,
              targetLabel: nodesById.get(l.target)?.label ?? l.target,
              value: l.value,
              count: l.count
            });
          }}
          onNodeClick={(n) =>
            setSelection({
              kind: "node",
              label: n.label,
              nodeType: n.type,
              value: 0
            })
          }
        />
      </div>

      <div className="flowSupportGrid">
        <section className="card">
          <p className="eyebrow">Biggest movers</p>
          <h2 className="flowCardTitle">Categories shifting most</h2>
          <p className="cardHelp">
            Spending categories this window, sorted by volume, with delta vs
            the prior window. Flagged categories moved 25% or more.
          </p>
          <TopMovers
            movers={data.topCategories}
            onSelect={(key, label) => {
              const m = data.topCategories.find((c) => c.categoryKey === key);
              if (!m) return;
              setSelection({
                kind: "category",
                label,
                amount: m.amount,
                deltaPct: m.deltaPct
              });
            }}
          />
        </section>

        <section className="card">
          <p className="eyebrow">Second look</p>
          <h2 className="flowCardTitle">Recurring flows worth reviewing</h2>
          <p className="cardHelp">
            Long-running subscriptions or flows that haven&apos;t hit on
            schedule — worth a quick audit.
          </p>
          <StaleRecurringList
            items={data.staleRecurring}
            onSelect={(item) =>
              setSelection({
                kind: "recurring",
                displayName: item.displayName,
                amount: item.amount,
                frequency: item.frequency,
                lastSeen: item.lastSeen,
                note: item.note
              })
            }
          />
        </section>
      </div>

      <FlowSidePanel
        selection={selection}
        onClose={() => setSelection(null)}
      />
    </div>
  );
}

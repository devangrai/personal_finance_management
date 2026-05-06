import { prisma } from "@portfolio/db";
import { getDefaultUserId } from "./categories";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FlowWindow =
  | "this-month"
  | "last-month"
  | "avg-3mo"
  | "avg-12mo";

export type SankeyNodeType =
  | "income"
  | "account"
  | "spending"
  | "investment"
  | "debt";

export type SankeyNode = {
  id: string;
  label: string;
  type: SankeyNodeType;
};

export type SankeyLink = {
  source: string;
  target: string;
  value: number;
  count: number;
};

export type FlowAggregation = {
  window: {
    label: string;
    start: string; // ISO date (inclusive)
    end: string; // ISO date (exclusive)
    monthsSpanned: number;
  };
  totals: {
    inflow: number;
    outflow: number;
    net: number;
  };
  sankey: {
    nodes: SankeyNode[];
    links: SankeyLink[];
  };
};

// ---------------------------------------------------------------------------
// Date window helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a named window against a reference "now" date.
 * Exported for deterministic testing.
 */
export function resolveWindow(
  window: FlowWindow,
  now: Date = new Date()
): { start: Date; end: Date; label: string; monthsSpanned: number } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  switch (window) {
    case "this-month": {
      const start = new Date(Date.UTC(y, m, 1));
      const end = new Date(Date.UTC(y, m + 1, 1));
      return {
        start,
        end,
        label: start.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC"
        }),
        monthsSpanned: 1
      };
    }
    case "last-month": {
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      return {
        start,
        end,
        label: start.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC"
        }),
        monthsSpanned: 1
      };
    }
    case "avg-3mo": {
      const start = new Date(Date.UTC(y, m - 3, 1));
      const end = new Date(Date.UTC(y, m, 1));
      return {
        start,
        end,
        label: "Last 3 months (avg)",
        monthsSpanned: 3
      };
    }
    case "avg-12mo": {
      const start = new Date(Date.UTC(y, m - 12, 1));
      const end = new Date(Date.UTC(y, m, 1));
      return {
        start,
        end,
        label: "Last 12 months (avg)",
        monthsSpanned: 12
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Pure aggregation (testable)
// ---------------------------------------------------------------------------

export type AggregatorTxn = {
  id: string;
  date: Date;
  amount: number; // always positive; sign implied by direction
  direction: "debit" | "credit";
  name: string;
  merchantName: string | null;
  accountId: string;
  accountName: string;
  accountType: string;
  accountSubtype: string | null;
  categoryKey: string | null;
  categoryLabel: string | null;
  personalFinanceCategory: string | null;
};

/**
 * Classify an inflow transaction into a named income source.
 * Heuristic only — paycheck detection is deliberately loose. Misses become
 * "Other income" which is fine; false positives are the thing to avoid.
 */
export function classifyIncomeSource(txn: AggregatorTxn): {
  id: string;
  label: string;
} {
  const haystack = `${txn.name} ${txn.merchantName ?? ""}`.toLowerCase();
  const pfc = (txn.personalFinanceCategory ?? "").toLowerCase();

  // Paycheck: direct deposit-ish patterns
  if (
    /\b(payroll|paycheck|direct dep|direct\s*deposit|salary|wages)\b/.test(
      haystack
    ) ||
    pfc.includes("payroll")
  ) {
    return { id: "src:paycheck", label: "Paycheck" };
  }
  // Interest / dividends
  if (/\binterest|dividend|div\b/.test(haystack) || pfc.includes("interest")) {
    return { id: "src:interest", label: "Interest & dividends" };
  }
  // Transfers from external
  if (/\b(transfer|xfer|ach)\b/.test(haystack)) {
    return { id: "src:transfer-in", label: "Transfers in" };
  }
  // Refund / reimbursement
  if (/\b(refund|reimburs|return)\b/.test(haystack)) {
    return { id: "src:refund", label: "Refunds & reimbursements" };
  }
  return { id: "src:other-income", label: "Other income" };
}

/**
 * Decide whether a transaction represents an internal transfer between
 * user-owned accounts. These get filtered out of the Sankey so we don't
 * double-count (e.g. a transfer from Checking → Savings should not show
 * as spending-from-checking + income-to-savings).
 *
 * We use name-based heuristics — structural pair matching (by date+amount
 * across accounts) is overkill for the first version.
 */
export function looksLikeInternalTransfer(txn: AggregatorTxn): boolean {
  const h = `${txn.name} ${txn.merchantName ?? ""}`.toLowerCase();
  if (/\b(transfer|xfer)\b.*\b(to|from)\b/.test(h)) return true;
  if (/\bfid bkg svc llc\b/.test(h)) return true; // Fidelity brokerage transfers
  // Recurring brokerage deposits named like "fid aut xfer"
  if (/\bautomatic transfer\b/.test(h)) return true;
  return false;
}

/**
 * Given a window of transactions, compute the Sankey nodes and links.
 *
 * Rules:
 *   - Inflows (credit) flow from a classified income source → the destination
 *     account node
 *   - Outflows (debit) flow from the originating account node → a category node
 *     (spending), or a special "investment" / "debt" node for credit-card
 *     payoffs and brokerage transfers
 *   - Internal transfers are filtered out
 *   - If `monthsSpanned > 1`, values are averaged per month
 */
export function aggregateForSankey(
  txns: AggregatorTxn[],
  monthsSpanned: number
): {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totals: { inflow: number; outflow: number; net: number };
} {
  const nodes = new Map<string, SankeyNode>();
  const ensureNode = (node: SankeyNode) => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };

  // Link aggregation keyed by `${source}|${target}`.
  const links = new Map<string, SankeyLink>();
  const addLink = (
    source: string,
    target: string,
    value: number,
    count = 1
  ) => {
    const key = `${source}|${target}`;
    const existing = links.get(key);
    if (existing) {
      existing.value += value;
      existing.count += count;
    } else {
      links.set(key, { source, target, value, count });
    }
  };

  let inflowTotal = 0;
  let outflowTotal = 0;

  for (const txn of txns) {
    if (looksLikeInternalTransfer(txn)) continue;

    const accountNodeId = `acct:${txn.accountId}`;
    const accountLabel = txn.accountName;
    const accountType =
      txn.accountType === "credit" || txn.accountType === "loan"
        ? "debt"
        : txn.accountType === "investment"
          ? "investment"
          : "account";
    ensureNode({ id: accountNodeId, label: accountLabel, type: accountType });

    if (txn.direction === "credit") {
      // Inflow: income source → account
      const source = classifyIncomeSource(txn);
      ensureNode({ id: source.id, label: source.label, type: "income" });
      addLink(source.id, accountNodeId, txn.amount);
      inflowTotal += txn.amount;
    } else {
      // Outflow: account → spending category (or debt/investment target)
      let targetId: string;
      let targetLabel: string;
      let targetType: SankeyNodeType;

      if (
        txn.categoryKey === "credit_card_payment" ||
        /\b(credit\s*card\s*pay|card\s*payment)\b/i.test(txn.name)
      ) {
        targetId = "tgt:cc-payoff";
        targetLabel = "Credit card payoff";
        targetType = "debt";
      } else if (
        txn.categoryKey === "investment_deposit" ||
        /\b(brokerage|fidelity|vanguard|schwab|e\*trade)\b/i.test(txn.name)
      ) {
        targetId = "tgt:investment";
        targetLabel = "Investment contribution";
        targetType = "investment";
      } else {
        const label = txn.categoryLabel ?? "Uncategorized";
        const key = txn.categoryKey ?? "uncategorized";
        targetId = `cat:${key}`;
        targetLabel = label;
        targetType = "spending";
      }

      ensureNode({ id: targetId, label: targetLabel, type: targetType });
      addLink(accountNodeId, targetId, txn.amount);
      outflowTotal += txn.amount;
    }
  }

  // Average per month if window > 1 month so the diagram is scale-stable
  const divisor = monthsSpanned > 1 ? monthsSpanned : 1;
  if (divisor > 1) {
    for (const link of links.values()) {
      link.value = link.value / divisor;
    }
    inflowTotal = inflowTotal / divisor;
    outflowTotal = outflowTotal / divisor;
  }

  // Drop tiny links (< $5/month avg) to keep the diagram readable.
  const MIN_VALUE = 5;
  const kept: SankeyLink[] = [];
  for (const link of links.values()) {
    if (link.value >= MIN_VALUE) kept.push(link);
  }

  // Drop orphaned nodes (nodes with no remaining link after filtering).
  const usedNodeIds = new Set<string>();
  for (const link of kept) {
    usedNodeIds.add(link.source);
    usedNodeIds.add(link.target);
  }
  const keptNodes: SankeyNode[] = [];
  for (const node of nodes.values()) {
    if (usedNodeIds.has(node.id)) keptNodes.push(node);
  }

  return {
    nodes: keptNodes,
    links: kept,
    totals: {
      inflow: inflowTotal,
      outflow: outflowTotal,
      net: inflowTotal - outflowTotal
    }
  };
}

// ---------------------------------------------------------------------------
// DB wrapper: fetch transactions in window, normalize, aggregate
// ---------------------------------------------------------------------------

export async function getFlowAggregation(
  window: FlowWindow,
  now: Date = new Date()
): Promise<FlowAggregation> {
  const userId = await getDefaultUserId();
  const w = resolveWindow(window, now);

  const rows = await prisma.transaction.findMany({
    where: {
      userId,
      isPending: false,
      date: {
        gte: w.start,
        lt: w.end
      }
    },
    select: {
      id: true,
      date: true,
      amount: true,
      direction: true,
      name: true,
      merchantName: true,
      accountId: true,
      personalFinanceCategory: true,
      account: {
        select: {
          name: true,
          type: true,
          subtype: true
        }
      },
      category: {
        select: {
          key: true,
          label: true
        }
      }
    }
  });

  const txns: AggregatorTxn[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    direction: r.direction as "debit" | "credit",
    name: r.name,
    merchantName: r.merchantName,
    accountId: r.accountId,
    accountName: r.account.name,
    accountType: r.account.type,
    accountSubtype: r.account.subtype,
    categoryKey: r.category?.key ?? null,
    categoryLabel: r.category?.label ?? null,
    personalFinanceCategory: r.personalFinanceCategory
  }));

  const result = aggregateForSankey(txns, w.monthsSpanned);

  return {
    window: {
      label: w.label,
      start: w.start.toISOString().slice(0, 10),
      end: w.end.toISOString().slice(0, 10),
      monthsSpanned: w.monthsSpanned
    },
    totals: result.totals,
    sankey: {
      nodes: result.nodes,
      links: result.links
    }
  };
}

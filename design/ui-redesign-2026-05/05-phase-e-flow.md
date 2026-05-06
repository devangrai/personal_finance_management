# Phase E — Flow tab

## Goal
A Grafana-style visualization showing how money flows through the user's
financial life. Two views (toggle): **Categories** (the "where does my
money go" mental model) and **Accounts** (the "where does the money
actually sit" mental model). Interactive — hover for detail, click an
edge to see the underlying transactions.

This is the biggest visual investment in the whole redesign. It's the
view that, more than any other, will make the product feel different from
a spreadsheet.

## Scope

### Two views, same canvas

**Categories view** (default)
- Nodes (income left → flow middle → spend right):
  - Income sources: `Paycheck`, `Reimbursements`, `Interest/Dividends`,
    `Refunds`
  - Pre-tax destinations: `401(k)`, `HSA`, `Pre-tax insurance`
  - Transit hubs: `Checking`, `Savings`
  - Spending categories (using `TransactionCategory` table): `Groceries`,
    `Dining`, `Housing`, `Transportation`, `Subscriptions`,
    `Entertainment`, `Shopping`, `Medical`, `Other`
  - Investment destinations: `Brokerage`, `Roth IRA`, `Traditional IRA`
  - Debt outflows: `Credit card payoff`, `Loan payment`
- Edges = dollar volumes aggregated over the selected time window
- Edge thickness proportional to volume (sqrt-scaled so tiny categories
  remain visible)

**Accounts view**
- Nodes = literal accounts. `Checking · Chase`, `Savings · Ally`,
  `Brokerage · Fidelity`, etc.
- Edges = observed transfers between accounts (from Transaction rows
  where source and destination accounts are both user-owned)
- External world represented by two boundary nodes: `External income`
  (left) and `External spending` (right)

**Shared**
- Time control top-right: `This month` / `Last month` /
  `Avg last 3 months` / `Last 12 months`
- Same canvas, same layout engine — only the nodes + edges change

### Interactions
- Hover edge → floating tooltip:
  - `"$2,400 from Paycheck → 401(k)"`
  - `"8 transactions over this period"`
  - `"last transaction: Apr 29"`
- Click edge → side panel slides in with the underlying transactions,
  filtered to exactly that source→destination pair
- Hover node → highlight all connected edges, dim the rest
- Click node → side panel with top spending/income for that bucket

### Empty state
- If the user has < 10 categorized transactions, show a gentle
  "Let's get some flows going" card with link to `/overview` to sync and
  categorize. Don't render a mostly-empty graph — it looks broken.

## Implementation approach

**Library: `reactflow` v12 (MIT).** Chosen over alternatives because:
- First-class support for custom node components (so I can style to match
  the palette)
- Edge types including bezier curves and animated flows
- Built-in pan/zoom/selection
- Actively maintained
- Works with SSR via dynamic import

Alternatives considered:
- `recharts` Sankey: simpler but not interactive enough for hover detail
  and no free-form layout
- `visx`: powerful but requires building too much from scratch
- `d3-sankey` raw: max flexibility, most code, least polish

**Layout:** `dagre` auto-layout for initial positions (left-to-right
flow). Users can drag nodes to customize; save positions in localStorage
so it persists.

**Data source:** a new `/api/flow` route that computes aggregated edges
from transactions + recurring detection:

```json
{
  "categories": {
    "nodes": [{"id": "paycheck", "label": "Paycheck", "type": "income"},
              ...],
    "edges": [{"source": "paycheck", "target": "checking", "amount": 5210.00,
               "transactionCount": 2, "lastDate": "2026-05-01"}, ...]
  },
  "accounts": {
    "nodes": [{"id": "acct_chase_chk", "label": "Chase Checking", "balance": 8240}, ...],
    "edges": [{"source": "acct_chase_chk", "target": "acct_fidelity_brk",
               "amount": 1000.00, ...}]
  },
  "window": {"start": "2026-04-01", "end": "2026-05-01"}
}
```

## Files

New:
```
apps/web/app/flow/page.tsx                  -- replaces placeholder
apps/web/components/flow/flow-canvas.tsx    -- <ReactFlow> wrapper
apps/web/components/flow/flow-node.tsx      -- custom node component
apps/web/components/flow/flow-edge-tooltip.tsx
apps/web/components/flow/flow-toggle.tsx    -- Categories/Accounts switch
apps/web/components/flow/flow-time-control.tsx
apps/web/components/flow/transaction-side-panel.tsx
apps/web/lib/flow-aggregation.ts            -- compute nodes/edges from
                                                transactions
```

New API:
```
apps/web/app/api/flow/route.ts              -- returns above JSON shape,
                                                supports ?view=
                                                categories|accounts &
                                                ?window=month|last-month|
                                                3mo|12mo
```

## Aggregation logic

### Categories view edges
For each transaction within the window:
1. If income (direction=inflow) → edge from inferred source (paycheck
   detection, interest/dividend detection) to the destination account
   normalized as "Checking" / "Savings"
2. If outflow to a category → edge from originating account → category
   node
3. If internal transfer → edge between account-level nodes even in
   Categories view (shown as a thin dashed line for "transit" flow)

Paycheck/interest/dividend detection leans on existing recurring-detection
logic + transaction naming heuristics.

### Accounts view edges
Pair transactions by date+amount where one is an outflow and one is an
inflow on different user-owned accounts (simple heuristic, 80%+
accurate). For what doesn't pair, classify as external.

## Design polish

### Node visual
```
┌───────────────────────┐
│  [icon] Paycheck      │
│         $5,210 / mo   │
└───────────────────────┘
```
- Warm cream bg (`--panel`), 1px `--line` border, 16px radius
- Subtle shadow
- Type-based left accent stripe:
  - Income: teal
  - Spending: gold
  - Investment: deep teal
  - Debt: muted red

### Edge visual
- Smooth bezier curves
- Thickness: 2px (tiny) to 14px (huge) via sqrt scale
- Color matches source node's type
- Hover: pulse animation + tooltip
- Selected: solid highlight, others fade to 25% opacity

### Side panel
- Slides in from the right, 360px wide
- Shows the filtered transaction list
- Has "close" and "open in Overview" actions

## Acceptance
- `/flow` renders both views without errors
- Toggle between Categories/Accounts preserves the time window
- Time window change refetches aggregates
- Hovering an edge shows tooltip with accurate numbers
- Clicking an edge opens side panel with correct transactions
- Dragging nodes persists across reload (localStorage)
- Empty state renders when < 10 txns categorized in window
- `npm test` passes; add tests for:
  - `flow-aggregation.ts` correctly groups transactions into edges
  - Empty-state triggers at correct threshold
- `next build` succeeds
- Lighthouse performance >= 80 on the Flow page (big diagram, watch this)

## Effort estimate
2-3 working days. The real time is in tuning layout, edge thickness
scale, and the custom node component to look polished.

## Dependencies to add
```json
"reactflow": "^11.11.4",
"dagre": "^0.8.5",
"@types/dagre": "^0.7.52"
```

All MIT-licensed, tree-shakes cleanly.

## Open questions
1. Flow period default — "This month" (fresh, changes frequently) or
   "Avg last 3 months" (more representative)? I lean "This month" with
   a visible hint: *"Showing May 2026 · see average →"*
2. Should Brokerage contributions appear as "outflow to brokerage" or
   "inflow to investment"? Semantically they're both. I'd render them
   as flow from Checking → Brokerage node, same tone as any other
   outflow but with a different accent stripe (deep teal).
3. Are credit cards a source of flow (pay off credit → spending
   categories) or a node unto themselves? I'd treat them as accounts (so
   they appear in Accounts view) and as transit/spending in Categories
   view depending on whether the user pays off monthly. Simple rule:
   credit card spending shows as direct spending-by-category in the
   Categories view (the card is treated as pass-through); the actual
   card payment shows as debt outflow.

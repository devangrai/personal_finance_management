# Phase D — Overview tab

## Goal
A calm, scannable home page that answers "how much do I have, where is it,
and how did this week go?" in under 3 seconds of looking at it. Replaces
the top half of the legacy panel.

## Scope

### Layout

Two-row grid above, single column below:

```
┌──────────────┬──────────────┐
│  Net worth   │  This week   │
└──────────────┴──────────────┘
┌─────────────────────────────┐
│  Accounts + sync            │
└─────────────────────────────┘
┌─────────────────────────────┐
│  Recent transactions (7d)   │
└─────────────────────────────┘
```

## Component details

### `<NetWorthCard />`
- Big number: current net worth (sum of asset accounts - sum of liability
  accounts)
- Delta chip: `↗ +$1,840 this week` (green if positive, muted red if negative)
- Small copy: `"across 6 accounts"` with link to "Accounts" section below
- Data: computed in a new `/api/overview/snapshot` endpoint, or by
  extending `/api/accounts` to include computed totals

### `<WeekSummaryCard />`
- Three small stats in a column:
  - Income: `+$5,210`
  - Spent: `-$2,890`
  - Net: `+$2,320`
- Data: derived from `/api/cashflow/summary` filtered to last 7 days
  (the endpoint already supports this)

### `<AccountsList />` — the core of this tab
One row per account. Ordered by type:
1. Checking / Savings (liquid)
2. Brokerage / 401(k) / IRA / HSA (investments)
3. Credit / Loan (liabilities)

Each row:
```
{icon}  {accountName}                    {balance}    {sync status}
        {institutionName}
```

- **Synced X min ago** (from `Account.balanceLastUpdatedAt`)
- If stale (>24h), show "stale" pill with muted warning color
- Hover reveals a "Sync now" button (per-account sync if backend supports
  it, else disabled with tooltip)
- Click row → scrolls to that account's transactions in the list below

Above the list: `[ Sync all accounts ]` primary button that hits a new
`/api/sync/all` endpoint (which internally calls existing transaction-sync
+ investment-sync routes).

Bottom of the list: two muted secondary actions:
- `+ Connect a bank` → opens Plaid Link (reuse existing component)
- `+ Import investment CSV` → opens CSV import modal (reuse existing
  component)

### `<RecentTransactions />`

7-day view, limit 20 rows. Per row:
```
{date}  {merchantName}                {amount}  {category} {confidence}
                                                           {review?}
```

**AI-labelling visibility** (you asked about this):
- For each transaction, show its AI-assigned category as a chip
- If `aiSuggestedConfidence < 70`, add a small `?` icon next to the chip
  meaning "low confidence — tap to review"
- Clicking `?` → inline quick-review action:
  - Accept AI suggestion → `PATCH /api/transactions/:id` with
    `reviewStatus: "confirmed"` + set `categoryId = aiSuggestedCategoryId`
  - Change category → small dropdown to pick from `TransactionCategory`
    list → same PATCH with manual category
  - Skip → closes the prompt, transaction stays `reviewStatus:
    "uncategorized"` or `"needs_review"`
- Rows with `reviewStatus: "needs_review"` get a subtle yellow left-border
  so you can spot them while scrolling

Footer: `"{N} transactions still need review"` → link to
`/overview/review` (new, focused review queue page — or add a query param
`?filter=needs_review`).

Header: date filter chip — `Last 7 days` ▾ expands to `Last 30 days` / `This month` / `Last month`.

## Files

New:
```
apps/web/app/overview/page.tsx              -- replaces placeholder
apps/web/components/overview/net-worth-card.tsx
apps/web/components/overview/week-summary-card.tsx
apps/web/components/overview/accounts-list.tsx
apps/web/components/overview/account-row.tsx
apps/web/components/overview/recent-transactions.tsx
apps/web/components/overview/transaction-row.tsx
apps/web/components/overview/sync-all-button.tsx
apps/web/components/overview/review-chip.tsx
```

New API:
```
apps/web/app/api/overview/snapshot/route.ts -- net worth + week totals
apps/web/app/api/sync/all/route.ts          -- wraps txn sync + invest sync
```

Modified:
```
apps/web/app/api/transactions/route.ts       -- support ?includeAiLabels=1
                                                 (return aiSuggested*
                                                 fields to the client)
apps/web/app/api/transactions/[transactionId]/route.ts
                                              -- PATCH accepts
                                                 {reviewStatus, categoryId}
```

Components to LIFT from legacy panel (not rewrite):
- `<PlaidLinkButton>` if it's a separate extraction; if it's embedded,
  carve it out during this phase (small, ~50 lines)
- CSV import modal trigger — same

## Backend changes

### New `/api/overview/snapshot` (small)
Returns:
```json
{
  "netWorth": 247831.22,
  "netWorthDeltaWeek": 1840.11,
  "accountCount": 6,
  "week": {
    "income": 5210.00,
    "spent": 2890.45,
    "net": 2319.55
  },
  "needsReviewCount": 12
}
```

All computed via the existing Prisma models. Should be a ~60-line route.

### New `/api/sync/all` (small)
Fires off transaction sync for each linked Plaid item, then investment
sync. Returns a summary of what synced. 30-60s operation; render a
spinner on the button while it runs.

### Extend `/api/transactions/[id]` PATCH
Current route supports minimal updates. Extend to accept `reviewStatus`
and `categoryId` and any combination; the inline-review UX depends on
this.

## Design polish
- NetWorthCard headline uses serif (hero-adjacent); all other text uses
  sans
- AccountRow uses subtle background tint alternation for readability
- Institution logos — nice-to-have if Plaid returns them; otherwise
  first-letter avatar in the account's accent color
- Sticky sub-header when scrolling: "Accounts" / "Recent transactions"

## Acceptance
- `/overview` renders all four sections on the prod dataset
- Net worth matches hand-calculation of account balances
- "Sync all accounts" runs without timing out (uses streaming response
  if needed)
- AI-suggested category chips visible on every transaction that has one
- Low-confidence quick-review flow works end-to-end for one sample txn
- `npm test` passes; add tests for:
  - `overview/snapshot` API returns correct shape
  - `<TransactionRow>` shows review chip when confidence < 70
  - `<AccountRow>` shows "stale" pill when balance is >24h old
- `next build` succeeds

## Effort estimate
1 working day (8 hours).

## Open questions
1. Net worth calculation — include credit card balances as negative? Yes
   for meaningful net worth. Include pending transactions? Probably not,
   keeps the number stable.
2. Should "Sync all" be manually triggered, or should it run automatically
   on tab visit (throttled to 1/hour)? Manual for Phase D; auto later.
3. Low-confidence threshold — 70 is my guess. Worth logging the actual
   confidence distribution before picking a final number.

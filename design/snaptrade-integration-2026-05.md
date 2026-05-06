# SnapTrade integration — design iterations

## Architecture audit: what exists today

### Schema (Plaid side)

```
User
 └── PlaidItem (1:N)
      ├── plaidItemId (unique)
      ├── accessTokenEncrypted
      ├── transactionsCursor
      └── Account (1:N)
           ├── plaidAccountId (unique)
           ├── type: depository|credit|investment|loan|other
           └── Transaction (1:N)
                ├── plaidTransactionId (unique)
                ├── direction: debit|credit
                └── categoryId / aiSuggestedCategoryId
```

Separately, for CSV imports:
```
User
 └── ManualInvestmentAccount (1:N, `source: String`)
      ├── ManualHoldingSnapshot
      └── ManualInvestmentTransaction
```

### Critical observation

**`Account.plaidItemId` is non-null.** Any account that lives in the
primary `Account` table must belong to a `PlaidItem`. That's a real
coupling problem for a non-Plaid provider.

The escape hatch that already exists: `ManualInvestmentAccount` is a
parallel hierarchy with `source: String` as a discriminator. Today used
for `"plaid"` (when reading from live Plaid investments) and `"manual"`
(CSV imports). It has its own transaction/holding tables.

### Routes (Plaid)

```
POST /api/plaid/link-token
POST /api/plaid/exchange-public-token
POST /api/plaid/webhook
POST /api/plaid/items/[id]/refresh
DELETE /api/plaid/items/[id]
```

### Lib (Plaid)

`apps/web/lib/plaid.ts` — 1400+ lines. Key exports:
- `createLinkToken()` — new Link session
- `exchangePublicToken()` — accept linked-item token
- `syncTransactionsForLinkedItems()` — pull transactions via cursor
- `syncInvestmentsForLinkedItems()` — pull holdings/investment txns
- `handlePlaidWebhook()` — Plaid → us event ingress
- `disconnectPlaidItem()` — teardown

### UI (Plaid)

- `PlaidLinkButton` (new, `/overview`) — minimal wrapper, client-side
- `PlaidConnectionPanel` (legacy at `/admin`) — everything including CSV import

---

## v1 design: where does SnapTrade plug in?

### Schema decision: separate parallel hierarchy

Mirror the existing Plaid-vs-Manual split. Add three new models:

```
User
 └── SnapTradeUser (1:1, per-user registration)
      ├── snaptradeUserId (unique, their user ID)
      └── snaptradeUserSecret (encrypted, their auth secret)

 └── SnapTradeConnection (1:N, a connected brokerage)
      ├── snapTradeUserId (FK)
      ├── snaptradeAuthorizationId (unique)
      ├── brokerageSlug (e.g. "FIDELITY")
      ├── brokerageName
      ├── status: active|disabled|error
      └── SnapTradeAccount (1:N)
           ├── snaptradeAccountId (unique)
           ├── brokerageAccountNumber
           ├── accountType
           ├── totalValue
           └── — reuses ManualHoldingSnapshot + ManualInvestmentTransaction
             via a `snapTradeAccountId` nullable FK
```

Wait — that's messy. Let me think again.

### Reconsidered: unify investment-account model?

Options:

**Option A.** Add `SnapTradeConnection` + `SnapTradeAccount` models,
parallel to `PlaidItem` + `Account`. SnapTradeAccount has its own
transactions/holdings tables. This is what my first sketch does.

**Option B.** Add `SnapTradeConnection`, and have `ManualInvestmentAccount`
gain an optional FK to `SnapTradeConnection`. This keeps the investment
data model unified (single table for "non-Plaid" accounts).

**Option C.** Refactor `Account.plaidItemId` to be nullable, add a
`source` enum (`plaid | snaptrade | manual`), and an optional
`snapTradeConnectionId` FK. Most unified but biggest schema churn.

### Route decision

```
POST /api/snaptrade/register      — idempotent: ensures SnapTradeUser row
POST /api/snaptrade/connect-url   — generates Connection Portal URL for redirect
GET  /api/snaptrade/callback      — receives ?success=1 after user finishes OAuth
POST /api/snaptrade/sync          — pulls fresh accounts + activities + holdings
POST /api/snaptrade/webhook       — receives ACCOUNT_HOLDINGS_UPDATED etc
DELETE /api/snaptrade/connections/[id] — disconnect
```

### Lib decision

- `packages/snaptrade/` — new workspace package wrapping their SDK
- `apps/web/lib/snaptrade.ts` — our glue layer, analogous to plaid.ts

Use their [official TypeScript SDK](https://github.com/passiv/snaptrade-sdks)
(`snaptrade-typescript-sdk` on npm). Saves us writing the OAuth signing +
pagination from scratch.

### UI decision (user explicitly asked)

Two sub-options:
- **Two buttons**: `+ Connect bank (Plaid)` and `+ Connect brokerage
  (SnapTrade)`
- **One button**: `+ Connect an account`, opens a tiny modal asking which
  provider

I lean **two buttons for v1** because:
- Provider choice is a real thing — Plaid is better for banks/credit,
  SnapTrade is better for brokerages
- Modal adds a click
- Visual honesty about what we're using

But I want to revisit this in self-review.

---

## Self-review #1: what's wrong with v1?

### Issue 1: Schema ambiguity

Having 3 parallel hierarchies (`PlaidItem→Account`,
`SnapTradeConnection→SnapTradeAccount`, `ManualInvestmentAccount`) is
*one too many*. It'll get confusing fast: "wait, is this a Fidelity
account coming through SnapTrade or imported via CSV? How do I query
all the user's investments?"

**Fix:** go with Option B. `ManualInvestmentAccount` stays the home for
all **non-Plaid** investment accounts, gains an optional FK to a new
`SnapTradeConnection`. Rename "Manual" → the existing `source: String`
is already our discriminator. The name is a bit misleading after this
change ("manual" containing SnapTrade-auto-synced data), but we can
rename the Prisma model to `ExternalInvestmentAccount` later; the
table name stays the same to avoid migration pain.

### Issue 2: What about non-investment SnapTrade data?

SnapTrade's primary use is brokerages. But they DO have balance data
for cash/sweep accounts. For a Fidelity Cash Management Account (CMA),
is that a "depository" account or an "investment" account?

**Pragmatic answer:** treat everything SnapTrade returns as an
investment-side account. The `ManualInvestmentBucket` enum already
has `cash`, `taxable`, `retirement`, `other`. SnapTrade cash goes to
`bucket: cash`. User's primary checking at Chase stays on Plaid.

### Issue 3: How does the chat advisor see SnapTrade data?

Today `getInvestmentsSummary()` reads from both Plaid `Account` (where
`type = investment`) and `ManualInvestmentAccount`. If SnapTrade data
lives under `ManualInvestmentAccount`, the advisor sees it automatically.
No changes to `advisor-tools.ts` or `advisor-context.ts`. Huge win.

### Issue 4: Webhook authentication

SnapTrade signs webhooks with HMAC using the consumerKey. I need to
verify the signature. Easy to forget; flagging here.

### Issue 5: How do we handle the redirect flow?

SnapTrade's connect flow:
1. Our backend calls `loginSnapTradeUser` → returns a Connection Portal URL
2. User navigates to that URL (takes them to Fidelity's OAuth)
3. Fidelity redirects back to… where? We need to configure a
   `redirectURI`, similar to Plaid's OAuth return.

We already have `/plaid/oauth-return` which handles this for Plaid.
Need `/snaptrade/oauth-return` that calls back to our
`/api/snaptrade/callback` endpoint.

Actually, SnapTrade handles this better than Plaid: they manage the
OAuth dance internally. After the user finishes at Fidelity, SnapTrade
redirects them to OUR configured `customRedirect` URL (or their own
Connection Portal confirmation page). We just need a simple
confirmation page, not a token exchange.

---

## v2 design: revised

### Schema (final shape)

New models:
```prisma
model SnapTradeUser {
  id                   String   @id @default(cuid())
  userId               String   @unique  // 1:1 with our User
  snaptradeUserId      String   @unique
  snaptradeUserSecretEncrypted String
  registeredAt         DateTime @default(now())
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  connections          SnapTradeConnection[]
}

model SnapTradeConnection {
  id                      String   @id @default(cuid())
  userId                  String   // denormalized for cascading
  snapTradeUserId         String
  authorizationId         String   @unique
  brokerageSlug           String
  brokerageName           String
  status                  SnapTradeConnectionStatus @default(active)
  disabledReason          String?
  lastSyncedAt            DateTime?
  lastHoldingsUpdatedAt   DateTime?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
  user                    User                      @relation(fields: [userId], references: [id], onDelete: Cascade)
  snapTradeUser           SnapTradeUser             @relation(fields: [snapTradeUserId], references: [id], onDelete: Cascade)
  accounts                ManualInvestmentAccount[]
  
  @@index([userId, status])
}

enum SnapTradeConnectionStatus {
  active
  disabled
  error
}
```

Modified: `ManualInvestmentAccount` gains optional FK
```prisma
model ManualInvestmentAccount {
  // ... existing fields ...
  snapTradeConnectionId    String?
  snapTradeAccountId       String?  @unique
  snapTradeConnection      SnapTradeConnection? @relation(fields: [snapTradeConnectionId], references: [id], onDelete: SetNull)
}
```

The `source: String` field (currently "plaid" | "manual") gets a new value
`"snaptrade"`. When `source == "snaptrade"`, `snapTradeConnectionId` and
`snapTradeAccountId` should be set.

### Data mapping

| SnapTrade field | Our field |
|---|---|
| `user.userId` | `SnapTradeUser.snaptradeUserId` |
| `user.userSecret` | `SnapTradeUser.snaptradeUserSecretEncrypted` |
| `account.id` | `ManualInvestmentAccount.snapTradeAccountId` |
| `account.name` | `ManualInvestmentAccount.name` |
| `account.number` | `ManualInvestmentAccount.accountKey` (use snaptrade:<id>) |
| `account.institution_name` | derived from connection |
| `account.balance.total.amount` | updated via holdings sync |
| `activity.id` | `ManualInvestmentTransaction.rowFingerprint` |
| `activity.type` | `ManualInvestmentTransaction.type` (buy/sell/dividend/fee/transfer) |
| `activity.amount` | `.amount` |
| `activity.units` | `.quantity` |
| `activity.price` | `.price` |
| `activity.symbol.raw_symbol` | `.symbol` |
| `activity.symbol.description` | `.name` |
| `activity.trade_date` | `.date` |
| `activity.currency.code` | `.isoCurrencyCode` |

### Routes (final)

```
POST /api/snaptrade/register
POST /api/snaptrade/connect-url       returns { redirectURI }
GET  /snaptrade/return                 thank-you page, invokes sync, redirects to /overview
POST /api/snaptrade/sync               idempotent refetch
POST /api/snaptrade/webhook            HMAC-verified
DELETE /api/snaptrade/connections/[id]
```

### Lib (final)

```
packages/snaptrade/
  src/
    index.ts           re-exports the minimal surface
    client.ts          wraps snaptrade-typescript-sdk with our auth
    types.ts           typed subset we use

apps/web/lib/
  snaptrade.ts         glue: registerUser, getConnectionUrl, syncConnection,
                       persistAccounts, persistActivities
```

### UI (final decision)

Refactor to **one** `+ Connect an account` button (primary CTA). Opens
a small modal:

```
 ┌──────────────────────────────────────────────┐
 │  Connect an account                     [×]  │
 │                                              │
 │  ┌─────────────────────┐ ┌─────────────────┐ │
 │  │ Bank                │ │ Brokerage       │ │
 │  │ Checking, credit    │ │ Fidelity, etc.  │ │
 │  │ [Connect via Plaid] │ │ [Connect via    │ │
 │  │                     │ │  SnapTrade]     │ │
 │  └─────────────────────┘ └─────────────────┘ │
 │                                              │
 │  Or [Import CSV] from an investment account  │
 └──────────────────────────────────────────────┘
```

**Why one button:** cleaner surface, explains the provider choice to the
user at the moment of action (instead of making them guess which button
to press). The modal doesn't hide complexity; it exposes the choice
clearly right when it matters.

---

## Self-review #2: v2 weaknesses?

### Issue 1: SnapTradeUser auto-registration

Do I create the `SnapTradeUser` row the first time the user clicks
connect, or eagerly at user-signup? Lazy is fine but means the first
connect takes an extra API call (register → connect-url). That's OK.

### Issue 2: `ManualInvestmentAccount.accountKey` unique constraint

Currently `accountKey` is `@unique`. If I use `snaptrade:<id>` format,
two users syncing the same Fidelity account would collide. Wait no —
each user has a distinct `snaptradeAccountId` even for the same
institution account (SnapTrade mints a fresh ID per registration).

Actually let me re-read: the `@unique` is global, not per-user. That's
a problem even for manual imports today if two users import the same
Fidelity export. Looking at the current code, CSV imports use
`snap: {source}:{file-hash}:{account-number}` style keys. So the
uniqueness is by construction, not by design. Safe.

For SnapTrade I'll use `snaptrade:<snaptradeAccountId>` which is
guaranteed unique by SnapTrade.

### Issue 3: What about disconnect?

When a user disconnects via Fidelity (revokes SnapTrade's access at
Fidelity's dashboard), SnapTrade sends `CONNECTION_DELETED` webhook.
We should mark the connection `disabled` but keep historical
transaction data. This is the equivalent of Plaid's ITEM_LOGIN_REQUIRED.

### Issue 4: Rate limits

SnapTrade free tier = 250 req/min. Their docs recommend calling the
refresh endpoint sparingly. My sync logic should:
- Call `listUserAccounts` (cheap, cached)
- Call `getAccountActivities` per account with pagination
- Call `getAccountHoldings` per account
- Don't call `refreshBrokerageAuthorization` unless explicitly requested
  (it costs extra on paid plans)

### Issue 5: "Just use the button to connect Fidelity" — the concrete user flow

1. User on `/overview` clicks `+ Connect an account`
2. Modal opens, user clicks `Connect via SnapTrade` under Brokerage
3. Our `/api/snaptrade/connect-url` is called:
   - Ensures `SnapTradeUser` exists (registers if not)
   - Calls SnapTrade's `loginSnapTradeUser` with our `customRedirect` set to
     `https://{host}/snaptrade/return`
   - Returns the Connection Portal URL
4. Client navigates to that URL
5. User goes through Fidelity OAuth
6. SnapTrade redirects back to `/snaptrade/return?success=1`
7. Return page triggers `POST /api/snaptrade/sync` to pull fresh data
8. Return page redirects to `/overview` which now shows the Fidelity account

Critical: the sync step 7 is what makes the flow feel "complete" — user
lands back and immediately sees their Fidelity data. If sync is slow,
show a spinner.

### Issue 6: Build+deploy implications

- **npm dep**: `snaptrade-typescript-sdk` — need to verify it's MIT, no surprises
- **Env vars**: `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`,
  `SNAPTRADE_WEBHOOK_SECRET`
- **Need to register a dev SnapTrade account** — user has to do this (can't
  do from a terminal agent)

---

## Final v2 → v3 tweaks

### Tweak 1: UI refinement

Actually, I want to reconsider the modal. The legacy behavior was two
separate buttons. Looking at the aesthetic goal ("simple and intuitive"),
I think the right answer is:

- **One primary button `+ Connect an account`**, opens the modal
- The modal has **three explicit paths** labeled by what the user is
  connecting, not by the provider:
  - "Connect my bank accounts" → Plaid (for checking/savings/credit)
  - "Connect my brokerage" → SnapTrade (for Fidelity/Schwab/etc)
  - "Import CSV" → existing CSV flow
- Under each option, a small byline mentioning the provider, for honesty

This matches the mental model better. The user thinks "I want to connect
my Fidelity account" not "I want to use SnapTrade."

### Tweak 2: Don't actually add `snapTradeAccountId` as FK to ManualInvestmentAccount

The `snapTradeAccountId` string is enough because it's captured in
`accountKey` as `snaptrade:<id>`. No need for a separate FK. Keeps the
schema simpler.

### Tweak 3: Where to store `SnapTradeConnection` auth secret

SnapTrade's auth is clientId+consumerKey for API calls, plus a per-user
`userSecret`. The userSecret needs to be encrypted at rest (same as we
do with Plaid access tokens via `ENCRYPTION_KEY`).

---

## Files to create / modify (final list)

### New
```
design/snaptrade-integration-2026-05.md         (this doc)
packages/snaptrade/package.json
packages/snaptrade/src/index.ts                 (SDK wrapper)
packages/snaptrade/src/types.ts
packages/snaptrade/tsconfig.json
apps/web/lib/snaptrade.ts                       (business-logic glue)
apps/web/app/api/snaptrade/register/route.ts
apps/web/app/api/snaptrade/connect-url/route.ts
apps/web/app/api/snaptrade/sync/route.ts
apps/web/app/api/snaptrade/webhook/route.ts
apps/web/app/api/snaptrade/connections/[id]/route.ts
apps/web/app/snaptrade/return/page.tsx
apps/web/components/overview/connect-account-modal.tsx
packages/db/prisma/migrations/NNN_add_snaptrade/migration.sql
```

### Modified
```
packages/db/prisma/schema.prisma                 (add SnapTradeUser + SnapTradeConnection)
packages/db/src/index.ts                         (re-export enums)
apps/web/components/overview/accounts-list.tsx   (one button → modal)
apps/web/lib/investments.ts                      (InvestmentDataSource + "snaptrade")
apps/web/lib/user.ts                             (maybe helper to get/ensure SnapTradeUser)
apps/web/lib/env.ts                              (SNAPTRADE_CLIENT_ID/CONSUMER_KEY/WEBHOOK_SECRET)
```

### Tests
```
apps/web/lib/snaptrade.test.ts                   (transform helpers; mocked SDK)
```

---

## Risk areas for implementation

1. **SnapTrade SDK quirks**: it's OpenAPI-generated, likely has clunky types.
   Budget time for wrangling.
2. **Webhook HMAC verification**: easy to get wrong, need to test.
3. **SDK bundle size**: Next.js bundles the server package into serverless
   functions. If the SDK is huge, cold starts will slow.
4. **Encryption of userSecret**: must reuse the same ENCRYPTION_KEY pattern
   as Plaid (look at `apps/web/lib/crypto.ts` or wherever).
5. **First-user sync latency**: initial connect sync could take 10-30s for
   accounts with heavy history. Must show a loading state.
6. **No CSRF on /snaptrade/return**: we're trusting SnapTrade's redirect, but
   we should still verify the signed userSecret matches our stored value
   before trusting the callback.

## Deployment checklist

- [ ] Sign up for SnapTrade developer account at https://dashboard.snaptrade.com/signup
- [ ] Record `clientId` and `consumerKey`
- [ ] Set as Vercel env vars (Production + Preview + Development scope)
- [ ] Configure webhook secret
- [ ] Register `https://personal-finance-management-web-two.vercel.app/snaptrade/return`
      as custom redirect URI in SnapTrade dashboard

---

## OK — ready to implement

Plan has been reviewed twice. v2 is the structure I'll build. Next
phase: prerequisites (SnapTrade sign-up + env), then schema migration,
then SDK wrapper, then API routes, then UI.

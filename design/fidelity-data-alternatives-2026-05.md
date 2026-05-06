# Fidelity data access — research and recommendation

_Written May 3 2026 after user reported Plaid could not connect their Fidelity
accounts._

## Why Plaid doesn't work (and isn't likely to improve soon)

Fidelity [publicly stopped allowing screen-scraping](https://newsroom.fidelity.com/pressreleases/fidelity-takes-steps-to-address-screen-scraping/s/2f33bc18-f16d-4b66-9868-626ada9ba32b)
on October 1 2023. Access is now gated behind "Fidelity Access," their
OAuth / tokenized data-sharing program. Aggregators have to be listed
partners; consumers authorize via Fidelity's own login flow (no credentials
shared with the aggregator).

Plaid has some Fidelity support but it's evidently unreliable: Plaid's own
[help center](https://support-my.plaid.com/hc/en-us/articles/4420183317655)
says "In cases where Plaid has previously supported an integration with
a financial institution but can no longer reliably connect or access data,
we may remove an institution from our search flow for a period of time
or indefinitely." Multiple recent user reports match what you're seeing —
Plaid Link search sometimes hides Fidelity entirely, and even when it
shows up, token exchanges fail or produce stale holdings.

This is structurally unlikely to improve because Plaid and Fidelity's
partnership has always been tense (Plaid started as a scraper, Fidelity
pushed back). Unless that dynamic changes, you should plan around Plaid
not being your Fidelity path.

## What else exists, evaluated

| Aggregator | Fidelity support | Pricing (for 1 user) | Data model | Notes |
|---|---|---|---|---|
| **SnapTrade** | ✅ **Official OAuth via Fidelity Access** | **Free** (5 connections on free tier) | Positions, balances, orders, activities | Founded by Passiv (brokerage-specialist). Read-only on Fidelity (no trading — fine for us). Has SDK for TS/Python/Ruby/Go. **Recommended.** |
| Finicity / Mastercard | ✅ Authorized Fidelity Access partner | Enterprise sales only | General banking data | Partnered with Fidelity [since 2018](https://www.mastercard.com/us/en/news-and-trends/Insights/2018/Finicity-and-Fidelity-Investments-Join-Forces-on-Customer-Data-Security.html). Aimed at enterprise — no public self-serve pricing. |
| Akoya | ✅ Authorized | Enterprise | Banking + investment | Spun out of Fidelity itself. Pure B2B. |
| MX Technologies | ✅ Partial | Enterprise | Banking + PFM widgets | Enterprise. Full PFM-widget suite if you want hosted UI. |
| **Manual CSV import** | ✅ Always works | Free | Holdings + transactions | Already implemented in `/admin` — Fidelity lets you export full holdings and transaction CSVs from their website. |
| Direct scraping (puppeteer/playwright) | ⚠️ Works but against ToS | Free | Full access | ToS violation. Will break on login UI changes. [Community projects exist](https://github.com/kennyboy106/fidelity-api). Not recommended. |

## Recommendation: SnapTrade + keep the CSV path

### Primary: SnapTrade as a second connector alongside Plaid

**Why:**
1. It's the only self-serve-priced aggregator that explicitly advertises Fidelity as an integration
2. Free at our scale (1–5 connections, $2/user/mo after that — still trivial)
3. Uses **Fidelity Access OAuth** — no credential sharing, no screen scraping, won't silently break
4. Data model is richer than Plaid for investments: positions, balances, orders, and activities (transactions) all first-class
5. Also supports Robinhood, Schwab, Vanguard, E*TRADE, Interactive Brokers — broader than Plaid's investment coverage
6. SOC 2 Type 2 compliant, bank-level encryption

**What we'd build:**
- `packages/snaptrade/` — thin client wrapping their OpenAPI spec (they publish an
  [OpenAPI YAML](https://github.com/passiv/snaptrade-api-docs))
- `SnapTradeConnection` Prisma model (parallel to `PlaidItem`) linking a user to their
  SnapTrade `userId` + brokerage authorization(s)
- `/api/snaptrade/connect` — generates a Connection Portal URL via `loginSnapTradeUser`
  endpoint; we redirect the user to Fidelity's OAuth flow
- `/api/snaptrade/sync` — pulls holdings + activities via `/accounts/:id/holdings` + `/accounts/:id/activities`
- UI: Overview tab's "+ Connect investments" button opens SnapTrade instead of Plaid's
  investments flow (or we keep both as separate "Connect via..." options)

**Data-model mapping** (SnapTrade → our schema):
- SnapTrade `activity` → `ManualInvestmentTransaction` (we already have this shape for CSV imports, so reuse it)
- SnapTrade `position` → `ManualHoldingSnapshot`
- SnapTrade `account` → `ManualInvestmentAccount` with `source="snaptrade"` (new enum value)

This lets us NOT rename our types: "manual" has always meant "not Plaid," and SnapTrade
is the new "not Plaid" path.

**Effort estimate:** 1–1.5 days. Most of it is the data-model wiring + the connect-redirect
flow. SnapTrade's SDK handles auth/rate-limiting/pagination.

### Secondary: keep CSV import as a fallback

Even with SnapTrade working, keep the CSV import flow at `/admin#manual-import` for:
1. First-time backfills (if SnapTrade only syncs recent months)
2. Debugging (when you want raw transaction control)
3. Users who don't want to OAuth-connect their brokerage at all

This is already working — no additional effort.

## Why not Finicity/Akoya/MX

Both work, but:
- Enterprise-only pricing (probably $500+/mo minimum)
- "Contact sales" dance is a several-week lead time
- MX and Finicity are designed for banks to offer PFM to their customers, not for a
  personal-use app
- SnapTrade covers the same "official Fidelity Access OAuth" transport at $0

If the product ever scales to thousands of users and SnapTrade's per-user pricing becomes
the problem, Finicity or MX becomes worth revisiting. Not before.

## Why not build a scraper

Two reasons:
1. Against Fidelity's ToS (and public commitment to stop screen-scraping). They've
   invested in detection + blocking.
2. Brittle. Every time Fidelity changes their login UI or adds a CAPTCHA, the scraper
   breaks silently. Given that this is a personal finance manager you may show to
   family, the opposite of what you want.

The community repo `kennyboy106/fidelity-api` is interesting engineering but exactly the
kind of thing that works for 3 months then breaks during tax season.

## Proposed sequencing

1. **Unblock you today:** keep using CSV import at `/admin#manual-import` for your
   Fidelity data. We shipped the connect-investments CSV link on the Overview tab in
   Phase D.
2. **Next milestone:** integrate SnapTrade as Week 6 work (~1 day). New
   `/api/snaptrade/connect` button on the Overview tab alongside (or instead of) the
   Plaid investments button.
3. **Later:** evaluate whether Plaid should be deprecated for investments entirely.
   SnapTrade's brokerage coverage is likely broader.

## Open question for you

Do you want to:
- **(a)** Add SnapTrade as a *second* option ("Connect via SnapTrade" for Fidelity,
  Plaid for everything else) — minimally disruptive, keeps both working for brokerages
  where both work, or
- **(b)** Replace Plaid's investments scope entirely with SnapTrade — cleaner UX, less
  code to maintain, but risks breaking users already connected to Plaid brokerages

My recommendation is **(a) initially** so we don't lose any currently-working connections,
then **(b) after** we've validated SnapTrade works well for a few weeks. Safer ramp.

## Files this research should eventually produce

When we build SnapTrade support:
- `packages/snaptrade/src/index.ts` — SDK wrapper
- `apps/web/lib/snaptrade.ts` — our lib-level helpers (analogous to `apps/web/lib/plaid.ts`)
- `apps/web/app/api/snaptrade/connect/route.ts` — generate Connection Portal URL
- `apps/web/app/api/snaptrade/webhook/route.ts` — receive `ACCOUNT_HOLDINGS_UPDATED` pings
- `apps/web/app/api/snaptrade/sync/route.ts` — pull fresh data on demand
- `packages/db/prisma/schema.prisma` — add `SnapTradeConnection` model
- `packages/db/prisma/migrations/NNN_add_snaptrade/` — schema migration

We'd plan this out in full when we're ready to build.

# Portfolio Financial Manager

Open-source personal finance infrastructure for account aggregation, transaction categorization, portfolio analysis, and advisor-style recommendations.

## Why this repo exists

This project is intentionally split into two layers:

1. A deterministic finance platform that ingests Plaid data, normalizes it, stores a durable history, and lets the user review categories.
2. An advisor layer that uses structured tools over that data to generate transparent recommendations.

The first layer is the product. The second layer is only credible if the first layer is clean.

## MVP scope

The MVP is focused on a single user but the schema and packages are structured so that multi-user support is still possible.

### Phase 1

- Connect bank and credit accounts with Plaid Link
- Store Plaid Items and accounts server-side
- Sync depository and credit transactions with `/transactions/sync`
- Review and override categories in a simple UI
- Define user rules for recurring categorization

### Phase 2

- Monthly cash flow summaries
- Production reconnect and disconnect flows for Plaid Items
- Production webhook ingestion for transaction and item events
- Portfolio allocation views
- Investment holdings and investment transaction sync with Plaid Investments
- Recurring income and bill detection
- Emergency fund runway
- Retirement contribution planning inputs

### Phase 3

- Tool-based advisor orchestration
- Saved recommendation runs with inputs and outputs
- Audit-friendly explanations for every recommendation

## Monorepo structure

This repository uses npm workspaces with Turborepo.

```text
apps/
  web/                Next.js UI and API routes
packages/
  db/                 Prisma schema and database client
  finance-core/       Pure finance logic and calculations
  plaid/              Plaid integration layer and data mappers
  ai/                 Advisor contracts, prompts, and tool schemas
workers/
  sync/               Background sync and webhook-triggered jobs
```

## Local setup

1. Use Node `22` or another supported version in the `>=22 <26` range.
2. Copy `.env.example` to `.env`.
3. Fill in your local secrets.
4. Install dependencies with `npm install`.
5. Start Postgres locally.
6. Generate Prisma client with `npm run db:generate`.
7. Run the initial migration with `npm run db:migrate`.
8. Start the web app with `npm run dev:web`.

`npm run dev` starts the full Turborepo dev graph, including the sync worker. For day-to-day local Plaid and UI work, `npm run dev:web` is the stable path.

## Current Plaid flow

The current app supports:

- `POST /api/plaid/link-token` to create a Plaid Link token
- `POST /api/plaid/exchange-public-token` to exchange a public token and persist the Plaid Item plus linked accounts
- `POST /api/transactions/sync` to pull new and changed transactions with `/transactions/sync`
- `POST /api/plaid/items/:plaidItemId/refresh` to refresh accounts and resume sync after Plaid update mode
- `DELETE /api/plaid/items/:plaidItemId` to remove a linked Item from Plaid and delete it locally
- `POST /api/plaid/webhook` to receive Plaid transaction and item webhooks

The frontend currently supports:

- linking a new institution
- reconnecting an Item with Plaid update mode
- disconnecting an Item
- reviewing and editing transaction categories
- creating merchant-based categorization rules
- AI-assisted transaction categorization for the next 50-100 uncategorized rows
- monthly cash flow summaries
- recurring inflow and outflow detection
- a nightly daily-review digest that can email you a review link or ping a webhook at a scheduled local hour

The current implementation assumes a single bootstrap user derived from `DEFAULT_USER_EMAIL`. That keeps Item and account persistence deterministic until application auth is added.

## Manual Fidelity import fallback

If Plaid Investments is enabled but Fidelity still returns `Connectivity not supported`, the app now has a manual CSV import path in the `Investments groundwork` section.

What it supports today:

- Fidelity transaction-history CSV imports
- Fidelity holdings snapshot CSV imports
- manual account metadata so you can tag the import as `retirement`, `taxable`, or `other`
- deduped re-imports for transactions
- same-day holdings replacement for a clean current snapshot
- merged display in the same investments summary cards, holdings list, and recent investment transactions table

Recommended local folder for exports:

- `/Users/devrai/Downloads/personal_finance_management/imports/fidelity/`

Included starter templates:

- [fidelity-transactions-template.csv](/Users/devrai/Downloads/personal_finance_management/imports/fidelity/fidelity-transactions-template.csv)
- [fidelity-holdings-template.csv](/Users/devrai/Downloads/personal_finance_management/imports/fidelity/fidelity-holdings-template.csv)

Suggested mapping for your current Fidelity accounts:

- `Individual Brokerage Account` -> `Taxable`
- `Roth IRA` -> `Retirement`
- `401(k)` -> `Retirement`
- `BrokerageLink 401(k)` -> `Retirement`

Recommended workflow:

1. Export a Fidelity CSV.
2. Save it in `imports/fidelity/`.
3. Open the app and go to `Investments groundwork`.
4. Choose `Transactions CSV` or `Holdings snapshot CSV`.
5. Fill in the account name, subtype, and bucket.
6. Preview the import before committing it.
7. Import it and refresh the investments summary.

## AI review loop

The current app can run an LLM review pass over uncategorized transactions and store:

- the suggested category
- confidence
- short reasoning
- the model used
- when the suggestion was made

Auto-assignment is intentionally conservative. Higher-confidence suggestions are applied directly and marked `auto_categorized`; weaker suggestions stay uncategorized so the user can validate them manually.

For the daily review loop:

- Vercel cron runs hourly
- the app checks `DAILY_REVIEW_TIMEZONE` and `DAILY_REVIEW_HOUR_LOCAL` internally
- at the scheduled local hour, the app auto-categorizes that day’s uncategorized transactions
- it persists a `DailyReviewDigest`
- it can optionally send an email with a review link using Resend
- it can optionally send a webhook ping using `DAILY_REVIEW_WEBHOOK_URL`

Recommended env settings for this feature:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` default `gpt-4.1-mini`
- `GEMINI_API_KEY` optional fallback or primary key
- `GEMINI_MODEL` default `gemini-2.5-flash`
- `DAILY_REVIEW_TIMEZONE` default `America/Los_Angeles`
- `DAILY_REVIEW_HOUR_LOCAL` default `20`
- `RESEND_API_KEY` optional email delivery key
- `DAILY_REVIEW_EMAIL_TO` optional destination email
- `DAILY_REVIEW_EMAIL_FROM` optional verified sender
- `DAILY_REVIEW_EMAIL_REPLY_TO` optional reply-to address
- `DAILY_REVIEW_WEBHOOK_URL` optional
- `DAILY_REVIEW_WEBHOOK_BEARER_TOKEN` optional
- `CRON_SECRET` for the Vercel cron endpoint

## Production checklist

Before testing a real OAuth institution like Capital One or Bank of America:

1. Deploy the app to a real `https://` URL.
2. Set `NEXT_PUBLIC_APP_URL` to that deployed origin.
3. Set `PLAID_ENV=production`.
4. Set `PLAID_SECRET` or `PLAID_PRODUCTION_SECRET` to your production secret.
5. Set `PLAID_REDIRECT_URI` to `https://<your-domain>/plaid/oauth-return`.
6. Add that redirect URI to the Plaid Dashboard allowlist.
7. Set `PLAID_WEBHOOK_URL` if your webhook URL differs from `NEXT_PUBLIC_APP_URL + /api/plaid/webhook`.
8. Keep `PLAID_PRODUCTS="transactions"` until you are ready to pay for `investments`.
9. Add `OPENAI_API_KEY` and/or `GEMINI_API_KEY` if you want AI categorization in production.
10. Add `CRON_SECRET`, `DAILY_REVIEW_TIMEZONE`, and `DAILY_REVIEW_HOUR_LOCAL` before enabling nightly review pings.

The first real-institution test should be one account only. That keeps reconnect, webhook, and disconnect behavior easy to inspect before you broaden coverage.

## GitHub setup

Create an empty GitHub repository in your profile before the first push.

Recommended settings:

- Visibility: `Public`
- Initialize with README: `No`
- Initialize with .gitignore: `No`
- Initialize with license: `No`

That avoids merge noise because this repo already includes those starter files. Choose a license before publishing the first tagged release. If you want permissive reuse, `MIT` is the simplest option.

Example:

```bash
git init
git add .
git commit -m "Initial scaffold"
git branch -M main
git remote add origin git@github.com:<your-username>/personal_finance_management.git
git push -u origin main
```

## Implementation order

1. Finalize schema and migration strategy.
2. Implement Plaid token exchange and item storage.
3. Implement transaction sync and webhook ingestion.
4. Build transaction review and category rules UI.
5. Build advisor tools on top of normalized data.

## Security baseline

- No API secrets are committed
- Secrets are loaded from environment variables only
- Plaid access tokens should be encrypted before persistence
- Recommendation runs are stored so advice is auditable
- The app should never place trades or move funds automatically

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

- Connect bank, credit, and investment accounts with Plaid Link
- Store Plaid Items and accounts server-side
- Sync depository and credit transactions with `/transactions/sync`
- Sync investment holdings and investment transactions with Plaid Investments
- Review and override categories in a simple UI
- Define user rules for recurring categorization

### Phase 2

- Monthly cash flow summaries
- Portfolio allocation views
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
8. Start the app with `npm run dev`.

## Current Plaid flow

The first backend slice supports:

- `POST /api/plaid/link-token` to create a Plaid Link token
- `POST /api/plaid/exchange-public-token` to exchange a public token and persist the Plaid Item plus linked accounts

The current implementation assumes a single bootstrap user derived from `DEFAULT_USER_EMAIL`. That keeps Item and account persistence deterministic until application auth is added.

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

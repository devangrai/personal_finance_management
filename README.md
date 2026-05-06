# Personal Finance Manager

An open-source, AI-powered personal finance platform with an agentic advisor that learns from your conversations, documents, and financial data.

## What it does

- **Agentic financial advisor** — 6 specialist agents (spending, goals, portfolio, tax, retirement, general) routed by an LLM classifier. Each specialist has tools to query your data, save facts, and update goals. The advisor remembers what you tell it across sessions.
- **Account aggregation** — Plaid (banks, credit cards) + SnapTrade (brokerages) integrations. Transactions sync automatically via webhooks.
- **Document intelligence** — Upload tax returns, W-2s, comp statements, brokerage statements. Gemini Vision extracts structured facts; pgvector-powered RAG lets the advisor search document contents for specific details.
- **Budget vs actual** — Monthly budgets per category with blended projections (MTD pace + trailing 3-month history), recurring-expected forecasting, and a cash-outflow summary for credit-card-autopay users.
- **Net worth tracking** — Real-time aggregation of cash + investments + manual assets − debts. Daily snapshots build a time-series chart. Manual entry for items not on Plaid (home value, private loans, vehicles).
- **Conversational memory** — Every chat turn runs a background fact extractor that detects personal facts (income, state, goals, obligations) and auto-applies or stages them for review. The advisor gets smarter over time without you filling out forms.
- **Proactive nudges** — Weekly cron surfaces 1-2 observations: spending anomalies, goal check-ins, budget alerts, cash drag. Delivered as an Insights widget on the chat page.
- **Multi-user** — Invite-gated signup. Each user has fully isolated data, memory, and advisor context. Admin UI for minting invites.
- **Daily review email** — Nightly auto-categorization of new transactions + anomaly detection, emailed as an HTML digest.

## Tech stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript
- **Backend**: Next.js API routes + server actions
- **Database**: PostgreSQL (Neon) with Prisma ORM + pgvector for embeddings
- **AI**: Google Gemini (Flash for routing/extraction, Pro for deep reasoning, Embedding for RAG)
- **Integrations**: Plaid (banking), SnapTrade (brokerage), Resend (email), Vercel Blob (document storage)
- **Deployment**: Vercel (serverless + crons)
- **Testing**: Vitest (146+ tests), custom regression gate (eval-v1, eval-v2, scripted simulations)

## Monorepo structure

```
apps/
  web/                  Next.js app (UI + API routes + crons)
packages/
  db/                   Prisma schema, migrations, client
  finance-core/         Pure finance calculations
  plaid/                Plaid integration layer
  ai/                   Advisor contracts, prompts, tool schemas
workers/
  sync/                 Background sync jobs
scripts/                CLI utilities (invite, reset-password, backfill, etc.)
simulations/            Regression test runner + scripted scenarios
docs/                   Operational documentation
```

## Key pages

| Route | Purpose |
|-------|---------|
| `/overview` | Dashboard with account balances, recent transactions |
| `/net-worth` | Total net worth breakdown + chart + manual assets/liabilities |
| `/budget` | Monthly budget grid with projections + cash outflow |
| `/flow` | Sankey diagram of money movement |
| `/chat` | Conversational advisor with session history |
| `/context` | Personal context editor, goals, lessons, extracted facts |
| `/documents` | Upload + view financial documents with extracted facts |
| `/admin/invites` | Mint signup invites for family/friends |

## Local setup

```bash
# Prerequisites: Node 20+, PostgreSQL 16+ with pgvector, pnpm or npm

# Clone and install
git clone https://github.com/devangrai/personal_finance_management.git
cd personal_finance_management
npm install

# Set up environment
cp .env.example .env
# Fill in: DATABASE_URL, GEMINI_API_KEY, PLAID_CLIENT_ID, PLAID_SECRET, etc.

# Database
cd packages/db
npx prisma migrate dev
cd ../..

# Run
npm run dev
# App runs at http://localhost:3000
```

## Environment variables

See `.env.example` for the full list. Key ones:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection (pooled) |
| `DATABASE_URL_UNPOOLED` | PostgreSQL connection (for migrations) |
| `GEMINI_API_KEY` | Google AI API key |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Plaid credentials |
| `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY` | SnapTrade credentials |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for document storage |
| `RESEND_API_KEY` | Email delivery |
| `ENCRYPTION_KEY` | Token signing (password reset, etc.) |
| `NEXTAUTH_SECRET` | NextAuth session encryption |

## Testing

```bash
npm test              # 146+ vitest tests
npm run regression    # Full regression gate (eval-v1, eval-v2, scripted sims)
```

## Cron jobs

| Schedule | Path | Purpose |
|----------|------|---------|
| Daily 03:00 UTC | `/api/cron/daily-review` | Transaction categorization + email digest |
| Daily 03:15 UTC | `/api/cron/snapshot-net-worth` | Net worth daily snapshot |
| Daily 04:30 UTC | `/api/cron/stage-lessons` | Cluster agent runs into candidate lessons |
| Sunday 14:00 UTC | `/api/cron/generate-nudges` | Weekly proactive insights |

## License

MIT

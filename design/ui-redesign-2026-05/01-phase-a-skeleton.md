# Phase A — Skeleton

## Goal
Add top-level tab routing without breaking anything that exists today. The
old monolithic panel stays live at `/legacy` throughout phases B-E so no
functionality is lost mid-migration.

## Scope
1. New Next.js pages: `/overview`, `/flow`, `/chat`, `/context`, `/legacy`
2. Root `/` redirects to `/overview`
3. New `<AppShell>` + `<AppNav>` components wrap all pages with a shared
   top header + tab bar
4. Each new tab renders a "coming in phase X" placeholder card so the app
   is not broken at any point
5. `/legacy` renders the current `PlaidConnectionPanel` unchanged

## Non-goals
- No changes to `AdvisorChat`, `PlaidConnectionPanel`, or any backend route
- No new business logic
- No component extraction out of `plaid-connection-panel.tsx` — that
  happens later in phases D and E

## Files modified
- `apps/web/app/layout.tsx` — wrap in `<AppShell>`
- `apps/web/app/page.tsx` — convert to server-side redirect
- `apps/web/app/legacy/page.tsx` — NEW, renders old panel
- `apps/web/app/overview/page.tsx` — NEW, placeholder
- `apps/web/app/flow/page.tsx` — NEW, placeholder
- `apps/web/app/chat/page.tsx` — NEW, placeholder
- `apps/web/app/context/page.tsx` — NEW, placeholder
- `apps/web/components/app-shell.tsx` — NEW
- `apps/web/components/app-nav.tsx` — NEW
- `apps/web/app/globals.css` — add tabNav styles + sans font variable

## `<AppShell>` contract
```tsx
<AppShell>
  {/* page content */}
</AppShell>
```
Renders:
- Header bar with product name (`PFM`) on the left, user menu placeholder
  on the right
- `<AppNav />` below the header
- `<main className="shell">` wrapper for children (same width constraints
  as today's `.shell` class)

## `<AppNav>` contract
```tsx
<AppNav /> // reads pathname from next/navigation
```
- Four tabs in order: Overview / Flow / Chat / Context
- Active tab has underline + accent color
- Uses Next `<Link>` — preserves SPA navigation
- Small `Legacy` link at far right during migration (dim, tiny), removed
  in Phase F

## Placeholder page template
```tsx
export default function OverviewPage() {
  return (
    <section className="card">
      <p className="eyebrow">Coming in Phase D</p>
      <h2>Overview</h2>
      <p className="panelCopy">
        Accounts, balances, this-week cash flow, and recent transactions
        will live here. In the meantime, use the{" "}
        <Link href="/legacy">legacy view</Link>.
      </p>
    </section>
  );
}
```

## CSS additions (globals.css)
```css
:root {
  --font-sans: -apple-system, "Inter", system-ui, sans-serif;
}

.appHeader {
  display: flex;
  justify-content: space-between;
  padding: 1rem 0;
  font-family: var(--font-sans);
}

.tabNav {
  display: flex;
  gap: 1.5rem;
  border-bottom: 1px solid var(--line);
  padding-bottom: 0.5rem;
  margin-bottom: 2rem;
  font-family: var(--font-sans);
}

.tabNavItem {
  color: var(--muted);
  text-decoration: none;
  padding-bottom: 0.65rem;
  border-bottom: 2px solid transparent;
}

.tabNavItemActive {
  color: var(--ink);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
```

## Acceptance
- `/` → `/overview` (302)
- Each of `/overview`, `/flow`, `/chat`, `/context` renders a placeholder
  card with "coming in Phase X" + link back to legacy
- `/legacy` renders the current full panel, unchanged
- `/plaid/oauth-return` still works (no regression to Plaid linking)
- Tabs are keyboard-navigable
- `npm test` still 32/32
- `next build` succeeds

## Effort estimate
2-3 hours.

# Phase F — Retire legacy panel

## Goal
Delete `plaid-connection-panel.tsx` (3,893 lines) and the `/legacy` route.
Ship a single-purpose, tabbed product.

## Preconditions
- Phases A-E merged and working
- The dev/ops bits from the legacy panel (Operations console, AI rules
  suggestions, Recent-pay-periods debug view, Paycheck allocation
  scenarios) have a home — either:
  - Ported to a hidden `/admin` route (`?admin=1` or localStorage flag)
  - Rendered inside Overview with small "show dev info" collapsible
  - Genuinely deleted (if not used in > 2 weeks)
- No remaining imports of `plaid-connection-panel` or `advisor-chat` (v1)

## Scope

### Admin view (NEW, for dev bits)
Create `apps/web/app/admin/page.tsx` that renders a subset of the legacy
panel's ops sections:
- Operations console (connection status, daily review trigger,
  simulation runner)
- Agent stats dashboard (use existing `/api/advisor/stats`)
- Suggested AI rules (from legacy panel)
- Raw paycheck/flow debug (from legacy panel)

Gate it: `/admin` is visible only when a localStorage flag is set, or
when the URL has `?admin=1`. Add a subtle link in `AppNav` that only
shows to developers (feature-detect).

### Removals
```
DELETE apps/web/components/plaid-connection-panel.tsx
DELETE apps/web/components/advisor-chat.tsx     (v1, after AdvisorChatV2 lives)
DELETE apps/web/app/legacy/page.tsx
```

### Cleanups
- Remove `legacy` link from `<AppNav>`
- Remove `.missionShell`, `.missionCard`, `.flowLane`, `.opsPanel`, and
  other now-unused CSS classes (run `grep -r` to confirm zero references
  before deleting)
- Prune any now-dead imports (`react-plaid-link` usage should consolidate
  in one place, not five)
- Prune any route handlers that only the legacy panel called (verify by
  grep)

### Documentation
- Add `apps/web/README.md` section: "Pages and where to find things"
  with a one-line map of each tab → the main component + data source
- Archive this `design/ui-redesign-2026-05/` folder into
  `design/archive/` once shipped (leave as-is, it's the history)

## Files changed
Mostly deletions. Estimate: net -5,000 LOC.

## Acceptance
- No references to `plaid-connection-panel` anywhere
- No references to the v1 `advisor-chat` except in git history
- `/` redirects to `/overview` (still)
- All four tabs still render their intended content
- `/admin` renders when flag set; 404 otherwise (or at least a "not
  found" placeholder)
- `npm test` passes (32+ tests)
- `next build` succeeds
- Smoke test on prod deploy: `/overview`, `/flow`, `/chat`, `/context`
  all return 200 and useful content

## Effort estimate
Half a day (4 hours). Most of it is triple-checking nothing depends on
the legacy panel before deleting.

## Risk
Accidentally deleting a component that something else depends on. Mitigation:
1. Run `grep -r "plaid-connection-panel" apps/web/` before deletion —
   should be 0 hits except `/legacy/page.tsx`
2. Run `next build` after each removal
3. Keep this phase as a dedicated git commit so it's one-step revertible

## Open questions
None — this phase is mechanical.

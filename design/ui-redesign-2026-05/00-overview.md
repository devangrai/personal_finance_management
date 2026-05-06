# UI Redesign — May 2026

## Why
The current `plaid-connection-panel.tsx` (3,893 lines, one file) renders the
entire product on one scroll. "Operations console" dev tools are mixed with
end-user views, the chat is still on narrative mode instead of the agent,
and Week 5's memory infrastructure is invisible.

## Decisions (captured from conversation)
- Four top-level tabs: **Overview / Flow / Chat / Context**
- User = just you for now, maybe show family/friends — keep polish
- Flow diagram: both categories-of-flow AND account-to-account views (toggle)
- Personal context = freeform text field; LLM extraction to structured facts
  is deferred
- Keep existing cream/teal/gold palette. Add a clean sans for body density.

## Phases (ship-order, smallest first)
| # | Phase | Doc | Ship impact |
|---|---|---|---|
| A | Skeleton: routing + nav + legacy redirect | `01-phase-a-skeleton.md` | Zero user-visible change, unblocks everything |
| B | Context tab | `02-phase-b-context.md` | Makes Week 5 lesson system real; biggest small-lift win |
| C | Chat tab (agent mode + memory chips) | `03-phase-c-chat.md` | Exposes the agentic architecture |
| D | Overview tab | `04-phase-d-overview.md` | Replaces the kitchen-sink home page |
| E | Flow tab | `05-phase-e-flow.md` | The Grafana-style visualization |
| F | Retire legacy panel | `06-phase-f-retire-legacy.md` | Delete 3,893 lines, ship |

## Non-goals for this redesign
- Multi-user auth — deferred
- Mobile responsiveness — desktop-first, responsive later
- New charting library beyond what Flow tab needs — don't add until Phase E
- Landing page / marketing site — deferred
- Removing any backend endpoints — UI-only changes except small paper-cuts

## Design system touch-ups (small, applies across all phases)
- Keep CSS variables from `globals.css` (palette, shadow, radius)
- Add `--font-sans: -apple-system, "Inter", system-ui, sans-serif`
- Apply serif only to `h1/h2` + hero; body + lists + chat use sans
- Introduce `.tabNav`, `.tabNavItem`, `.tabNavItemActive` utility classes
- Introduce `.card` (standalone), distinct from `.panel` (full-width section)

## File layout (target)
```
apps/web/
  app/
    layout.tsx             -- wraps everything in <AppShell>
    page.tsx               -- redirects to /overview
    overview/page.tsx      -- Phase D
    flow/page.tsx          -- Phase E
    chat/page.tsx          -- Phase C
    context/page.tsx       -- Phase B
    legacy/page.tsx        -- old panel, Phases A-E
    plaid/oauth-return/    -- unchanged
    api/...                -- unchanged
  components/
    app-shell.tsx          -- header + tabs + main container
    app-nav.tsx            -- tab nav component
    // Phase B
    context/
      personal-context-editor.tsx
      goals-list.tsx
      goal-form.tsx
      lessons-panel.tsx
      quick-facts-grid.tsx
    // Phase C
    chat/
      advisor-chat-v2.tsx        -- replaces advisor-chat.tsx
      message-bubble.tsx
      specialist-chip.tsx
      lessons-applied-badge.tsx
      pending-candidates-banner.tsx
    // Phase D
    overview/
      net-worth-card.tsx
      week-summary-card.tsx
      accounts-list.tsx
      recent-transactions.tsx
      sync-actions.tsx
    // Phase E
    flow/
      flow-canvas.tsx
      flow-node.tsx
      flow-edge.tsx
      flow-toggle.tsx            -- categories / accounts toggle
      flow-time-control.tsx
  lib/                     -- unchanged
```

# Phase C — Chat tab

## Goal
Replace the 180-line `advisor-chat.tsx` with a purposeful chat surface
that uses the agent architecture (Weeks 3-5) and makes the memory layer
visible. Default to agent mode. Show what specialist answered, what
tools ran, and which lessons applied.

## Scope

### New UI — `apps/web/app/chat/page.tsx`
Server component that renders:
- `<PendingCandidatesBanner />` (only if there are pending candidates)
- `<AdvisorChatV2 suggestedPrompts={...} />`

That's it. Chat is the whole tab — no other stuff competing for attention.

### `<AdvisorChatV2>`
Rewrite. Keep the visual style (warm bubbles, prompt chips) but add:

**Request changes**
- POST to `/api/advisor/chat?mode=agent&debug=1` (not bare
  `/api/advisor/chat`)
- Response type expanded to include `debug.specialists[]`, `routerTier`,
  `specialistsInvoked`

**Bubble additions**
- Below each assistant message, a thin "meta row" with:
  - Specialist chip: `[ retirement-pacer ]` styled as a small pill
  - Tool count: `2 tools` (compact text)
  - Lessons applied badge: `1 lesson applied` (only if > 0; clickable)
- Click "lessons applied" → small popover lists the applied lesson(s)

**Suggested prompts**
- Default set when conversation is empty
- Swap to response's `followUps` after first turn (existing logic)

**Error handling**
- If all providers fail, show an inline error but keep the composer
  enabled so the user can retry
- If the response has `debug.specialists[].stoppedReason === "provider_error"`,
  surface that as a subtle warning chip

### `<PendingCandidatesBanner>`
Thin banner at the top of the Chat tab, visible only when
`/api/lessons?status=pending` returns candidates:

```
┌────────────────────────────────────────────────────────────────┐
│ ⏳ 3 patterns ready for your review  →  [ Review in Context ] │
└────────────────────────────────────────────────────────────────┘
```

Clicking → `/context#lessons`. Small, muted styling — informational, not
demanding.

## Files

New:
```
apps/web/components/chat/advisor-chat-v2.tsx
apps/web/components/chat/message-bubble.tsx
apps/web/components/chat/specialist-chip.tsx
apps/web/components/chat/lessons-applied-badge.tsx
apps/web/components/chat/pending-candidates-banner.tsx
apps/web/components/chat/lessons-applied-popover.tsx
```

Modified:
```
apps/web/app/chat/page.tsx               -- replaces placeholder
apps/web/app/api/advisor/chat/route.ts   -- extend debug payload to
                                            include `appliedLessons`
                                            per specialist
```

Deleted:
```
apps/web/components/advisor-chat.tsx     -- after Phase F, when no longer
                                            used by legacy panel
```

## Backend change needed

Add to the `debug` object returned when `?debug=1`:
```ts
debug: {
  specialists: [{
    specialist: "retirement-pacer",
    appliedLessons: [
      { id: "...", topic: "retirement", summary: "..." }
    ],
    toolCalls: 2,
    // ...existing fields
  }]
}
```

This data already exists inside `runSpecialist` — we note which lessons
were applied via `noteLessonApplied` during retrieval. We just need to
carry the lesson list through to the response.

Concrete plumbing:
1. `runSpecialist` already pulls lessons via `getRelevantLessons`. Return
   them alongside `AgentRunResult`.
2. `runAdvisorAgent` propagates them to the chat route.
3. Chat route includes them in `debug.specialists[i].appliedLessons`.

## Design polish

### Specialist chip palette
Map each specialist to a soft accent color:
- `spending-coach` → warm gold tint
- `goal-tracker` → teal
- `portfolio-analyst` → deep teal
- `tax-planner` → muted purple (add one new color to palette)
- `retirement-pacer` → deeper gold
- `general-advisor` → neutral gray

Small subtle differentiation — helps the user build intuition about
what's happening without reading labels every time.

### Meta row styling
```css
.metaRow {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 0.5rem;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 0.82rem;
}

.specialistChip {
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-weight: 600;
  /* per-specialist bg via CSS var */
}
```

## Acceptance
- `/chat` shows the pending banner (when candidates exist) + chat
- Asking a question triggers `mode=agent`; specialist chip appears below
  the answer
- When a graduated lesson is applied, "1 lesson applied" badge renders
  and expands on click
- Pending banner links to `/context` with the lessons section expanded
  (anchor link or query param)
- `npm test` passes; add tests for:
  - `<MessageBubble>` renders specialist chip when metadata present
  - `<MessageBubble>` renders lessons badge only when count > 0
- `next build` succeeds

## Effort estimate
4-5 hours.

## Open questions
1. Persist chat history across page reloads? Today it's in-memory. I'd
   suggest localStorage for MVP, migrating to server-side chat sessions
   later.
2. Show the FULL trace (tool args/results) behind a "details" toggle, or
   keep that admin-only? I'd suggest admin-only (`?debug=full`) to keep
   the UI clean.
3. Specialist palette — does adding a purple break your brand? Can swap
   tax-planner to a brown/rust from your existing warm palette.

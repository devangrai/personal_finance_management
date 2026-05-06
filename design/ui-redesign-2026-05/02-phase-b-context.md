# Phase B — Context tab

## Goal
Make the Week 5 memory infrastructure visible and editable. Add a freeform
"personal context" text area so the user can tell the advisor about their
life once, and the advisor reads it every turn.

## Why first
- Smallest net-new engineering (mostly reads existing APIs)
- Highest user-visible impact of any phase
- Validates the tabs direction before bigger investments (Flow)
- Immediately makes Phase C (chat) more compelling because there's
  actually stuff to apply

## Scope

### New UI — `apps/web/app/context/page.tsx`
Four stacked sections, top-to-bottom:

1. **Personal context** (prose)
2. **Goals** (structured, with progress bars)
3. **What the advisor has learned** (read-only + pending approvals)
4. **Quick facts** (key/value grid, editable)

## Section details

### 1. Personal context
- Single large `<textarea>` with markdown-lite support (newlines render as paragraphs)
- Sits above-the-fold — it is the most important thing on this tab
- Explanatory footnote: *"The advisor reads this at the start of every
  conversation."*
- Stored as a single `UserFact` row with `factKey="personal_context"` and
  `factValue` = `{"text": "...", "updatedAt": "..."}`
- Autosave with 800ms debounce, or explicit save button. Prefer debounce +
  "saved" toast.

Component: `<PersonalContextEditor />`

Data flow:
- `GET /api/facts?key=personal_context` returns the current value (or null)
- `POST /api/facts` with `{factKey: "personal_context", factValue: {...},
  source: "manual"}` writes it

Backend plumbing needed (small):
- Update `buildAdvisorContextFactSheet` (in `advisor-context.ts`) to read
  the `personal_context` fact and include it in the narrative passed to
  every specialist. Make it show up as the FIRST line in the primer so
  it's always top-of-mind.

### 2. Goals
- List of active goals with progress bars
- Each goal has an inline "edit" pencil and a delete (confirm before delete)
- "+ Add goal" button opens a small modal with fields:
  - Label (string)
  - Target amount (number, optional)
  - Target date (date, optional)
  - Commitment (multiline, optional)
- Uses existing `GET /api/goals`, `POST /api/goals`, `PATCH/DELETE
  /api/goals/[goalId]`

Component: `<GoalsList />` + `<GoalForm />`

Progress bar math: uses existing `get_goal_progress` tool's output — we
hit `GET /api/goals?withProgress=1` (need to add `withProgress` param to
existing route, or create a new `/api/goals/progress` endpoint).

### 3. What the advisor has learned
Two sub-sections:

**Patterns confirmed** (AgentLesson rows)
- Small cards, one per graduated lesson
- Each shows: topic badge, action-or-caveat text, how many times applied,
  graduation date
- Data: `GET /api/lessons?agent=1`

**Pending for your review** (CandidateLesson rows where status=pending)
- Same card style but with action buttons: Accept · Reject · Not now
- Accept → prompts for 1-line rationale → `POST /api/lessons/:id/graduate`
- Reject → prompts for 1-line rationale → `POST /api/lessons/:id/reject`
- Not now → no API call, just hides locally (reappears on reload)
- Data: `GET /api/lessons` (pending already filtered)

Components: `<LessonsPanel />`, `<GraduateDialog />`, `<RejectDialog />`

### 4. Quick facts grid
- 2-column grid of key/value pairs for structured UserFacts
- Pencil icon opens inline edit
- A small "+ add fact" button at the bottom
- Filters out `personal_context` (shown in section 1) from the grid

Component: `<QuickFactsGrid />`

Data: existing `GET /api/facts` + `POST /api/facts`.

## Files

New:
```
apps/web/app/context/page.tsx                            -- server component
apps/web/components/context/personal-context-editor.tsx  -- client
apps/web/components/context/goals-list.tsx               -- client
apps/web/components/context/goal-form.tsx                -- client
apps/web/components/context/lessons-panel.tsx            -- client
apps/web/components/context/quick-facts-grid.tsx         -- client
apps/web/components/context/graduate-dialog.tsx          -- client
apps/web/components/context/reject-dialog.tsx            -- client
```

Modified:
```
apps/web/lib/advisor-context.ts          -- inject personal_context into
                                            every primer
apps/web/app/api/facts/route.ts          -- add ?key= filter + single-row
                                            upsert by factKey
apps/web/app/api/goals/route.ts          -- add ?withProgress=1 or create
                                            /api/goals/progress
```

Also modified:
```
apps/web/app/context/page.tsx            -- replaces placeholder from
                                            Phase A
```

## Backend changes needed

### `advisor-context.ts`
Add to the `narrative` string construction: if a `personal_context` fact
exists for the user, prepend:
```
USER-PROVIDED CONTEXT:
  {text}
```
right after the greeting/date stamp. This text is what makes the
freeform prose actually reach every specialist.

One test: add a vitest in `advisor-context.test.ts` (new file) asserting
that given a fake user with `personal_context` fact, the narrative
contains the text.

### `/api/facts` — single-key upsert
The current `POST /api/facts` probably requires the full payload. Make it
idempotent by `factKey`: if a row exists with the same `userId + factKey`,
update it. (Prisma model already has `@@unique([userId, factKey])`.)

## Design polish
- Use `.card` class (new, inner-section sibling of `.panel`) — white
  rounded 20px, subtle border, 1.5rem padding
- Section separators: 2rem gap between the four sections
- Sans-serif body throughout; keep serif on section headers (h2)
- Empty states for each section:
  - Personal context empty → placeholder copy "Tell the advisor a bit
    about yourself. Example: *I live rent-free at home, Bay Area, I'd
    like to retire by 55.*"
  - Goals empty → "No goals yet. Add one to start tracking."
  - Lessons empty → "The advisor hasn't learned any patterns yet. Keep
    chatting — patterns emerge after a few conversations."
  - Facts empty → "No structured facts yet."

## Acceptance
- `/context` renders all four sections without errors on the prod schema
- Writing personal context persists to `UserFact` and round-trips
- Starting a chat turn after setting personal context includes that text
  in the agent primer (verified via `?debug=1`)
- Clicking "Accept" on a pending candidate creates an AgentLesson row
- Autosave works on personal-context textarea (visible "saved X seconds
  ago" indicator)
- `npm test` still passes; add ~3 new tests for personal_context injection
- `next build` succeeds

## Effort estimate
1 working day (8 hours) including polish.

## Open questions
1. Personal context field size cap? I'd suggest 4000 chars (~500 words) —
   generous but bounded. Clip silently on save with a subtle warning?
2. When the advisor updates personal context via tool (we could add a
   tool later), should it bump `updatedAt` and show a small notification
   here? Deferred but worth noting.
3. Should quick facts have a "source" badge (profile/manual/extracted)?
   Nice-to-have; keep it for polish pass.

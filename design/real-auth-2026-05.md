# Real auth design — 2026-05-03

## Summary

Replace the `getOrCreateDefaultUser()` default-user pattern with actual
email+password authentication via Auth.js (NextAuth v5). Every request
resolves a user from the session cookie. Unauthenticated requests get
redirected to `/login` for pages, or 401 for API routes.

This is security-critical. Current state: anyone on the internet can
hit `/overview` and see all your financial data.

---

## Constraints learned from the audit

| Constraint | Why it matters |
|---|---|
| **95 call sites of `getOrCreateDefaultUser`/`getDefaultUserId`** | Can't rewrite all 95 by hand cleanly — need a one-spot-change pattern |
| **User model already exists** with FK relations to every data table | Good — no schema-scale refactor needed, just add a `passwordHash` |
| **Cron endpoints** (`/api/cron/*`) are auth'd by `CRON_SECRET` bearer token | Must NOT require user session; they run as Vercel's scheduled invocation |
| **Webhooks** (`/api/plaid/webhook`, `/api/snaptrade/webhook`) auth via HMAC signature | Must NOT require user session; they're called by Plaid/SnapTrade servers |
| **Email action endpoint** (`/api/daily-review/action/[transactionId]`) auth'd by HMAC token in URL | Must NOT require user session; users click from email, no cookie guaranteed |
| **Plaid OAuth return** (`/plaid/oauth-return`) needs to work during OAuth flow | Pre-session redirect path — must work anonymously |
| **SnapTrade return** (`/snaptrade/return`) same story | Same treatment |

## The user-resolution problem

Today: `getOrCreateDefaultUser()` looks up `owner@example.com` everywhere.
Post-auth: needs to return the session's user. But **these functions are
called from both request contexts (API routes, server components) AND
non-request contexts (cron jobs, utility scripts).**

That's the critical tension. The fix is **two separate functions**:

```ts
// From a request context (API route, server component). Throws if no session.
async function getSessionUser(): Promise<{ id: string; email: string }>

// For cron / background jobs — requires a userId to be provided explicitly.
// No default. Callers pass whichever user they're operating on.
async function getUserById(userId: string): Promise<User>
```

Then grep-replace `getOrCreateDefaultUser()` → `getSessionUser()` in
request-scoped code, and thread `userId` through cron/background code.

But 95 call sites is too many to do by hand. Pragmatic compromise for
v1: keep `getOrCreateDefaultUser()` as a shim that now returns
`getSessionUser()` behind the scenes when called in a request context,
and returns the first-ever user (or throws) when called from cron. This
gives us security-correct behavior without a 95-file rewrite.

**Decision:** shim pattern. Gradually migrate to explicit
`getSessionUser()` / `getUserById()` over time.

---

## Data model changes

### Add `passwordHash` to existing `User` model
```prisma
model User {
  // ... existing fields ...
  passwordHash    String?          // nullable for legacy rows + OAuth users later
  emailVerified   DateTime?        // matches Auth.js convention
  authAccounts    AuthAccount[]    // Auth.js adapter's external identities
  authSessions    AuthSession[]    // session records
}
```

### Three new tables for Auth.js Prisma adapter

**Important naming decision:** Auth.js adapter's default tables are
called `Account`, `Session`, `VerificationToken` — but we ALREADY have
an `Account` model (Plaid-linked bank accounts). Collision. Rename
adapter tables: `AuthAccount`, `AuthSession`, `AuthVerificationToken`.

```prisma
model AuthAccount {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model AuthSession {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AuthVerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime
  @@unique([identifier, token])
}
```

### Rationale for not using JWT sessions

Auth.js supports either JWT sessions (no DB) or database sessions.
JWT is slightly faster but makes logout harder (can't revoke), requires
managing a `NEXTAUTH_SECRET`, and needs careful handling when session
contents change. Database sessions are cleaner for our single-user
case and let us invalidate sessions server-side.

**Decision:** database sessions via Prisma adapter.

---

## Route categorization — who needs auth?

Every route in the app falls into one of four buckets:

| Bucket | Auth method | Routes |
|---|---|---|
| **Public anonymous** | None | `/login`, `/signup`, `/forgot-password`, `/reset-password/[token]`, `/api/auth/*` |
| **Public with signed payload** | HMAC / bearer token | `/api/cron/*` (CRON_SECRET), `/api/plaid/webhook` (Plaid sig), `/api/snaptrade/webhook` (SnapTrade sig), `/api/daily-review/action/[id]` (HMAC token), `/snaptrade/return`, `/plaid/oauth-return` |
| **User-scoped** | Session cookie | Everything else: `/`, `/overview`, `/flow`, `/chat`, `/context`, `/admin`, all `/api/advisor/*`, `/api/transactions/*`, `/api/accounts/*`, `/api/plaid/items/*`, `/api/plaid/link-token`, `/api/plaid/exchange-public-token`, `/api/snaptrade/connect-url`, `/api/snaptrade/register`, `/api/snaptrade/sync`, `/api/snaptrade/connections/*`, `/api/facts`, `/api/goals`, `/api/lessons/*` (except `/api/lessons/stage` which is cron), `/api/cashflow/*`, `/api/flow`, `/api/overview/*`, `/api/categories`, `/api/recurring/*`, `/api/investments/*`, `/api/daily-review/run`, `/api/daily-review/preview`, `/api/daily-review/latest`, `/api/sim/*`, `/api/sync/all`, `/api/transaction-rules/*`, `/api/profile`, `/api/advisor/plan`, `/api/advisor/retirement` |
| **Admin-only** | Session cookie + isAdmin flag (deferred) | None currently — everything I build is for a single user |

Middleware logic:
```ts
// apps/web/middleware.ts
if (path.startsWith("/api/auth/")) return NextResponse.next();
if (path.startsWith("/api/cron/")) return NextResponse.next(); // cron uses CRON_SECRET
if (path.startsWith("/api/plaid/webhook")) return NextResponse.next();
if (path.startsWith("/api/snaptrade/webhook")) return NextResponse.next();
if (path.startsWith("/api/daily-review/action/")) return NextResponse.next(); // HMAC
if (path === "/plaid/oauth-return" || path === "/snaptrade/return") {
  return NextResponse.next();
}
if (["/login", "/signup", "/forgot-password"].includes(path) || path.startsWith("/reset-password/")) {
  return NextResponse.next();
}
if (path.startsWith("/_next/") || path === "/favicon.ico") return NextResponse.next();

// Everything else: require session.
const session = await auth(); // Auth.js handler
if (!session?.user?.id) {
  if (path.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", req.url));
}
return NextResponse.next();
```

---

## Login/signup UX

### /login
- Email + password fields
- Submit → `POST /api/auth/callback/credentials`
- On success → redirect to `/overview`
- On failure → inline error
- Link to /forgot-password
- Small text: "No account? Sign up" → /signup

### /signup
Decision: **signup is gated by an env flag** `ALLOW_SIGNUPS=true|false`
(default false in prod). You, as the first user, sign up while the flag
is true, then I flip it off. Future users admitted explicitly.

- Email + password + password confirm
- POST to new `/api/auth/signup` (we add, Auth.js doesn't ship this)
- Validates: email format, password ≥ 8 chars, passwords match
- Sends verification email via Resend
- Creates user row with `emailVerified = null`
- On success → redirect to `/verify-email-sent` (info page)

### /forgot-password
- Email field
- POST to `/api/auth/forgot-password`
- Always returns 200 (don't leak whether email exists)
- If email matches, sends reset link via Resend with signed token
- Redirect to /reset-email-sent

### /reset-password/[token]
- Password + confirm fields
- POST to `/api/auth/reset-password` with token + new password
- Verifies token (HMAC check, expiry 1 hour)
- Updates passwordHash, invalidates all sessions for that user
- Redirect to /login

### /verify-email/[token]
- Server-side GET route; verifies token, sets `emailVerified = now()`, redirects to /login

---

## Seeding the existing data

Critical: my prod DB already has **real data** tied to `owner@example.com`
— my 401k info, Fidelity accounts, advisor facts, personal context, etc.
I can't lose any of that.

Plan:
1. After migration, the owner@example.com User row still exists but has
   no passwordHash
2. First time *I* hit /signup with `devang.rai@gmail.com`, a NEW User row
   would be created — orphaning all my existing data under owner@example.com
3. **Wrong outcome.**

The fix: either
(a) Update owner@example.com's email to devang.rai@gmail.com + set a
passwordHash via a one-shot admin endpoint, OR
(b) Have /signup detect "first-ever signup in empty-of-auth-ed-users db"
and attach to the owner row instead of creating a new one, OR
(c) Migration script that manually sets passwordHash on owner row

**Decision:** (c). Write a one-shot script
`scripts/attach-admin-password.ts` that I run once with
`ADMIN_EMAIL=devang.rai@gmail.com ADMIN_PASSWORD=<temp>` env — it updates
owner@example.com → my email, sets hashed password, marks
emailVerified. Then I log in with that password and change it via
settings later.

---

## Session → User resolution

```ts
// apps/web/lib/auth.ts (new)
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcrypt";
import { prisma } from "@portfolio/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: String(creds.email).toLowerCase() }
        });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(String(creds.password), user.passwordHash);
        if (!ok) return null;
        if (!user.emailVerified) return null; // require verified email
        return { id: user.id, email: user.email ?? undefined };
      }
    })
  ],
  pages: { signIn: "/login" }
});
```

Then update `apps/web/lib/user.ts`:
```ts
import { auth } from "./auth";

export async function getOrCreateDefaultUser() {
  const session = await auth();
  if (!session?.user?.id) {
    // This should never happen in request-scoped code protected by
    // middleware. If it does, we throw rather than silently falling
    // back to a default user (which would be the old insecure behavior).
    throw new Error("No authenticated user (called outside request context?).");
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id }
  });
  if (!user) throw new Error("Session user not found in DB.");
  return user;
}
```

But wait — **cron and simulation code ALSO call `getOrCreateDefaultUser()`**.
That'll break them.

Fix: add an env-controlled escape hatch. When `NEXT_RUNTIME_TRUSTED === "cron"`
(set by cron handler before calling), fall back to looking up the first user.

Actually that's ugly. Better:

```ts
export async function getOrCreateDefaultUser() {
  // Express cron path: if there's no request context, fall back to
  // first user (must be only one or the cron route should iterate).
  try {
    const session = await auth();
    if (session?.user?.id) {
      return await prisma.user.findUniqueOrThrow({
        where: { id: session.user.id }
      });
    }
  } catch {
    // auth() throws in non-request contexts — that's fine, we fall through
  }
  // No session = cron or test path. Return the first user (single-user
  // app; will need `for each user` loops if we ever add more).
  return await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
}
```

This keeps backward compat for cron (still fetches "the user") while
making request-path security tight.

**Concern:** if someone ever manages to call this function from a
request path while the session is invalid (not just unauthenticated),
they'd get the first user silently. Not great.

**Mitigation:** middleware enforces auth BEFORE any route handler runs.
If middleware lets the request in, session is valid. If it doesn't, the
handler never runs. So the insecure fallback path can't be hit from a
request.

**Edge:** Server Components. They run server-side during page render.
Middleware runs before them, so same guarantee. Good.

---

## Env additions

```
NEXTAUTH_SECRET=<random 32-byte>   # or AUTH_SECRET in v5
NEXTAUTH_URL=https://...            # Next figures this out from headers in most cases
ALLOW_SIGNUPS=false                 # flip to true during initial setup, then off
```

Resend-based email templates reuse existing `RESEND_API_KEY` +
`DAILY_REVIEW_EMAIL_FROM`.

---

## Files created/modified (final list)

### New
```
apps/web/lib/auth.ts                                  (NextAuth setup)
apps/web/middleware.ts                                (route gating)
apps/web/app/login/page.tsx
apps/web/app/signup/page.tsx
apps/web/app/forgot-password/page.tsx
apps/web/app/reset-password/[token]/page.tsx
apps/web/app/verify-email/[token]/page.tsx
apps/web/app/api/auth/[...nextauth]/route.ts          (NextAuth handler)
apps/web/app/api/auth/signup/route.ts                 (new: signup)
apps/web/app/api/auth/forgot-password/route.ts        (new)
apps/web/app/api/auth/reset-password/route.ts         (new)
apps/web/components/auth/*.tsx                        (forms)
apps/web/lib/auth-emails.ts                           (verify/reset email builders)
apps/web/lib/auth-tokens.ts                           (signed reset/verify token helpers, 1h TTL)
apps/web/lib/password.ts                              (bcrypt wrapper)
apps/web/lib/rate-limit.ts                            (in-memory per-IP limiter for login)
scripts/attach-admin-password.ts                      (one-shot seed for existing owner user)
packages/db/prisma/migrations/NNN_add_auth/...
```

### Modified
```
apps/web/lib/user.ts                                  (session-aware resolver)
apps/web/app/layout.tsx                               (drop AppShell for unauthed pages? or keep)
apps/web/components/app-shell.tsx                     (show Logout button in nav when authed)
apps/web/components/app-nav.tsx                       (hide if unauthed)
packages/db/prisma/schema.prisma                      (add auth models + passwordHash)
packages/db/src/index.ts                              (export new types)
apps/web/lib/env.ts                                   (ALLOW_SIGNUPS, NEXTAUTH_SECRET)
```

### Dependencies
```
next-auth@5.0.0-beta.x              (v5 works with App Router + Prisma adapter)
@auth/prisma-adapter@latest
bcrypt + @types/bcrypt
```

---

## Rollout plan (for the actual deploy)

1. **Build + test locally first.** Start dev server, create an account,
   log in, verify each tab works post-auth.
2. **Run migration against prod DB.** Adds `passwordHash`/`emailVerified`
   (nullable) + 3 new tables. Fully additive.
3. **Run `attach-admin-password.ts` against prod** to set my password
   on the owner row and update email to mine.
4. **Set env vars on Vercel**: `NEXTAUTH_SECRET` (new random), `ALLOW_SIGNUPS=false`
5. **Deploy** with `vercel --prod --yes --force`
6. **Immediately test login** from the new prod deploy
7. **Verify unauth redirect**: hit `/overview` in an incognito window,
   should redirect to `/login`
8. **Verify cron still works**: trigger `POST /api/daily-review/run` via
   a fetch with the existing cron pattern — should work (it has
   no user session requirement since it's exposed to cron, but wait —
   it's also called by the admin UI which does need a session. Check
   this.)

## Self-review #1 — what's wrong?

### Issue 1: `/api/daily-review/run` is called from both cron AND the admin UI

Looking at the route:
```ts
// apps/web/app/api/daily-review/run/route.ts
export async function POST(request: NextRequest) {
  // ... runDailyReviewCycle with force: true
}
```

It's ALSO hit by the admin "Run now" button. So gating it entirely on
cron-secret breaks the UI path. And gating it entirely on session-auth
means cron can't run it.

**Fix:** support BOTH. If `authorization: Bearer <CRON_SECRET>` header
is present and matches, allow. Otherwise fall back to session check.
This dual-mode pattern is already used for `/api/cron/daily-review`
which ONLY accepts CRON_SECRET.

Actually simpler: the cron trigger is at `/api/cron/daily-review`, NOT
`/api/daily-review/run`. The latter is only UI. So just gate
`/api/daily-review/run` on session and leave `/api/cron/*` open in
middleware. ✅

### Issue 2: Client-side fetch calls won't send cookies by default

All the fetch() calls in client components need `credentials: "include"`.
Wait — no, same-origin fetch sends cookies automatically. Only
cross-origin requires it. All my fetches are same-origin. Good.

### Issue 3: The `ALLOW_SIGNUPS` flag is a footgun

If I flip it on, forget, and deploy — anyone can sign up. Better:
bake into the env-load code a warning. Or remove the /signup page
entirely once I'm done, and add users via a script only.

**Decision:** Keep `ALLOW_SIGNUPS=false` default. Add a boot-time
log warning if true. For now, I'll sign up via a script, not the UI.
Remove `/signup` UI path — too risky given this is security work.

**Revised:** no signup page. Only login + forgot-password. User
creation is via `scripts/create-user.ts` (admin-only). Much cleaner,
much more secure default posture.

### Issue 4: Email verification flow not strictly needed for single user

Since I'm creating my own account via a script, I can mark
`emailVerified = new Date()` in the same script. No email verification
loop needed for MVP. If I ever add multi-user, bring this back.

**Decision:** skip email verification for v1. Just require `passwordHash`
present + any User row.

### Issue 5: Password reset via email still matters even for single-user

If I forget my password, I need to recover. **Keep** `/forgot-password`
and `/reset-password/[token]`. Uses Resend to send the reset link,
HMAC-signed token, 1-hour expiry.

### Issue 6: Plaid/SnapTrade OAuth return pages

When Plaid/SnapTrade send the user back after OAuth, the user is
already authenticated (they were logged in before clicking "Connect").
So the return pages just need to work post-session. But if the session
expired during OAuth (which takes 2-10 minutes), they'll land on an
unauthed page.

**Fix:** return pages don't need to be in the "anonymous allowed"
list — they can require session. If session expired, user sees
/login?next=/overview and re-auths.

Actually wait — the return URLs are configured in the Plaid/SnapTrade
dashboards. If the return URL is protected and the user has a session,
everything works. If their session expired, they go to /login and
hit "Open dashboard" after. So they don't lose their connection — the
OAuth side already succeeded; they'd just need to manually trigger sync
on the next login. That's actually fine.

**Decision:** return pages require auth. Add to protected list.

### Issue 7: SnapTrade sync endpoint is called from the return page

`/snaptrade/return` calls `POST /api/snaptrade/sync` client-side after
OAuth completion. That endpoint should require session (because it
operates on one user's data). ✅ already in the session-required list.

### Issue 8: The HMAC token in email-action links is the auth

`/api/daily-review/action/[id]?a=accept&t=<token>` — token IS the
auth. No user session needed. Middleware lets it through. ✅

But: the action handler uses `getOrCreateDefaultUser()` indirectly via
the Prisma user FK — does it? Let me check...

Actually no, it uses the `subject` (txn id) directly, looks up the
transaction, and updates it without touching user functions. ✅

---

## Self-review #2 — another critical pass

### Issue 9: I haven't thought about logout

Auth.js provides `signOut()`. Add a Logout button in AppShell nav.
Post-logout, redirect to /login.

### Issue 10: CSRF

Auth.js v5 has built-in CSRF protection for its own routes. For my
custom POST routes (signup, forgot-password, reset-password), I should
add CSRF tokens or use double-submit cookies.

**Pragmatic decision:** skip explicit CSRF protection on the custom
auth routes for v1. They're safe because:
- signup (if re-added): creates a new row. No existing user is at risk.
- forgot-password: sends an email to the provided address. Attacker
  can't intercept the email.
- reset-password: requires a valid signed token from a specific email.

For future multi-user, I'll add proper CSRF on sensitive endpoints
(transaction deletes, etc.) but that's post-MVP.

### Issue 11: "Magic link" alternative

Auth.js supports email-only magic links as an alternative to passwords.
Easier UX, no password to remember. Downside: every login requires
checking email. For a primary-use daily-check-in app, that's annoying.

**Decision:** stick with password. Magic link is nice for
password-reset path though — that's already how the reset flow works.

### Issue 12: Rate limiting

Brute-force protection for login. Vercel edge has no built-in rate
limiter. Options:
- Upstash Redis (paid)
- Vercel KV (paid)
- In-memory (dies on every cold start — useless)
- Just Auth.js's built-in throttling

**Decision:** Auth.js CredentialsProvider doesn't rate-limit by default.
Add a minimal in-memory limiter keyed on `x-forwarded-for` IP. It's
imperfect (cold starts reset the counter) but better than nothing. The
real solution is an external rate limiter; it's fine for single-user
to skip.

### Issue 13: Session storage on Vercel Edge

Auth.js with database sessions needs to reach Postgres from every
request. Vercel serverless already has that — Prisma connections pool.
No issue.

### Issue 14: The bcrypt cold-start on Vercel

bcrypt in Node takes ~50ms to hash. Not a problem, but **bcrypt is a
native binary that Vercel may have trouble bundling**. Alternative:
`@node-rs/argon2` or `argon2-browser` which work better.

**Pragmatic:** use `bcryptjs` (pure JS, no native bindings). Slightly
slower than `bcrypt` native but works everywhere without issues.

**Decision:** `bcryptjs`.

### Issue 15: Can't log in because session cookie isn't set on first redirect

Classic bug with Auth.js: `signIn()` from a client component returns
but the cookie isn't immediately visible to the redirected page. Fix:
use Auth.js's `redirectTo` option or server action pattern.

Auth.js v5 server actions handle this cleanly:
```tsx
"use server";
import { signIn } from "@/lib/auth";
export async function loginAction(formData: FormData) {
  await signIn("credentials", {
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: "/overview"
  });
}
```

### Issue 16: Existing `/api/cron/daily-review` auth check

It does `authHeader !== 'Bearer ' + env.cronSecret`. If I accidentally
nuke that, cron breaks. **Don't touch `/api/cron/*` at all** in
middleware — just pass-through. Verified in the route list.

### Issue 17: `/admin` page

Today `/admin` is the legacy panel, accessible to anyone in the app.
Post-auth, it still requires session but doesn't require any special
admin flag. For single-user that's fine; my session = admin. If I
ever add more users, add `User.isAdmin` and gate /admin on it.

---

## Final v3 — what I'll actually build

**Scope cuts from v1/v2:**
- No /signup UI (user creation via script)
- No email verification loop (script sets emailVerified)
- No separate /verify-email page
- No explicit CSRF protection (Auth.js handles its own; my custom routes
  are safe enough for v1)

**Kept:**
- /login + /forgot-password + /reset-password/[token]
- Database sessions via Prisma adapter
- bcryptjs for hashing
- Middleware protecting all non-public routes
- Script to seed my own user onto the owner@example.com row

**Files I'll actually create:**
```
apps/web/lib/auth.ts                                 NextAuth config
apps/web/lib/user.ts                                 (MODIFIED) session-aware
apps/web/lib/password.ts                             bcryptjs wrapper
apps/web/lib/auth-tokens.ts                          signed 1h reset tokens
apps/web/lib/auth-emails.ts                          reset email template
apps/web/lib/rate-limit.ts                           in-memory limiter
apps/web/middleware.ts                               route gating
apps/web/app/login/page.tsx
apps/web/app/forgot-password/page.tsx
apps/web/app/reset-password/[token]/page.tsx
apps/web/app/api/auth/[...nextauth]/route.ts
apps/web/app/api/auth/forgot-password/route.ts
apps/web/app/api/auth/reset-password/route.ts
apps/web/components/auth/login-form.tsx
apps/web/components/auth/forgot-password-form.tsx
apps/web/components/auth/reset-password-form.tsx
apps/web/components/auth/auth-shell.tsx              (minimal header for login pages)
apps/web/components/app-shell.tsx                    (MODIFIED) Logout button
scripts/create-or-update-user.ts                     seed my user
packages/db/prisma/schema.prisma                     (MODIFIED)
packages/db/prisma/migrations/NNN_add_auth/...
```

---

## Implementation order

1. ✅ Design doc (done)
2. Install next-auth@beta + @auth/prisma-adapter + bcryptjs
3. Schema migration (add passwordHash, emailVerified, AuthAccount, AuthSession, AuthVerificationToken)
4. apps/web/lib/auth.ts (NextAuth setup)
5. apps/web/lib/password.ts
6. apps/web/lib/auth-tokens.ts
7. apps/web/lib/user.ts — update getOrCreateDefaultUser to be session-aware with cron fallback
8. apps/web/app/api/auth/[...nextauth]/route.ts
9. apps/web/middleware.ts
10. /login page + form + server action
11. /forgot-password page + route
12. /reset-password/[token] page + route
13. Logout button in AppShell
14. create-or-update-user.ts script
15. Vitest for password hashing + token signing
16. Deploy (local test first, then prod)

---

## Risk & rollback plan

- **Migration is additive** — `passwordHash` nullable, new tables. Rolling back means rolling back the Vercel deploy and nulling the column; data intact.
- **If login breaks after deploy:** `vercel rollback` to previous deploy. All my data stays safe because schema changes were additive.
- **If I lock myself out:** run the seed script again with a fresh password. It updates the existing row.
- **If cron breaks:** middleware should let `/api/cron/*` through without touching. Verified in my route map.

---

## Ready to build.

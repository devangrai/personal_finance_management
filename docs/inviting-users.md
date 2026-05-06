# Inviting new users

The app is invite-gated: anyone can see `/signup`, but they can't create an
account without a valid invite code. Codes are single-use and expire in 7
days by default.

## Two ways to invite

### A. Admin UI (easiest)

1. Sign in as an admin (`isAdmin = true` on the User row).
2. Open `/admin/invites`.
3. Enter the invitee's email, click **Mint invite**.
4. Copy the generated URL.
5. Send the URL to the invitee via text, email, iMessage, Signal — any channel.

That's it. The invitee clicks the URL, enters a password, gets a verification
email, clicks the verify link, and logs in.

### B. CLI (backup / bulk)

If the UI is down or you want to script invites:

```bash
cd ~/pfm-local/personal_finance_management
vercel env pull --environment=production .env.prod.check
set -a; source .env.prod.check; set +a
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export DATABASE_URL="$DATABASE_URL_UNPOOLED"

CREATED_BY_EMAIL=devang.rai@gmail.com \
INVITED_EMAIL=jane@gmail.com \
APP_URL=https://personal-finance-management-web-two.vercel.app \
npx tsx scripts/create-invite.ts

rm -f .env.prod.check
```

The script prints a URL. Send it to the invitee the same way.

**What each line does:**

- `vercel env pull` — downloads prod DB credentials so the script writes the
  invite row to *production*, not your local dev DB.
- `source .env.prod.check` — loads those credentials into the shell.
- `DATABASE_URL=$DATABASE_URL_UNPOOLED` — Prisma scripts need the unpooled
  connection string.
- `npx tsx scripts/create-invite.ts` — the actual work. Finds your admin user,
  generates a random 32-char code, inserts a `SignupInvite` row, prints the
  redeemable URL.
- `rm .env.prod.check` — hygiene; don't leave prod creds on disk.

## What the invitee experiences

1. They click the URL → `/signup?code=<code>&email=<email>` page, form
   pre-filled with their email.
2. They enter a password (min 8 chars) and optional display name, click
   **Create account**.
3. They see "Account created. Check your inbox for the verification link."
4. They receive an email from `onboarding@resend.dev` (subject: "Verify your
   PFM account") with a verify button.
5. They click the verify link → `emailVerified` is set → redirect to `/login`.
6. They sign in with the email + password they just set. Welcome.

## Making someone an admin

Only admins can mint invites. To promote someone:

```bash
cd ~/pfm-local/personal_finance_management
vercel env pull --environment=production .env.prod.check
set -a; source .env.prod.check; set +a
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
export DATABASE_URL="$DATABASE_URL_UNPOOLED"

ADMIN_EMAIL=someone@example.com npx tsx scripts/set-admin.ts

rm -f .env.prod.check
```

To demote: add `UNSET=1` before the env vars.

## Troubleshooting

- **Invitee reports they didn't get the verify email.** Check their spam /
  Promotions tab first. Resend's `onboarding@resend.dev` sender lands in
  Gmail spam fairly reliably. Long-term fix: verify a real domain on Resend
  (~10 min of DNS work).
- **"Invite already used" when nobody claimed it.** The invite is single-use.
  If they hit an error during signup, the invite is still burned as long as
  the User row was created (i.e., they got past "Account created" once).
  Mint a new invite.
- **"Invite has expired."** Default TTL is 7 days. Mint a new one.
- **"This invite was issued for a different email address."** The invite is
  locked to `intendedEmail`. If they want to use a different email, mint a
  fresh invite without specifying `INVITED_EMAIL`.
- **Family member can't see `/admin`.** Correct — `/admin` is admin-only. The
  middleware redirects non-admins to `/overview?error=admin_required`.

## Schema reference

```prisma
model SignupInvite {
  id              String    @id @default(cuid())
  code            String    @unique
  intendedEmail   String?   // null = any email, set = locked to that email
  createdByUserId String
  expiresAt       DateTime
  usedAt          DateTime?
  usedByUserId    String?
  note            String?
  createdAt       DateTime  @default(now())
}
```

## Why invite-gated?

Open signup = anyone on the internet gets an account, which means anyone can
call Plaid, call SnapTrade, call Gemini, consume your API quotas, and store
data in your DB. Invite-gating costs about 30 seconds per new user but keeps
the attack surface to zero. Good tradeoff for 2-5 family members.

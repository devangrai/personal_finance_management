import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import {
  consumeSignupInvite,
  validateSignupInvite
} from "@/lib/signup-invites";
import { hashPassword } from "@/lib/password";
import { getErrorMessage } from "@/lib/errors";

/**
 * POST /api/auth/signup
 *
 * Body: { email, password, displayName?, inviteCode }
 *
 * Invite-gated signup. On success the account is created AND
 * immediately considered verified (emailVerified=now()). We don't run
 * an email-verification loop because Resend's free tier can only send
 * to the account owner's address — family/friend signups go through
 * invite links manually instead of email. The passwordConfirm check
 * happens client-side; server enforces length only.
 */

type Payload = {
  email?: string;
  password?: string;
  displayName?: string;
  inviteCode?: string;
};

export async function POST(request: NextRequest) {
  let body: Payload = {};
  try {
    body = (await request.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const displayName = (body.displayName ?? "").trim() || null;
  const inviteCode = (body.inviteCode ?? "").trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email required." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }
  if (!inviteCode) {
    return NextResponse.json(
      { error: "Invite code required. Ask an admin for one." },
      { status: 400 }
    );
  }

  // Validate the invite BEFORE any DB write so a bad code never burns
  // a row or an invite.
  const inviteResult = await validateSignupInvite(inviteCode, email);
  if (!inviteResult.ok) {
    return NextResponse.json({ error: inviteResult.reason }, { status: 400 });
  }

  // Explicit duplicate-email error. With no email-verification loop
  // there's no reason to be coy about whether the email already exists:
  // an invite-gated endpoint leaking "this email is registered" to
  // someone who already has a valid invite for that email is not a
  // meaningful attack.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists. Try signing in." },
      { status: 409 }
    );
  }

  try {
    const hash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        email,
        passwordHash: hash,
        displayName,
        // No email verification loop; treat the invite as sufficient
        // proof of identity and mark verified immediately.
        emailVerified: new Date()
      }
    });

    await consumeSignupInvite({
      inviteId: inviteResult.inviteId,
      userId: created.id
    });

    return NextResponse.json({
      ok: true,
      userId: created.id
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to complete signup.") },
      { status: 500 }
    );
  }
}

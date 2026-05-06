import crypto from "node:crypto";
import { prisma } from "@portfolio/db";

export type InviteCreateResult = {
  code: string;
  url: string;
  expiresAt: Date;
};

export type InviteValidationResult =
  | {
      ok: true;
      inviteId: string;
      intendedEmail: string | null;
    }
  | { ok: false; reason: string };

/**
 * Opaque URL-safe invite code. 32 chars of base64url from 24 random
 * bytes — enough entropy that guessing is infeasible.
 */
function generateCode(): string {
  return crypto
    .randomBytes(24)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createSignupInvite(input: {
  createdByUserId: string;
  intendedEmail?: string;
  ttlDays?: number;
  note?: string;
  appUrl: string;
}): Promise<InviteCreateResult> {
  const code = generateCode();
  const expiresAt = new Date(
    Date.now() + (input.ttlDays ?? 7) * 24 * 60 * 60 * 1000
  );
  await prisma.signupInvite.create({
    data: {
      code,
      createdByUserId: input.createdByUserId,
      intendedEmail: input.intendedEmail?.trim().toLowerCase() ?? null,
      expiresAt,
      note: input.note ?? null
    }
  });
  const url = `${input.appUrl.replace(/\/$/, "")}/signup?code=${code}`;
  return { code, url, expiresAt };
}

/**
 * Look up + check an invite code. Does NOT mark as used — call
 * `consumeSignupInvite` from the signup handler after the user row is
 * created so we never burn an invite on a failed signup.
 */
export async function validateSignupInvite(
  code: string,
  email: string
): Promise<InviteValidationResult> {
  if (!code) return { ok: false, reason: "Invite code missing." };
  const invite = await prisma.signupInvite.findUnique({ where: { code } });
  if (!invite) return { ok: false, reason: "Invite not found." };
  if (invite.usedAt) return { ok: false, reason: "Invite already used." };
  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "Invite has expired." };
  }
  if (
    invite.intendedEmail &&
    invite.intendedEmail !== email.trim().toLowerCase()
  ) {
    return {
      ok: false,
      reason: "This invite was issued for a different email address."
    };
  }
  return {
    ok: true,
    inviteId: invite.id,
    intendedEmail: invite.intendedEmail
  };
}

export async function consumeSignupInvite(params: {
  inviteId: string;
  userId: string;
}): Promise<void> {
  await prisma.signupInvite.update({
    where: { id: params.inviteId },
    data: { usedAt: new Date(), usedByUserId: params.userId }
  });
}

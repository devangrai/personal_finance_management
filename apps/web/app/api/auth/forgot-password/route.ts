import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { getAppEnv } from "@/lib/env";
import { signResetToken } from "@/lib/reset-tokens";

type Payload = { email?: string };

/**
 * Sends a password-reset email if the given address matches a user.
 * ALWAYS returns 200 so callers can't probe for registered emails.
 */
export async function POST(request: NextRequest) {
  let body: Payload = {};
  try {
    body = (await request.json()) as Payload;
  } catch {
    body = {};
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: true }); // silent ok
  }

  const env = getAppEnv();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  const token = signResetToken({
    userId: user.id,
    email,
    secret: env.encryptionKey
  });
  const resetUrl = `${env.appUrl}/reset-password/${encodeURIComponent(token)}`;

  if (env.resendApiKey && env.dailyReviewEmailFrom) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.resendApiKey}`
        },
        body: JSON.stringify({
          from: env.dailyReviewEmailFrom,
          to: [email],
          subject: "Reset your PFM password",
          text:
            `Click the link below to reset your password. It expires in 1 hour:\n\n${resetUrl}\n\n` +
            `If you didn't request a reset, you can ignore this email.`,
          html: `
<div style="font-family:-apple-system,Inter,sans-serif;line-height:1.55;color:#171512;max-width:520px;margin:auto;padding:2rem 1.5rem;">
  <h2 style="margin:0 0 0.6rem;font-family:'Iowan Old Style',Georgia,serif;">Reset your password</h2>
  <p>Click the button below to set a new password. The link expires in 1 hour.</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:0.7rem 1.2rem;background:#163d4a;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;">Reset password</a></p>
  <p style="color:#665d4e;font-size:0.85rem;">If you didn't request this, you can safely ignore this email.</p>
</div>`
        })
      });
    } catch {
      // swallow — we don't want to leak whether send succeeded
    }
  }

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { getAppEnv } from "@/lib/env";
import { verifyResetToken } from "@/lib/reset-tokens";
import { hashPassword } from "@/lib/password";

type Payload = { token?: string; newPassword?: string };

export async function POST(request: NextRequest) {
  let body: Payload = {};
  try {
    body = (await request.json()) as Payload;
  } catch {
    body = {};
  }
  const token = (body.token ?? "").trim();
  const newPassword = body.newPassword ?? "";

  if (!token || !newPassword) {
    return NextResponse.json(
      { error: "Missing token or password." },
      { status: 400 }
    );
  }
  if (newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const env = getAppEnv();
  const verify = verifyResetToken({ token, secret: env.encryptionKey });
  if (!verify.ok) {
    return NextResponse.json(
      { error: `Reset link is invalid: ${verify.reason}` },
      { status: 401 }
    );
  }

  const userId = verify.payload.subject;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json(
      { error: "User not found." },
      { status: 404 }
    );
  }

  const hash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash, emailVerified: user.emailVerified ?? new Date() }
    }),
    // Invalidate all existing sessions so any logged-in devices have to
    // re-auth with the new password.
    prisma.authSession.deleteMany({ where: { userId } })
  ]);

  return NextResponse.json({ ok: true });
}

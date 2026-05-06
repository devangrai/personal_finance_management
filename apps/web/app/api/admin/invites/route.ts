import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { auth } from "@/lib/auth";
import { createSignupInvite } from "@/lib/signup-invites";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET  /api/admin/invites            → list all invites (recent first)
 * POST /api/admin/invites            → mint a new invite
 *        { email?: string, ttlDays?: number, note?: string }
 *
 * Admin-only. Non-admin requests are rejected with 403. Middleware
 * already blocks the `/admin` UI; this API must double-check since
 * API routes aren't included in the middleware admin gate.
 */

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, isAdmin: true, email: true }
  });
  if (!user?.isAdmin) {
    return { ok: false as const, status: 403, error: "Admin required." };
  }
  return { ok: true as const, user };
}

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const invites = await prisma.signupInvite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const now = Date.now();
  return NextResponse.json({
    ok: true,
    invites: invites.map((i) => ({
      id: i.id,
      code: i.code,
      intendedEmail: i.intendedEmail,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
      usedAt: i.usedAt,
      note: i.note,
      status: i.usedAt
        ? "used"
        : i.expiresAt.getTime() < now
          ? "expired"
          : "active"
    }))
  });
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  type Body = { email?: string; ttlDays?: number; note?: string };
  let body: Body = {};
  try {
    body = (await request.json()) as Body;
  } catch {
    // empty body is fine — means "any email, default ttl"
  }

  const intendedEmail = (body.email ?? "").trim().toLowerCase() || undefined;
  const ttlDays =
    typeof body.ttlDays === "number" && body.ttlDays >= 1 && body.ttlDays <= 30
      ? body.ttlDays
      : 7;
  const note = (body.note ?? "").trim().slice(0, 200) || undefined;

  if (intendedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(intendedEmail)) {
    return NextResponse.json(
      { error: "Invalid email address." },
      { status: 400 }
    );
  }

  try {
    const env = getAppEnv();
    const result = await createSignupInvite({
      createdByUserId: gate.user.id,
      intendedEmail,
      ttlDays,
      note,
      appUrl: env.appUrl
    });
    // Tack on the ?email= param client-side convenience.
    const url = intendedEmail
      ? `${result.url}&email=${encodeURIComponent(intendedEmail)}`
      : result.url;
    return NextResponse.json({
      ok: true,
      code: result.code,
      url,
      expiresAt: result.expiresAt
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to mint invite.") },
      { status: 500 }
    );
  }
}

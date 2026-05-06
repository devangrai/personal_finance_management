import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { snapshotNetWorthForUser } from "@/lib/net-worth";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * Daily cron: snapshot net worth for every verified user.
 *
 * Runs at 03:15 UTC (just after daily-review). Idempotent per
 * (userId, snapshotDate) — safe to retry.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: NextRequest) {
  const env = getAppEnv();
  const authHeader = request.headers.get("authorization");
  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const users = await prisma.user.findMany({
      where: { emailVerified: { not: null } },
      select: { id: true, email: true }
    });
    const results: Array<{
      userId: string;
      email: string | null;
      ok: boolean;
      error?: string;
    }> = [];
    for (const u of users) {
      try {
        await snapshotNetWorthForUser({ userId: u.id });
        results.push({ userId: u.id, email: u.email, ok: true });
      } catch (err) {
        results.push({
          userId: u.id,
          email: u.email,
          ok: false,
          error: getErrorMessage(err, "snapshot failed")
        });
      }
    }
    return NextResponse.json({
      ok: results.every((r) => r.ok),
      userCount: users.length,
      results
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "cron failed") },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { runDailyReviewCycle } from "@/lib/daily-review";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * Cron-triggered daily-review run. Iterates over ALL users and runs
 * their digest in series — the LLM auto-categorization and email send
 * are per-user, so we don't want parallel calls competing for Gemini
 * quota or Resend rate limits.
 *
 * Auth: requires the CRON_SECRET bearer token that Vercel attaches to
 * scheduled cron invocations.
 */
export async function GET(request: NextRequest) {
  const env = getAppEnv();
  const authHeader = request.headers.get("authorization");

  if (!env.cronSecret || authHeader !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
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
      status?: string;
      error?: string;
    }> = [];
    for (const u of users) {
      try {
        const result = await runDailyReviewCycle({ userId: u.id });
        results.push({
          userId: u.id,
          email: u.email,
          ok: true,
          status: result.status
        });
      } catch (err) {
        results.push({
          userId: u.id,
          email: u.email,
          ok: false,
          error: getErrorMessage(err, "cycle failed")
        });
      }
    }

    return NextResponse.json({
      ok: results.every((r) => r.ok),
      userCount: users.length,
      results
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to run the cron daily review.") },
      { status: 500 }
    );
  }
}

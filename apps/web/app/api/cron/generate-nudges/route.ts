import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { generateNudgesForUser } from "@/lib/proactive-nudges";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * Weekly cron: scan each user's data and emit candidate ProactiveNudge
 * rows. Dedups internally against the last 14 days. User-facing cap
 * (2/week surfaced) is enforced at surface-time, not generation-time.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 * Schedule: see vercel.json — typically Sunday morning UTC.
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
      candidatesFound?: number;
      inserted?: number;
      skippedDedup?: number;
      error?: string;
    }> = [];

    for (const u of users) {
      try {
        const result = await generateNudgesForUser(u.id);
        results.push({
          userId: u.id,
          email: u.email,
          ok: true,
          ...result
        });
      } catch (err) {
        results.push({
          userId: u.id,
          email: u.email,
          ok: false,
          error: getErrorMessage(err, "nudge generation failed")
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
      {
        error: getErrorMessage(
          error,
          "Unable to run the cron generate-nudges job."
        )
      },
      { status: 500 }
    );
  }
}

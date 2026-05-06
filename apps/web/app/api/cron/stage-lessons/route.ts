import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { buildModelPool } from "@/lib/llm/model-pool";
import { stageCandidateLessons } from "@/lib/advisor-lessons";
import { getAppEnv } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";

/**
 * Vercel cron: nightly lesson staging, per-user.
 *
 * Iterates over every verified user and runs the clustering pipeline
 * against that user's recent RecommendationRun rows. Candidates are
 * written per-user; nothing graduates automatically.
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
    const pool = buildModelPool();
    const provider = pool.get("judge");
    const users = await prisma.user.findMany({
      where: { emailVerified: { not: null } },
      select: { id: true, email: true }
    });
    const results: Array<{
      userId: string;
      email: string | null;
      ok: boolean;
      candidatesCreated?: number;
      error?: string;
    }> = [];
    for (const u of users) {
      try {
        const result = await stageCandidateLessons({
          provider,
          userId: u.id
        });
        results.push({
          userId: u.id,
          email: u.email,
          ok: true,
          candidatesCreated: result.candidatesCreated
        });
      } catch (err) {
        results.push({
          userId: u.id,
          email: u.email,
          ok: false,
          error: getErrorMessage(err, "stage-lessons failed")
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
          "Unable to run the cron stage-lessons job."
        )
      },
      { status: 500 }
    );
  }
}

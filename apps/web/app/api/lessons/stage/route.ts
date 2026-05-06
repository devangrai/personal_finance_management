import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { buildModelPool } from "@/lib/llm/model-pool";
import { stageCandidateLessons } from "@/lib/advisor-lessons";

/**
 * POST /api/lessons/stage
 *
 * On-demand run of the staging pipeline. Same code path the cron uses.
 * Useful for manual triggering and testing. Body is optional:
 *   { lookbackDays?: number, maxRuns?: number }
 */

type Payload = {
  lookbackDays?: number;
  maxRuns?: number;
};

export async function POST(request: NextRequest) {
  let payload: Payload = {};
  try {
    payload = (await request.json()) as Payload;
  } catch {
    payload = {};
  }

  try {
    const pool = buildModelPool();
    const provider = pool.get("judge");
    const result = await stageCandidateLessons({
      provider,
      lookbackDays: payload.lookbackDays,
      maxRuns: payload.maxRuns
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to stage candidate lessons.") },
      { status: 500 }
    );
  }
}

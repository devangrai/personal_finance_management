import { NextRequest, NextResponse } from "next/server";
import { CandidateLessonStatus } from "@portfolio/db";
import { getErrorMessage } from "@/lib/errors";
import {
  listAgentLessons,
  listAllCandidates,
  listPendingCandidates
} from "@/lib/advisor-lessons";

/**
 * GET /api/lessons
 *
 * ?status=pending (default) | graduated | rejected | reopened | all
 * ?agent=1  → also return graduated AgentLessons (for reviewing what the
 *             advisor currently remembers about you)
 */

export async function GET(request: NextRequest) {
  const statusParam = request.nextUrl.searchParams.get("status") ?? "pending";
  const includeAgentLessons = request.nextUrl.searchParams.get("agent") === "1";

  try {
    let candidates;
    if (statusParam === "all") {
      candidates = await listAllCandidates();
    } else if (
      statusParam === "pending" ||
      statusParam === "graduated" ||
      statusParam === "rejected" ||
      statusParam === "reopened"
    ) {
      candidates =
        statusParam === "pending"
          ? await listPendingCandidates()
          : await listAllCandidates(statusParam as CandidateLessonStatus);
    } else {
      return NextResponse.json(
        {
          error: `Invalid status "${statusParam}". Valid: pending | graduated | rejected | reopened | all`
        },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = { candidates };

    if (includeAgentLessons) {
      payload.agentLessons = await listAgentLessons();
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to list lessons.") },
      { status: 500 }
    );
  }
}

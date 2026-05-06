import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { rejectCandidate } from "@/lib/advisor-lessons";

/**
 * POST /api/lessons/:id/reject
 * Body: { rationale: string }
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

type Payload = {
  rationale?: string;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }
  if (!payload.rationale || !payload.rationale.trim()) {
    return NextResponse.json(
      { error: "rationale is required" },
      { status: 400 }
    );
  }

  try {
    const candidate = await rejectCandidate(id, payload.rationale);
    return NextResponse.json({ candidate });
  } catch (error) {
    const message = getErrorMessage(error, "Unable to reject candidate.");
    const isNotFound =
      message.includes("not found") || message.includes("expected pending");
    return NextResponse.json(
      { error: message },
      { status: isNotFound ? 400 : 500 }
    );
  }
}

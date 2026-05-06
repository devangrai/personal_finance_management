import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { listAllGoals, upsertGoal } from "@/lib/goals";

export async function GET() {
  try {
    const goals = await listAllGoals();
    return NextResponse.json({ goals });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to list goals.") },
      { status: 500 }
    );
  }
}

type PostPayload = {
  goalKey?: string;
  label?: string;
  targetValue?: string | number | null;
  targetDate?: string | null;
  commitment?: string | null;
  isActive?: boolean;
};

export async function POST(request: NextRequest) {
  let payload: PostPayload;
  try {
    payload = (await request.json()) as PostPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (!payload.goalKey || !payload.label) {
    return NextResponse.json(
      { error: "goalKey and label are required." },
      { status: 400 }
    );
  }

  try {
    const goal = await upsertGoal({
      goalKey: payload.goalKey,
      label: payload.label,
      targetValue: payload.targetValue ?? null,
      targetDate: payload.targetDate ?? null,
      commitment: payload.commitment ?? null,
      isActive: payload.isActive
    });
    return NextResponse.json({ goal });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to save goal.") },
      { status: 500 }
    );
  }
}

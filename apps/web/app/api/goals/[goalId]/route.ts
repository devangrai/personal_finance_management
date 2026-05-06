import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { deactivateGoal } from "@/lib/goals";

type RouteContext = {
  params: Promise<{
    goalId: string;
  }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { goalId } = await context.params;
  try {
    const goal = await deactivateGoal(goalId);
    return NextResponse.json({ goal });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to deactivate goal.") },
      { status: 500 }
    );
  }
}

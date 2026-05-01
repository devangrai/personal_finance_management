import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { getAdvisorPlanSnapshot } from "@/lib/advisor-plan";

export async function GET() {
  try {
    const plan = await getAdvisorPlanSnapshot();
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to build the advisor plan.")
      },
      {
        status: 500
      }
    );
  }
}

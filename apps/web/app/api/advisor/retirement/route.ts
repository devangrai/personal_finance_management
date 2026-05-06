import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { getRetirementContributionRecommendation } from "@/lib/advisor-retirement";

export async function GET() {
  try {
    const recommendation = await getRetirementContributionRecommendation();
    return NextResponse.json(recommendation);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(
          error,
          "Unable to compute the retirement contribution recommendation."
        )
      },
      { status: 500 }
    );
  }
}

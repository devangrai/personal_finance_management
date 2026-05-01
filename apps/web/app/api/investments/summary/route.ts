import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { getInvestmentsSummary } from "@/lib/investments";

export async function GET() {
  try {
    const summary = await getInvestmentsSummary();

    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to load investments summary.")
      },
      {
        status: 500
      }
    );
  }
}

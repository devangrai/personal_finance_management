import { NextResponse } from "next/server";
import { computeOverviewSnapshot } from "@/lib/overview-snapshot";
import { getErrorMessage } from "@/lib/errors";

/**
 * Lightweight endpoint for the /overview page. The computation lives
 * in lib/overview-snapshot.ts so the server component can call it
 * directly (no cookie-forwarding fetch).
 */
export async function GET() {
  try {
    const snapshot = await computeOverviewSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to load overview snapshot.") },
      { status: 500 }
    );
  }
}

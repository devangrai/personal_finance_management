import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { syncAllConnections } from "@/lib/snaptrade";

/**
 * Manually refresh all SnapTrade data for the default user. Called by
 * /snaptrade/return after the user completes the Connection Portal flow
 * and by the Sync button in the Accounts section.
 */
export async function POST() {
  try {
    const result = await syncAllConnections();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "SnapTrade sync failed.") },
      { status: 500 }
    );
  }
}

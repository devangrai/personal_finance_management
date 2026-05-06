import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { ensureSnapTradeUser } from "@/lib/snaptrade";

/**
 * Idempotent: if the caller already has a SnapTradeUser row, return it;
 * otherwise call SnapTrade's /register and store the userSecret.
 */
export async function POST() {
  try {
    const st = await ensureSnapTradeUser();
    return NextResponse.json({
      ok: true,
      snaptradeUserId: st.snaptradeUserId
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to register SnapTrade user.") },
      { status: 500 }
    );
  }
}

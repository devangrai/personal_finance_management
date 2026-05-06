import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@portfolio/db";
import { getErrorMessage } from "@/lib/errors";
import { getDefaultUserId } from "@/lib/categories";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type PatchPayload = {
  excludeFromNetWorth?: boolean;
};

/**
 * PATCH a ManualInvestmentAccount (which backs CSV imports AND SnapTrade).
 * Currently only supports toggling excludeFromNetWorth.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  let payload: PatchPayload;
  try {
    payload = (await request.json()) as PatchPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  try {
    const userId = await getDefaultUserId();
    const data: { excludeFromNetWorth?: boolean } = {};
    if (typeof payload.excludeFromNetWorth === "boolean") {
      data.excludeFromNetWorth = payload.excludeFromNetWorth;
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No supported fields to patch." },
        { status: 400 }
      );
    }

    const updated = await prisma.manualInvestmentAccount.updateMany({
      where: { id, userId },
      data
    });
    if (updated.count === 0) {
      return NextResponse.json(
        { error: "Investment account not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to update investment account.")
      },
      { status: 500 }
    );
  }
}

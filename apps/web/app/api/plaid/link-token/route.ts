import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { createLinkToken } from "@/lib/plaid";

type CreateLinkTokenPayload = {
  mode?: "connect" | "update";
  plaidItemId?: string;
  productScope?: "default" | "transactions" | "investments";
};

export async function POST(request: Request) {
  let payload: CreateLinkTokenPayload = {};

  try {
    payload = (await request.json()) as CreateLinkTokenPayload;
  } catch {
    payload = {};
  }

  try {
    const response = await createLinkToken({
      mode: payload.mode,
      plaidItemId: payload.plaidItemId,
      productScope: payload.productScope
    });

    return NextResponse.json({
      linkToken: response.link_token,
      expiration: response.expiration,
      mode: payload.mode ?? "connect",
      plaidItemId: payload.plaidItemId ?? null,
      productScope: payload.productScope ?? "default"
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to create Plaid link token.")
      },
      {
        status: 500
      }
    );
  }
}

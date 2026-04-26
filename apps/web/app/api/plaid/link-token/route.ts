import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { createLinkToken } from "@/lib/plaid";

export async function POST() {
  try {
    const response = await createLinkToken();

    return NextResponse.json({
      linkToken: response.link_token,
      expiration: response.expiration
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

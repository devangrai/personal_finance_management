import { NextResponse } from "next/server";
import { createLinkToken } from "@/lib/plaid";

export async function POST() {
  try {
    const response = await createLinkToken();

    return NextResponse.json({
      linkToken: response.link_token,
      expiration: response.expiration
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create Plaid link token.";

    return NextResponse.json(
      {
        error: message
      },
      {
        status: 500
      }
    );
  }
}

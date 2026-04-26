import { NextRequest, NextResponse } from "next/server";
import { exchangePublicToken } from "@/lib/plaid";

type ExchangePublicTokenPayload = {
  publicToken?: string;
  institution?: {
    institution_id?: string | null;
    name?: string | null;
  } | null;
};

export async function POST(request: NextRequest) {
  let payload: ExchangePublicTokenPayload;

  try {
    payload = (await request.json()) as ExchangePublicTokenPayload;
  } catch {
    return NextResponse.json(
      {
        error: "Request body must be valid JSON."
      },
      {
        status: 400
      }
    );
  }

  if (!payload.publicToken) {
    return NextResponse.json(
      {
        error: "publicToken is required."
      },
      {
        status: 400
      }
    );
  }

  try {
    const response = await exchangePublicToken({
      publicToken: payload.publicToken,
      institutionId: payload.institution?.institution_id ?? undefined,
      institutionName: payload.institution?.name ?? undefined
    });

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to exchange public token.";

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

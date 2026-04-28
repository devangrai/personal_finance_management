import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { handlePlaidWebhook } from "@/lib/plaid";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = (await request.json()) as unknown;
  } catch {
    return NextResponse.json(
      {
        error: "Webhook body must be valid JSON."
      },
      {
        status: 400
      }
    );
  }

  try {
    const result = await handlePlaidWebhook(
      (payload ?? {}) as Parameters<typeof handlePlaidWebhook>[0]
    );

    return NextResponse.json({
      ok: true,
      result
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to process the Plaid webhook.")
      },
      {
        status: 500
      }
    );
  }
}

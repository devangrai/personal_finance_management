import { NextRequest, NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { generateConnectionUrl } from "@/lib/snaptrade";

type ConnectUrlPayload = {
  broker?: string;
};

export async function POST(request: NextRequest) {
  let payload: ConnectUrlPayload = {};
  try {
    payload = (await request.json()) as ConnectUrlPayload;
  } catch {
    // empty body is fine — defaults to generic broker picker
    payload = {};
  }

  try {
    const { redirectURI } = await generateConnectionUrl({
      broker: payload.broker
    });
    return NextResponse.json({ redirectURI });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to start SnapTrade Connect flow.") },
      { status: 500 }
    );
  }
}

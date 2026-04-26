import { NextResponse } from "next/server";
import { listLinkedAccounts } from "@/lib/accounts";

export async function GET() {
  try {
    const data = await listLinkedAccounts();

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load linked accounts.";

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

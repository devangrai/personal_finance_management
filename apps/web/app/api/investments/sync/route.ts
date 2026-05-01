import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { syncInvestmentsForLinkedItems } from "@/lib/plaid";

export async function POST() {
  try {
    const result = await syncInvestmentsForLinkedItems();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to sync investments.")
      },
      {
        status: 500
      }
    );
  }
}

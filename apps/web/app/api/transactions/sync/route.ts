import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { syncTransactionsForLinkedItems } from "@/lib/plaid";

export async function POST() {
  try {
    const result = await syncTransactionsForLinkedItems();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to sync transactions.")
      },
      {
        status: 500
      }
    );
  }
}

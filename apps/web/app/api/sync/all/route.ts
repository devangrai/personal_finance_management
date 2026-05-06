import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import {
  syncTransactionsForLinkedItems,
  syncInvestmentsForLinkedItems
} from "@/lib/plaid";

/**
 * One-button full refresh: syncs all Plaid-linked items (transactions +
 * investments). Returns a consolidated summary for the UI.
 */
export async function POST() {
  const startedAt = Date.now();
  try {
    const [transactions, investments] = await Promise.allSettled([
      syncTransactionsForLinkedItems(),
      syncInvestmentsForLinkedItems()
    ]);

    const transactionResult =
      transactions.status === "fulfilled"
        ? transactions.value
        : { error: getErrorMessage(transactions.reason, "transactions sync failed") };

    const investmentsResult =
      investments.status === "fulfilled"
        ? investments.value
        : { error: getErrorMessage(investments.reason, "investments sync failed") };

    const ok =
      transactions.status === "fulfilled" && investments.status === "fulfilled";

    return NextResponse.json({
      ok,
      durationMs: Date.now() - startedAt,
      transactions: transactionResult,
      investments: investmentsResult
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getErrorMessage(error, "Unable to sync accounts.")
      },
      { status: 500 }
    );
  }
}

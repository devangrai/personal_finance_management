import { NextRequest, NextResponse } from "next/server";
import { listRecentTransactions } from "@/lib/transactions";

export async function GET(request: NextRequest) {
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue ? Number(limitValue) : 50;

  try {
    const transactions = await listRecentTransactions(
      Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50
    );

    return NextResponse.json({
      transactions
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load transactions.";

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

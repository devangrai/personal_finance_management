import { NextRequest, NextResponse } from "next/server";
import { listRecentTransactions } from "@/lib/transactions";

export async function GET(request: NextRequest) {
  const limitValue = request.nextUrl.searchParams.get("limit");
  const dateValue = request.nextUrl.searchParams.get("date");
  const limit = limitValue ? Number(limitValue) : 50;

  try {
    const transactions = await listRecentTransactions({
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50,
      localDateKey: dateValue
    });

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

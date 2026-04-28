import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { refreshPlaidItem } from "@/lib/plaid";

type RouteContext = {
  params: Promise<{
    plaidItemId: string;
  }>;
};

export async function POST(_: Request, context: RouteContext) {
  const { plaidItemId } = await context.params;

  try {
    const response = await refreshPlaidItem(plaidItemId);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to refresh the linked institution.")
      },
      {
        status: 500
      }
    );
  }
}

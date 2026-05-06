import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { disconnectPlaidItem } from "@/lib/plaid";

type RouteContext = {
  params: Promise<{
    plaidItemId: string;
  }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { plaidItemId } = await context.params;

  try {
    const response = await disconnectPlaidItem(plaidItemId);
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error, "Unable to disconnect the linked institution.")
      },
      {
        status: 500
      }
    );
  }
}

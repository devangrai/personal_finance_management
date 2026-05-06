import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { disconnectConnection } from "@/lib/snaptrade";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    await disconnectConnection(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to disconnect.") },
      { status: 500 }
    );
  }
}

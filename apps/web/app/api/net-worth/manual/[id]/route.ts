import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteManualItem } from "@/lib/net-worth";
import { getErrorMessage } from "@/lib/errors";

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const res = await deleteManualItem({ userId: session.user.id, id });
    if (res.count === 0) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to delete.") },
      { status: 500 }
    );
  }
}

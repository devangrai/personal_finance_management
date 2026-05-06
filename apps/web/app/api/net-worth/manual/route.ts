import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { upsertManualItem } from "@/lib/net-worth";
import { getErrorMessage } from "@/lib/errors";

/**
 * POST /api/net-worth/manual
 *   Body: { id?, kind: "asset"|"liability", category, label, amountCents, notes? }
 *   Create (no id) or update (with id) a manual asset/liability row.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: {
    id?: string;
    kind?: string;
    category?: string;
    label?: string;
    amountCents?: number;
    notes?: string | null;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  if (body.kind !== "asset" && body.kind !== "liability") {
    return NextResponse.json(
      { error: "kind must be 'asset' or 'liability'." },
      { status: 400 }
    );
  }
  if (!body.category || !body.label) {
    return NextResponse.json(
      { error: "category and label required." },
      { status: 400 }
    );
  }
  if (typeof body.amountCents !== "number" || body.amountCents < 0) {
    return NextResponse.json(
      { error: "amountCents must be a non-negative number." },
      { status: 400 }
    );
  }
  try {
    await upsertManualItem({
      userId: session.user.id,
      id: body.id,
      kind: body.kind,
      category: body.category,
      label: body.label,
      amountCents: body.amountCents,
      notes: body.notes ?? null
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to save manual item.") },
      { status: 500 }
    );
  }
}

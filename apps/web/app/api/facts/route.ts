import { NextRequest, NextResponse } from "next/server";
import { UserFactSource } from "@portfolio/db";
import { getErrorMessage } from "@/lib/errors";
import {
  deleteUserFact,
  listUserFacts,
  saveUserFact,
  type UserFactValue
} from "@/lib/user-facts";

export async function GET() {
  try {
    const facts = await listUserFacts();
    return NextResponse.json({ facts });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to list facts.") },
      { status: 500 }
    );
  }
}

type PostPayload = {
  factKey?: string;
  factValue?: UserFactValue;
  confidence?: number | null;
  source?: UserFactSource;
  notes?: string | null;
};

export async function POST(request: NextRequest) {
  let payload: PostPayload;
  try {
    payload = (await request.json()) as PostPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  if (!payload.factKey) {
    return NextResponse.json(
      { error: "factKey is required." },
      { status: 400 }
    );
  }

  try {
    const fact = await saveUserFact({
      factKey: payload.factKey,
      factValue: payload.factValue ?? null,
      confidence: payload.confidence ?? null,
      source: payload.source,
      notes: payload.notes ?? null
    });
    return NextResponse.json({ fact });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to save fact.") },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const factKey = request.nextUrl.searchParams.get("factKey");
  if (!factKey) {
    return NextResponse.json(
      { error: "factKey query parameter is required." },
      { status: 400 }
    );
  }
  try {
    await deleteUserFact(factKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Unable to delete fact.") },
      { status: 500 }
    );
  }
}

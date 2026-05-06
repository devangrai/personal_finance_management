import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@portfolio/db";
import { runDocumentExtractor } from "@/lib/document-extractor";
import { getErrorMessage } from "@/lib/errors";

/**
 * POST /api/documents/[id]/reprocess
 *   Re-run the extractor on a document. Supersedes any prior staged
 *   extractions for the same fact keys. Useful when extraction failed
 *   or when the Gemini model improved.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const doc = await prisma.userDocument.findFirst({
      where: { id, userId: session.user.id }
    });
    if (!doc) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      );
    }
    await prisma.userDocument.update({
      where: { id: doc.id },
      data: { status: "processing", errorMessage: null }
    });
    void runDocumentExtractor({ userDocumentId: doc.id }).catch((err) => {
      console.warn("[documents] reprocess failed:", err);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Reprocess failed.") },
      { status: 500 }
    );
  }
}

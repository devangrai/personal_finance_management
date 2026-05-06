import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@portfolio/db";
import { fetchDocumentBlob } from "@/lib/document-storage";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/documents/[id]/file
 *   Proxies the raw document bytes to the client AFTER verifying session
 *   ownership. We never expose blob URLs directly so the viewer (and any
 *   other consumer) always goes through session auth.
 */
export async function GET(
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
    if (!doc.storageKey) {
      return NextResponse.json(
        { error: "Document has no stored file." },
        { status: 404 }
      );
    }
    const { bytes, mimeType } = await fetchDocumentBlob({
      storageKey: doc.storageKey
    });
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(
          doc.originalFilename
        )}"`,
        "Cache-Control": "private, max-age=60"
      }
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to load file.") },
      { status: 500 }
    );
  }
}

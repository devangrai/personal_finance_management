import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@portfolio/db";
import {
  deleteUserDocument,
  getUserDocumentWithExtractions
} from "@/lib/document-extractor";
import { getErrorMessage } from "@/lib/errors";

/**
 * GET /api/documents/[id]
 *   Return a single doc + its extractions. Self-heals stuck-in-processing.
 *
 * PATCH /api/documents/[id]
 *   Update title or documentType.
 *
 * DELETE /api/documents/[id]
 *   Remove the blob, the row, and all its ExtractedFact rows. UserFact
 *   rows produced from the doc are left intact (user manages via /context).
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
    const payload = await getUserDocumentWithExtractions({
      userId: session.user.id,
      documentId: id
    });
    if (!payload) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      document: {
        id: payload.doc.id,
        title: payload.doc.title,
        originalFilename: payload.doc.originalFilename,
        mimeType: payload.doc.mimeType,
        sizeBytes: payload.doc.sizeBytes,
        pageCount: payload.doc.pageCount,
        documentType: payload.doc.documentType,
        status: payload.doc.status,
        errorMessage: payload.doc.errorMessage,
        uploadedAt: payload.doc.uploadedAt,
        processedAt: payload.doc.processedAt
      },
      extractions: payload.extractions.map((e) => ({
        id: e.id,
        factKey: e.factKey,
        newValue: e.newValue,
        confidence: e.confidence,
        evidence: e.evidence,
        status: e.status,
        stakesLevel: e.stakesLevel,
        page: e.page,
        sourceRegion: e.sourceRegion,
        createdAt: e.createdAt
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to load document.") },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  let body: { title?: string; documentType?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    const existing = await prisma.userDocument.findFirst({
      where: { id, userId: session.user.id }
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Document not found." },
        { status: 404 }
      );
    }
    await prisma.userDocument.update({
      where: { id: existing.id },
      data: {
        title: body.title ? body.title.slice(0, 200) : existing.title,
        documentType: body.documentType
          ? body.documentType.slice(0, 60)
          : existing.documentType
      }
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Update failed.") },
      { status: 500 }
    );
  }
}

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
    await deleteUserDocument({ userId: session.user.id, documentId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Delete failed.") },
      { status: 500 }
    );
  }
}

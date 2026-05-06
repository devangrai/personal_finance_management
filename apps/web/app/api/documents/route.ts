import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@portfolio/db";
import {
  listUserDocuments,
  runDocumentExtractor
} from "@/lib/document-extractor";
import { uploadDocumentBlob } from "@/lib/document-storage";
import { getErrorMessage } from "@/lib/errors";

// 25MB max document size. Tax returns are the largest thing expected and
// those sit comfortably under 10MB as PDFs.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp"
]);

function inferExt(mimeType: string, filename: string): string {
  const fromName = filename.match(/\.(pdf|png|jpe?g|webp)$/i);
  if (fromName) return fromName[0].toLowerCase();
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return "";
}

/**
 * GET /api/documents
 *   List all of the user's uploaded documents, newest first.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const docs = await listUserDocuments(session.user.id);
    return NextResponse.json({
      ok: true,
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        originalFilename: d.originalFilename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        pageCount: d.pageCount,
        documentType: d.documentType,
        status: d.status,
        errorMessage: d.errorMessage,
        uploadedAt: d.uploadedAt,
        processedAt: d.processedAt,
        extractionCount: d._count.extractions
      }))
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Failed to list documents.") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents
 *   Body: multipart/form-data with fields:
 *     file         the file itself
 *     title        human-readable title
 *     documentType one of: w2, paystub, comp_statement, ten99_nec, ...
 *
 *   Streams the file to blob storage, creates a UserDocument row, and
 *   fires the extractor in the background. Returns the document ID and
 *   status=processing so the client can poll.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const title = (form.get("title") as string | null)?.trim();
    const documentType = (form.get("documentType") as string | null) ?? "other";
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json(
        { error: "Title required." },
        { status: 400 }
      );
    }
    if (!ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB).` },
        { status: 400 }
      );
    }

    // Create the row FIRST so we can give it a stable id to use as the
    // blob key. This also means an errored upload leaves a pending row
    // that can be surfaced to the user with a "retry" button later.
    const filenameWithExt = file.name.includes(".")
      ? file.name
      : `${file.name}${inferExt(file.type, file.name)}`;
    const row = await prisma.userDocument.create({
      data: {
        userId: session.user.id,
        title: title.slice(0, 200),
        originalFilename: filenameWithExt.slice(0, 255),
        mimeType: file.type,
        sizeBytes: file.size,
        documentType: documentType.slice(0, 60),
        storageKey: "", // set below
        status: "pending"
      }
    });

    // Stream to blob. If this fails we end up with a pending row that
    // the user can delete from the UI (it shows as "failed: upload").
    const buf = Buffer.from(await file.arrayBuffer());
    try {
      const stored = await uploadDocumentBlob({
        userId: session.user.id,
        docId: row.id,
        originalFilename: filenameWithExt,
        mimeType: file.type,
        body: buf
      });
      await prisma.userDocument.update({
        where: { id: row.id },
        data: {
          storageKey: stored.storageKey,
          status: "processing"
        }
      });
    } catch (err) {
      await prisma.userDocument.update({
        where: { id: row.id },
        data: {
          status: "failed",
          errorMessage: `Upload failed: ${getErrorMessage(err, "unknown")}`
        }
      });
      return NextResponse.json(
        { error: getErrorMessage(err, "Upload failed.") },
        { status: 500 }
      );
    }

    // Fire-and-forget extraction. The client polls for status.
    void runDocumentExtractor({ userDocumentId: row.id }).catch((err) => {
      console.warn("[documents] extractor failed:", err);
    });

    return NextResponse.json({
      ok: true,
      document: {
        id: row.id,
        status: "processing"
      }
    });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, "Upload failed.") },
      { status: 500 }
    );
  }
}

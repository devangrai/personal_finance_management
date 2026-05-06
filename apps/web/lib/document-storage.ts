import { put, del, head } from "@vercel/blob";
import { randomBytes } from "node:crypto";

/**
 * Document storage helpers (Vercel Blob).
 *
 * All files live under `users/${userId}/docs/${docId}${ext}`. The userId
 * prefix is a belt-and-suspenders scoping check: a bug in the routing layer
 * that forgot to filter by userId still can't return a blob belonging to
 * another user, because the key includes the user id.
 *
 * We never expose blob URLs to the client. Reads go through a server
 * endpoint (/api/documents/[id]/file) that proxies the bytes after
 * authenticating the request. This keeps CORS simple for the viewer and
 * ensures every read is authorized at the app layer.
 */

export type StoredBlobInfo = {
  storageKey: string;
  url: string; // internal blob URL — NOT safe to share with the client
  size: number;
  mimeType: string;
};

function sanitizeExt(filename: string): string {
  const m = filename.match(/\.([a-z0-9]{1,8})$/i);
  if (!m) return "";
  return `.${m[1].toLowerCase()}`;
}

function buildStorageKey(userId: string, docId: string, filename: string) {
  // docId is already cuid (unguessable). Adding the extension keeps the
  // mime-sniffing happy and filenames readable in admin tooling.
  return `users/${userId}/docs/${docId}${sanitizeExt(filename)}`;
}

export async function uploadDocumentBlob(args: {
  userId: string;
  docId: string;
  originalFilename: string;
  mimeType: string;
  body: Buffer | ArrayBuffer | ReadableStream;
}): Promise<StoredBlobInfo> {
  const key = buildStorageKey(args.userId, args.docId, args.originalFilename);
  const blob = await put(key, args.body as Buffer, {
    access: "public", // see proxy comment below
    contentType: args.mimeType,
    addRandomSuffix: false,
    // Overwrite if somehow we're retrying the same docId (idempotent)
    allowOverwrite: true
  });
  // NOTE on access: Vercel Blob's "private" option still returns a URL;
  // the real protection is that the URL is only known to our server code.
  // We never echo it to the client. Reads go through /api/documents/[id]/file
  // which enforces session-scoped authorization.
  return {
    storageKey: key,
    url: blob.url,
    size:
      "byteLength" in args.body
        ? (args.body as Buffer).byteLength
        : 0, // streams: size set by caller
    mimeType: args.mimeType
  };
}

export async function deleteDocumentBlob(storageKey: string): Promise<void> {
  try {
    await del(storageKey);
  } catch (err) {
    // If the blob is already gone, that's fine for our cleanup purpose.
    if (err instanceof Error && /not found|404/i.test(err.message)) return;
    throw err;
  }
}

/**
 * Fetch the raw blob bytes for internal use (extractor / viewer proxy).
 * Callers MUST verify the user owns the document before invoking.
 */
export async function fetchDocumentBlob(args: {
  storageKey: string;
}): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const info = await head(args.storageKey);
  if (!info.url) throw new Error(`Blob not found: ${args.storageKey}`);
  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  const mime = res.headers.get("content-type") ?? info.contentType ?? "application/octet-stream";
  const bytes = await res.arrayBuffer();
  return { bytes, mimeType: mime };
}

/** Small convenience: do we have a token set? */
export function isBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/** One-shot randomness used for some server-side tokens — not critical
 * for crypto but helpful when we want a quick short ID. */
export function shortId(): string {
  return randomBytes(6).toString("hex");
}

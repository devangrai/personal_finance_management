#!/usr/bin/env -S npx tsx
/**
 * Backfill RAG chunks for documents uploaded BEFORE Week 8.
 *
 * Iterates every UserDocument with status=ready and no chunks yet,
 * re-calls Gemini Vision to transcribe the file text (only), then
 * chunks + embeds + stores.
 *
 * Safe to re-run. Documents that already have chunks are skipped unless
 * --force is passed.
 *
 * Usage:
 *   set -a; source .env; set +a   (or source prod creds similarly)
 *   npx tsx scripts/backfill-document-chunks.ts
 *   npx tsx scripts/backfill-document-chunks.ts --force
 *   npx tsx scripts/backfill-document-chunks.ts --user owner@example.com
 *   npx tsx scripts/backfill-document-chunks.ts --doc <UserDocumentId>
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Args = {
  force: boolean;
  userEmail: string | null;
  documentId: string | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { force: false, userEmail: null, documentId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--user") args.userEmail = argv[++i] ?? null;
    else if (argv[i] === "--doc") args.documentId = argv[++i] ?? null;
  }
  return args;
}

// Minimal system prompt: just transcribe, no extraction.
const TRANSCRIBE_PROMPT = `
You will receive ONE attached document (PDF or image).

Your job: transcribe its plain text into the "documentText" field,
preserving page boundaries using a form-feed character (\\f) between pages.
Include all tabular figures, line items, and section headers verbatim.
NEVER include SSNs, bank account numbers, or full dates of birth — redact
to XXX-XX-XXXX style placeholders.

Return a single JSON object: {"documentText": "..."}
No prose around it.
`.trim();

const TRANSCRIBE_SCHEMA = {
  type: "object",
  properties: { documentText: { type: "string" } },
  required: ["documentText"]
};

async function transcribe(args: {
  apiKey: string;
  bytes: ArrayBuffer;
  mimeType: string;
}): Promise<string> {
  const body = {
    system_instruction: { parts: [{ text: TRANSCRIBE_PROMPT }] },
    contents: [
      {
        parts: [
          {
            inline_data: {
              mimeType: args.mimeType,
              data: Buffer.from(args.bytes).toString("base64")
            }
          },
          { text: "Transcribe the document." }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: TRANSCRIBE_SCHEMA,
      temperature: 0.1
    }
  };
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    }
  );
  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error?.message ?? `Gemini failed: ${res.status}`);
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned empty response");
  const parsed = JSON.parse(text) as { documentText?: string };
  return parsed.documentText ?? "";
}

async function main() {
  const args = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY not set.");
    process.exit(1);
  }

  const { fetchDocumentBlob } = await import(
    "../apps/web/lib/document-storage"
  );
  const { ingestDocumentChunks } = await import(
    "../apps/web/lib/document-retrieval"
  );

  let userId: string | null = null;
  if (args.userEmail) {
    const u = await prisma.user.findUnique({ where: { email: args.userEmail } });
    if (!u) {
      console.error(`No user with email ${args.userEmail}`);
      process.exit(1);
    }
    userId = u.id;
  }

  const where: Record<string, unknown> = { status: "ready" };
  if (userId) where.userId = userId;
  if (args.documentId) where.id = args.documentId;

  const docs = await prisma.userDocument.findMany({
    where,
    orderBy: { uploadedAt: "asc" }
  });
  console.log(`Found ${docs.length} document(s) to consider.`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const doc of docs) {
    const existing = await prisma.documentChunk.count({
      where: { userDocumentId: doc.id }
    });
    if (existing > 0 && !args.force) {
      console.log(`  [${doc.id}] ${doc.title} — already has ${existing} chunks, skip`);
      skipped++;
      continue;
    }
    try {
      const { bytes, mimeType } = await fetchDocumentBlob({
        storageKey: doc.storageKey
      });
      const text = await transcribe({ apiKey, bytes, mimeType });
      console.log(`  [${doc.id}] ${doc.title} — transcribed ${text.length} chars`);
      const ingest = await ingestDocumentChunks({
        userDocumentId: doc.id,
        userId: doc.userId,
        text,
        apiKey
      });
      console.log(`     → ingested ${ingest.chunksCreated} chunks`);
      processed++;
    } catch (err) {
      console.error(
        `  [${doc.id}] failed:`,
        err instanceof Error ? err.message : err
      );
      failed++;
    }
  }

  console.log(
    `\nDone. processed=${processed} skipped=${skipped} failed=${failed}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

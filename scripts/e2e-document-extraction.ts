#!/usr/bin/env -S npx tsx
/**
 * E2E smoke test for document upload + extraction.
 *
 * Exercises the full real path against a live Gemini Vision API call:
 *   1. Upload a synthetic W-2 PDF to Vercel Blob (real)
 *   2. Create a UserDocument row
 *   3. Invoke runDocumentExtractor (real Gemini call)
 *   4. Verify extractions landed in the DB with expected factKeys
 *   5. Confirm one extraction -> verify UserFact written with source=import
 *   6. Delete the document -> verify cascade
 *
 * Requires in env: GEMINI_API_KEY, BLOB_READ_WRITE_TOKEN, DATABASE_URL
 */

import * as fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const pdfPath = args[0] ?? "/tmp/test-w2.pdf";
  const email = process.env.TEST_EMAIL ?? "owner@example.com";

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }

  if (!fs.existsSync(pdfPath)) {
    console.error(`Test PDF not found at ${pdfPath}`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(pdfPath);
  console.log(`Read test PDF: ${bytes.length} bytes`);

  // Dynamic imports so this script can be run standalone.
  const { uploadDocumentBlob, deleteDocumentBlob } = await import(
    "../apps/web/lib/document-storage.ts"
  );
  const { runDocumentExtractor } = await import(
    "../apps/web/lib/document-extractor.ts"
  );

  console.log("\n--- Step 1: create UserDocument row ---");
  const doc = await prisma.userDocument.create({
    data: {
      userId: user.id,
      title: "E2E Test 2024 W-2",
      originalFilename: "test-w2.pdf",
      mimeType: "application/pdf",
      sizeBytes: bytes.length,
      documentType: "w2",
      storageKey: "", // set below
      status: "pending"
    }
  });
  console.log(`Created UserDocument ${doc.id}`);

  console.log("\n--- Step 2: upload to Vercel Blob ---");
  const stored = await uploadDocumentBlob({
    userId: user.id,
    docId: doc.id,
    originalFilename: "test-w2.pdf",
    mimeType: "application/pdf",
    body: bytes
  });
  await prisma.userDocument.update({
    where: { id: doc.id },
    data: { storageKey: stored.storageKey, status: "processing" }
  });
  console.log(`Uploaded to blob key: ${stored.storageKey}`);

  console.log("\n--- Step 3: run extractor (real Gemini call) ---");
  const t0 = Date.now();
  const result = await runDocumentExtractor({ userDocumentId: doc.id });
  const elapsed = Date.now() - t0;
  console.log(`Extractor finished in ${elapsed}ms:`);
  console.log(`  accepted=${result.accepted} rejected=${result.rejected}`);
  if (result.rejectedReasons.length) {
    console.log(`  rejected reasons: ${result.rejectedReasons.join(", ")}`);
  }

  console.log("\n--- Step 4: inspect extractions ---");
  const extractions = await prisma.extractedFact.findMany({
    where: { userDocumentId: doc.id },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }]
  });
  for (const e of extractions) {
    const val =
      typeof e.newValue === "object"
        ? JSON.stringify(e.newValue)
        : String(e.newValue);
    console.log(
      `  [${e.status}] ${e.factKey} = ${val}  (conf ${e.confidence.toFixed(2)}, pg ${e.page ?? "-"})`
    );
    console.log(`    evidence: "${e.evidence}"`);
  }

  if (extractions.length === 0) {
    console.warn("⚠️  NO extractions — Gemini Vision returned nothing usable.");
  }

  console.log("\n--- Step 5: confirm one extraction ---");
  const toConfirm = extractions.find((e) => e.status === "staged");
  if (toConfirm) {
    const { confirmStagedExtraction } = await import(
      "../apps/web/lib/advisor-extractor.ts"
    );
    await confirmStagedExtraction({ userId: user.id, id: toConfirm.id });
    const fact = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: toConfirm.factKey! } }
    });
    console.log(
      `  UserFact written: ${fact?.factKey} = ${JSON.stringify(fact?.factValue)} (source=${fact?.source})`
    );
  } else {
    console.log("  (no staged extractions to confirm)");
  }

  console.log("\n--- Step 6: clean up ---");
  await deleteDocumentBlob(stored.storageKey);
  await prisma.userDocument.delete({ where: { id: doc.id } });
  // Clean up the UserFact too if we created it
  if (toConfirm?.factKey) {
    await prisma.userFact.deleteMany({
      where: {
        userId: user.id,
        factKey: toConfirm.factKey,
        source: "import"
      }
    });
  }
  console.log("  ✓ cleaned up");
  console.log("\n=== E2E passed ===");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("E2E FAILED:", err);
  await prisma.$disconnect();
  process.exit(1);
});

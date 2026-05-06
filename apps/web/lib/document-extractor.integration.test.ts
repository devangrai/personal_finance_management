import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@portfolio/db";
import {
  getUserDocumentWithExtractions,
  listUserDocuments
} from "./document-extractor";
import { confirmStagedExtraction } from "./advisor-extractor";
import { getOrCreateDefaultUser } from "./user";

/**
 * Integration tests for the document lifecycle — no Gemini, no blob I/O.
 * We construct UserDocument + ExtractedFact rows directly, then exercise
 * listing, retrieval, confirm (which should write a UserFact with
 * source=import), and delete.
 */

async function cleanup() {
  const user = await getOrCreateDefaultUser();
  await prisma.extractedFact.deleteMany({
    where: { userId: user.id, userDocumentId: { not: null } }
  });
  // Narrow deletion to docs our test creates — other test files
  // (document-retrieval.integration) create docs with distinct
  // originalFilename prefixes and must not be wiped under us.
  await prisma.userDocument.deleteMany({
    where: { userId: user.id, originalFilename: "w2.pdf" }
  });
  // Document-extractor tests exclusively use "home_value" as their
  // target factKey to avoid collisions with the advisor-extractor
  // integration tests' cleanup (which wipes home_value + friends).
  await prisma.userFact.deleteMany({
    where: { userId: user.id, factKey: "home_value", source: "import" }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function makeDoc(userId: string, overrides: Partial<{ status: string; title: string; uploadedAt: Date }> = {}) {
  return prisma.userDocument.create({
    data: {
      userId,
      title: (overrides.title as string) ?? "2024 W-2",
      originalFilename: "w2.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
      documentType: "w2",
      storageKey: `test/${Math.random().toString(36).slice(2)}`,
      status: (overrides.status as never) ?? "ready",
      uploadedAt: overrides.uploadedAt ?? new Date()
    }
  });
}

describe("document lifecycle", () => {
  it("lists the user's documents with extraction counts", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDoc(user.id);
    await prisma.extractedFact.create({
      data: {
        userId: user.id,
        userDocumentId: doc.id,
        kind: "fact",
        status: "staged",
        factKey: "home_value",
        newValue: 650000 as never,
        confidence: 0.95,
        evidence: "Wages 185,000.00",
        stakesLevel: "medium"
      }
    });
    const docs = await listUserDocuments(user.id);
    const hit = docs.find((d) => d.id === doc.id);
    expect(hit).toBeDefined();
    expect(hit?._count.extractions).toBe(1);
  });

  it("returns extractions for getUserDocumentWithExtractions", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDoc(user.id);
    await prisma.extractedFact.create({
      data: {
        userId: user.id,
        userDocumentId: doc.id,
        kind: "fact",
        status: "staged",
        factKey: "home_value",
        newValue: 650000 as never,
        confidence: 0.95,
        evidence: "Wages 185,000.00",
        stakesLevel: "medium",
        page: 1
      }
    });
    const result = await getUserDocumentWithExtractions({
      userId: user.id,
      documentId: doc.id
    });
    expect(result).not.toBeNull();
    expect(result?.extractions.length).toBe(1);
    expect(result?.extractions[0].factKey).toBe("home_value");
  });

  it("self-heals documents stuck in processing for >5 minutes", async () => {
    const user = await getOrCreateDefaultUser();
    const oldTime = new Date(Date.now() - 10 * 60 * 1000);
    const doc = await makeDoc(user.id, {
      status: "processing",
      uploadedAt: oldTime
    });
    const result = await getUserDocumentWithExtractions({
      userId: user.id,
      documentId: doc.id
    });
    expect(result?.doc.status).toBe("failed");
    expect(result?.doc.errorMessage).toMatch(/timed out/);
  });

  it("confirming a document-sourced extraction writes UserFact with source=import", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDoc(user.id);
    const ex = await prisma.extractedFact.create({
      data: {
        userId: user.id,
        userDocumentId: doc.id,
        kind: "fact",
        status: "staged",
        factKey: "home_value",
        newValue: 650000 as never,
        confidence: 0.95,
        evidence: "Wages 185,000.00",
        stakesLevel: "medium"
      }
    });
    await confirmStagedExtraction({ userId: user.id, id: ex.id });
    const fact = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "home_value" } }
    });
    expect(fact?.source).toBe("import");
    expect(fact?.factValue).toBe(650000);
  });

  it("deleting a document cascades to its extractions (but not UserFact rows)", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDoc(user.id);
    const ex = await prisma.extractedFact.create({
      data: {
        userId: user.id,
        userDocumentId: doc.id,
        kind: "fact",
        status: "staged",
        factKey: "home_value",
        newValue: 650000 as never,
        confidence: 0.95,
        evidence: "Wages 185,000.00",
        stakesLevel: "medium"
      }
    });
    // Manually confirm to create a UserFact
    await confirmStagedExtraction({ userId: user.id, id: ex.id });
    const factBefore = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "home_value" } }
    });
    expect(factBefore).not.toBeNull();

    // We test the DB cascade directly here rather than going through
    // deleteUserDocument (which tries to remove the blob and would need
    // a real Vercel Blob token). The blob-cleanup path is exercised
    // manually in the E2E smoke test.
    await prisma.userDocument.delete({ where: { id: doc.id } });

    const docAfter = await prisma.userDocument.findUnique({
      where: { id: doc.id }
    });
    expect(docAfter).toBeNull();
    // Extractions cascade-delete via the onDelete: Cascade FK.
    const exAfter = await prisma.extractedFact.findUnique({ where: { id: ex.id } });
    expect(exAfter).toBeNull();
    // But UserFact stays — user manages those via /context.
    const factAfter = await prisma.userFact.findUnique({
      where: { userId_factKey: { userId: user.id, factKey: "home_value" } }
    });
    expect(factAfter).not.toBeNull();
  });
});

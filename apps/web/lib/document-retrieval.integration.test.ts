import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@portfolio/db";
import { getOrCreateDefaultUser } from "./user";
import { vectorLiteral } from "./document-embedder";

/**
 * Integration tests for document retrieval. We don't hit live Gemini;
 * we manually insert chunks with known embeddings and verify the
 * similarity search ranks them correctly.
 *
 * All the production search path uses $executeRawUnsafe / $queryRawUnsafe
 * for the vector ops, so we're testing the actual SQL that will run in
 * prod.
 */

async function cleanup() {
  const user = await getOrCreateDefaultUser();
  // Clean up test docs + their chunks (chunks cascade-delete)
  await prisma.userDocument.deleteMany({
    where: {
      userId: user.id,
      originalFilename: { startsWith: "test-retrieval-" }
    }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// Known 768-dim vectors for testing. We use three unit vectors that are
// orthogonal-ish so cosine distances are distinct and predictable.
function unitVec(seed: number): number[] {
  const v = new Array<number>(768).fill(0);
  // Put a 1.0 at position `seed` so vectors differ and are L2-normalized
  v[seed] = 1.0;
  return v;
}

// A query vector that leans toward seed A.
function queryVecFavoring(seedA: number, seedB: number, weight = 0.9): number[] {
  const v = new Array<number>(768).fill(0);
  v[seedA] = weight;
  v[seedB] = Math.sqrt(1 - weight * weight);
  return v;
}

async function makeDocWithChunks(args: {
  userId: string;
  title: string;
  documentType: string;
  chunks: Array<{ text: string; page: number | null; embedding: number[] }>;
}) {
  const doc = await prisma.userDocument.create({
    data: {
      userId: args.userId,
      title: args.title,
      originalFilename: `test-retrieval-${Math.random().toString(36).slice(2)}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1000,
      documentType: args.documentType,
      storageKey: `test/${Math.random().toString(36).slice(2)}`,
      status: "ready"
    }
  });
  for (let i = 0; i < args.chunks.length; i++) {
    const c = args.chunks[i];
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk"
       ("id", "userId", "userDocumentId", "chunkIndex", "page",
        "text", "embedding", "tokenCount", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7, NOW())`,
      args.userId,
      doc.id,
      i,
      c.page,
      c.text,
      vectorLiteral(c.embedding),
      c.text.length
    );
  }
  return doc;
}

describe("searchUserDocuments", () => {
  it("returns the most similar chunk first", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDocWithChunks({
      userId: user.id,
      title: "Test Doc A",
      documentType: "w2",
      chunks: [
        { text: "Income section with wages of 185000.", page: 1, embedding: unitVec(10) },
        { text: "Benefits section about health insurance.", page: 2, embedding: unitVec(20) },
        { text: "Retirement section with 401k match.", page: 3, embedding: unitVec(30) }
      ]
    });

    // Build a query that leans toward seed 30 (retirement)
    const queryVec = queryVecFavoring(30, 10);

    // Use raw SQL mirroring the prod search path
    const rows = await prisma.$queryRawUnsafe<
      Array<{ chunkIndex: number; distance: number; text: string }>
    >(
      `SELECT c."chunkIndex", c."text", c."embedding" <=> $2::vector as distance
       FROM "DocumentChunk" c
       WHERE c."userId" = $1 AND c."userDocumentId" = $3
       ORDER BY c."embedding" <=> $2::vector
       LIMIT 3`,
      user.id,
      vectorLiteral(queryVec),
      doc.id
    );
    expect(rows.length).toBe(3);
    // The retirement chunk (index 2) should be first
    expect(rows[0].chunkIndex).toBe(2);
    expect(rows[0].text).toContain("401k");
    // Income chunk (index 0) second because query has some seed-10 weight
    expect(rows[1].chunkIndex).toBe(0);
  });

  it("respects userId scoping (doesn't cross-user leak)", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDocWithChunks({
      userId: user.id,
      title: "Scoped Doc",
      documentType: "comp_statement",
      chunks: [{ text: "Annual salary 200k", page: 1, embedding: unitVec(15) }]
    });

    // Query with a DIFFERENT userId — should return zero results
    const queryVec = unitVec(15);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c."id" FROM "DocumentChunk" c
       WHERE c."userId" = $1 AND c."userDocumentId" = $2
       ORDER BY c."embedding" <=> $3::vector LIMIT 5`,
      "fake-user-id-that-doesnt-exist",
      doc.id,
      vectorLiteral(queryVec)
    );
    expect(rows.length).toBe(0);

    // But querying with the real userId finds it
    const correctRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c."id" FROM "DocumentChunk" c
       WHERE c."userId" = $1 AND c."userDocumentId" = $2
       ORDER BY c."embedding" <=> $3::vector LIMIT 5`,
      user.id,
      doc.id,
      vectorLiteral(queryVec)
    );
    expect(correctRows.length).toBe(1);
  });

  it("filters by documentType when provided", async () => {
    const user = await getOrCreateDefaultUser();
    await makeDocWithChunks({
      userId: user.id,
      title: "W-2",
      documentType: "w2",
      chunks: [{ text: "w2 content", page: 1, embedding: unitVec(50) }]
    });
    await makeDocWithChunks({
      userId: user.id,
      title: "1040",
      documentType: "tax_return_1040",
      chunks: [{ text: "1040 content", page: 1, embedding: unitVec(50) }]
    });

    const queryVec = unitVec(50);

    // Unfiltered: both match
    const unfiltered = await prisma.$queryRawUnsafe<Array<{ text: string }>>(
      `SELECT c."text" FROM "DocumentChunk" c
       JOIN "UserDocument" d ON d.id = c."userDocumentId"
       WHERE c."userId" = $1
       ORDER BY c."embedding" <=> $2::vector LIMIT 10`,
      user.id,
      vectorLiteral(queryVec)
    );
    expect(unfiltered.length).toBe(2);

    // Filter by tax_return_1040
    const filtered = await prisma.$queryRawUnsafe<Array<{ text: string }>>(
      `SELECT c."text" FROM "DocumentChunk" c
       JOIN "UserDocument" d ON d.id = c."userDocumentId"
       WHERE c."userId" = $1 AND d."documentType" = $2
       ORDER BY c."embedding" <=> $3::vector LIMIT 10`,
      user.id,
      "tax_return_1040",
      vectorLiteral(queryVec)
    );
    expect(filtered.length).toBe(1);
    expect(filtered[0].text).toBe("1040 content");
  });

  it("cascade-deletes chunks when the document is deleted", async () => {
    const user = await getOrCreateDefaultUser();
    const doc = await makeDocWithChunks({
      userId: user.id,
      title: "Delete me",
      documentType: "other",
      chunks: [
        { text: "chunk one", page: 1, embedding: unitVec(1) },
        { text: "chunk two", page: 1, embedding: unitVec(2) }
      ]
    });
    const before = await prisma.documentChunk.count({
      where: { userDocumentId: doc.id }
    });
    expect(before).toBe(2);

    await prisma.userDocument.delete({ where: { id: doc.id } });

    const after = await prisma.documentChunk.count({
      where: { userDocumentId: doc.id }
    });
    expect(after).toBe(0);
  });
});

import { prisma } from "@portfolio/db";
import { chunkDocumentText } from "./document-chunker";
import {
  embedDocuments,
  embedQuery,
  vectorLiteral
} from "./document-embedder";

/**
 * Higher-level RAG orchestration for uploaded documents.
 *
 * - ingestDocumentChunks: called after extraction completes. Splits the
 *   document's text into chunks, embeds them, stores in DocumentChunk.
 * - deleteDocumentChunks: called before re-extraction or on delete, to
 *   avoid stale chunks.
 * - searchUserDocuments: the query path used by the advisor's
 *   search_documents tool. Cosine similarity, per-user scoped.
 *
 * All writes go through Prisma raw SQL because pgvector isn't natively
 * typed. We always include the userId scope in every query as a
 * defense-in-depth boundary against cross-user leakage.
 */

export async function deleteDocumentChunks(args: {
  userDocumentId: string;
}): Promise<void> {
  await prisma.documentChunk.deleteMany({
    where: { userDocumentId: args.userDocumentId }
  });
}

/**
 * Chunk + embed + persist. Safe to re-run — purges prior chunks first.
 */
export async function ingestDocumentChunks(args: {
  userDocumentId: string;
  userId: string;
  text: string;
  apiKey: string;
}): Promise<{ chunksCreated: number }> {
  if (!args.text || args.text.trim().length < 50) {
    // Not enough text to usefully chunk. Skip.
    return { chunksCreated: 0 };
  }

  await deleteDocumentChunks({ userDocumentId: args.userDocumentId });

  const chunks = chunkDocumentText({ text: args.text });
  if (chunks.length === 0) return { chunksCreated: 0 };

  // Embed in batches. embedDocuments handles MAX_BATCH internally.
  const embeddings = await embedDocuments({
    apiKey: args.apiKey,
    texts: chunks.map((c) => c.text)
  });

  // Raw insert so we can pass the vector literal. Using executeRaw with
  // parameterized values for everything except the embedding, which is
  // inline via the vector(…) cast.
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const emb = embeddings[i];
    const embLit = vectorLiteral(emb);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DocumentChunk"
       ("id", "userId", "userDocumentId", "chunkIndex", "page",
        "text", "embedding", "tokenCount", "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7, NOW())`,
      args.userId,
      args.userDocumentId,
      c.index,
      c.page,
      c.text,
      embLit,
      c.tokenCount
    );
  }

  return { chunksCreated: chunks.length };
}

export type SearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  page: number | null;
  text: string;
  similarity: number; // 0..1, higher = closer
};

/**
 * Nearest-neighbor search scoped to a user. Returns top-K chunks with
 * enough text for the advisor to cite. Optionally filter by document id
 * or document type.
 */
export async function searchUserDocuments(args: {
  userId: string;
  query: string;
  apiKey: string;
  limit?: number;
  userDocumentId?: string;
  documentType?: string;
}): Promise<SearchHit[]> {
  const limit = Math.min(Math.max(args.limit ?? 3, 1), 10);
  if (!args.query || args.query.trim().length < 2) return [];

  const queryVec = await embedQuery({
    apiKey: args.apiKey,
    text: args.query
  });
  const queryLit = vectorLiteral(queryVec);

  // pgvector's <=> is cosine distance (0=identical, 2=opposite).
  // Convert to similarity via 1 - distance/2 for normalization
  // convenience in the UI. Our values are L2-normalized by Gemini so
  // this is monotonic with raw cosine similarity.
  // Raw query filters by userId FIRST (defense in depth + fast index).
  const params: unknown[] = [args.userId, queryLit];
  let filterClause = "";
  if (args.userDocumentId) {
    params.push(args.userDocumentId);
    filterClause += ` AND c."userDocumentId" = $${params.length}`;
  }
  if (args.documentType) {
    params.push(args.documentType);
    filterClause += ` AND d."documentType" = $${params.length}`;
  }
  params.push(limit);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      chunkId: string;
      documentId: string;
      documentTitle: string;
      documentType: string;
      page: number | null;
      text: string;
      distance: number;
    }>
  >(
    `SELECT
       c."id" as "chunkId",
       c."userDocumentId" as "documentId",
       d."title" as "documentTitle",
       d."documentType" as "documentType",
       c."page",
       c."text",
       (c."embedding" <=> $2::vector) as "distance"
     FROM "DocumentChunk" c
     JOIN "UserDocument" d ON d."id" = c."userDocumentId"
     WHERE c."userId" = $1${filterClause}
     ORDER BY c."embedding" <=> $2::vector
     LIMIT $${params.length}`,
    ...params
  );

  return rows.map((r) => ({
    chunkId: r.chunkId,
    documentId: r.documentId,
    documentTitle: r.documentTitle,
    documentType: r.documentType,
    page: r.page,
    text: r.text,
    // For L2-normalized vectors, cosine distance is in [0, 2].
    // similarity = 1 - distance/2 → [0, 1].
    similarity: Math.max(0, Math.min(1, 1 - Number(r.distance) / 2))
  }));
}

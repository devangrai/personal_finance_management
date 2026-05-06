/**
 * Gemini text-embedding-004 client.
 *
 * Returns 768-dimensional vectors suitable for pgvector cosine
 * similarity. The free tier is generous (~1.5K requests/min, effectively
 * unlimited for our 1-10 docs/day scale) and ~$0.00001/1K chars on
 * paid tier.
 *
 * Gemini's batchEmbedContents endpoint accepts up to 100 texts per
 * call — we batch aggressively to minimize round-trips.
 */

const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMENSIONS = 768;
const MAX_BATCH = 100;
const EMBED_TIMEOUT_MS = 30_000;

export type EmbedTaskType =
  | "RETRIEVAL_DOCUMENT"
  | "RETRIEVAL_QUERY"
  | "SEMANTIC_SIMILARITY";

type BatchEmbedResponse = {
  embeddings?: Array<{ values?: number[] }>;
  error?: { message?: string };
};

type SingleEmbedResponse = {
  embedding?: { values?: number[] };
  error?: { message?: string };
};

/** L2-normalize a vector in place so cosine similarity via pgvector's
 *  <=> operator on normalized vectors equals true cosine distance.
 *  Gemini's gemini-embedding-001 returns normalized vectors at full
 *  dimensionality only; when truncated via outputDimensionality, we
 *  must re-normalize ourselves. */
function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const x of vec) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vec;
  return vec.map((x) => x / norm);
}

/** Embed a single string. Used for query-time embedding at search. */
export async function embedQuery(args: {
  apiKey: string;
  text: string;
}): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey
      },
      body: JSON.stringify({
        content: { parts: [{ text: args.text }] },
        taskType: "RETRIEVAL_QUERY" as EmbedTaskType,
        outputDimensionality: EMBED_DIMENSIONS
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
    }
  );
  const payload = (await res.json()) as SingleEmbedResponse;
  if (!res.ok) {
    throw new Error(
      payload.error?.message ?? `Gemini embed failed: ${res.status}`
    );
  }
  const values = payload.embedding?.values;
  if (!values || values.length === 0) {
    throw new Error("Gemini returned empty embedding");
  }
  return normalize(values);
}

/**
 * Embed a batch of strings. Handles batching internally if `texts`
 * exceeds MAX_BATCH. Results preserve input order.
 */
export async function embedDocuments(args: {
  apiKey: string;
  texts: string[];
}): Promise<number[][]> {
  if (args.texts.length === 0) return [];
  const all: number[][] = [];

  for (let i = 0; i < args.texts.length; i += MAX_BATCH) {
    const batch = args.texts.slice(i, i + MAX_BATCH);
    const body = {
      requests: batch.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t }] },
        taskType: "RETRIEVAL_DOCUMENT" as EmbedTaskType,
        outputDimensionality: EMBED_DIMENSIONS
      }))
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": args.apiKey
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
      }
    );
    const payload = (await res.json()) as BatchEmbedResponse;
    if (!res.ok) {
      throw new Error(
        payload.error?.message ?? `Gemini batch embed failed: ${res.status}`
      );
    }
    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Gemini returned ${embeddings.length} embeddings for ${batch.length} inputs`
      );
    }
    for (const e of embeddings) {
      if (!e.values || e.values.length === 0) {
        throw new Error("Gemini returned empty embedding in batch");
      }
      all.push(normalize(e.values));
    }
  }

  return all;
}

/** Format a number[] for pgvector's text input (`'[0.1, 0.2, ...]'`). */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

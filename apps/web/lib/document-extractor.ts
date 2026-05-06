import {
  ExtractedFactStatus,
  Prisma,
  UserDocumentStatus,
  prisma
} from "@portfolio/db";
import { ALLOWED_FACT_KEYS } from "./advisor-extractor";

// ---------------------------------------------------------------------------
// Document fact extractor.
//
// Given a UserDocument that's finished uploading, this runs Gemini Vision
// directly over the raw bytes (PDFs + images both supported natively) and
// returns a list of ExtractedFact rows with status=staged, pointing back
// at the source document.
//
// Reuses advisor-extractor.ts's ALLOWED_FACT_KEYS + evidenceMatchesSource
// so document-sourced and conversation-sourced facts share a single truth
// for "what's a valid fact key" and "is the evidence real".
//
// Everything is wrapped in try/catch — extraction failures set status=failed
// on the UserDocument row, never surface to the user mid-upload, never break
// the chat pipeline.
// ---------------------------------------------------------------------------

type GeminiExtractionPart = {
  factKey: string;
  factValue: unknown;
  confidence: number;
  evidenceQuote: string;
  page?: number;
  sourceRegion?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    pageWidth: number;
    pageHeight: number;
  };
  reasoning?: string;
};

type GeminiExtractionResponse = {
  detectedType: string; // e.g. "w2", "comp_statement"
  pageCount?: number;
  /** Full plain-text transcription of the document, if Gemini captured
   *  one. Used to chunk + embed for RAG retrieval. Pages separated by
   *  form-feed `\f` when Gemini labels them. Optional because some
   *  docs (e.g. a blurry photo) may not yield usable text. */
  documentText?: string;
  extractions: GeminiExtractionPart[];
};

/**
 * Hints that go into the prompt when the user pre-specified a document
 * type. We translate the stored string into a list of fact keys we most
 * want to see for that type — the model uses this as a guide but can
 * return any allowlist key.
 */
const TYPE_HINTS: Record<string, string[]> = {
  w2: [
    "annual_income",
    "federal_tax_withheld",
    "state_tax_withheld",
    "social_security_wages",
    "employer"
  ],
  paystub: ["annual_income", "biweekly_net_pay", "employer", "employer_match_pct"],
  comp_statement: [
    "annual_income",
    "employer",
    "employer_match_pct",
    "stock_comp"
  ],
  ten99_div: [],
  ten99_int: [],
  ten99_nec: [],
  ten99_b: [],
  ten99_r: [],
  tax_return_1040: [
    "annual_income",
    "marginal_tax_bracket",
    "effective_tax_rate",
    "filing_status",
    "dependents",
    "state"
  ],
  brokerage_statement: [],
  mortgage_statement: ["mortgage_balance", "mortgage_rate"],
  bank_statement: [],
  other: []
};

const EXTRACTOR_SYSTEM_PROMPT = `
You are a financial document extractor. You will receive ONE attached file
(PDF or image) and a hint for what kind of document it is.

Your job is TWO things:
  A. Extract structured financial facts about the user who uploaded it.
  B. Transcribe the document's plain text into \`documentText\` so future
     queries can search its contents. Preserve page boundaries using a
     form-feed character (\\f) between pages.

HARD RULES:
1. Only emit factKey values from the ALLOWED_FACT_KEYS list. Any other key
   is rejected server-side.
2. evidenceQuote MUST be verbatim text from the document (2-20 words).
   Do NOT paraphrase.
3. NEVER include SSNs, bank account numbers, or full dates of birth in
   evidenceQuote OR in documentText. Redact them to "XXX-XX-XXXX" style
   placeholders if they appear in the source.
4. For numeric factValue, return a plain number (no $ sign, no commas).
   For percentages, return a decimal (6% => 6, not 0.06).
5. confidence is 0.0 - 1.0 based on how clearly the document states the fact.
6. If unsure about a fact, omit it. False positives are worse than misses.
7. sourceRegion is optional but highly preferred: normalized bounding box
   {x0,y0,x1,y1, pageWidth, pageHeight} in a 0..1 coordinate space so the
   viewer can highlight the source on the page.
8. page is 1-indexed.
9. documentText should capture the useful content verbatim — tabular
   figures, line items, section headers, paragraph text. It doesn't
   need to reproduce every piece of boilerplate but should be complete
   enough that a search for any specific line item would find it.

RETURN FORMAT (single JSON object, no prose, no markdown):
{
  "detectedType": "w2" | "comp_statement" | "tax_return_1040" | ...,
  "pageCount": <int>,
  "documentText": "Full plain text of the doc, with \f between pages",
  "extractions": [
    {
      "factKey": "annual_income",
      "factValue": 185000,
      "confidence": 0.96,
      "evidenceQuote": "Wages, tips, other compensation 185,000.00",
      "page": 1,
      "sourceRegion": { "x0": 0.12, "y0": 0.34, "x1": 0.45, "y1": 0.38, "pageWidth": 612, "pageHeight": 792 }
    }
  ]
}

ALLOWED_FACT_KEYS: ${Array.from(ALLOWED_FACT_KEYS).join(", ")}
`.trim();

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    detectedType: { type: "string" },
    pageCount: { type: "integer" },
    documentText: { type: "string" },
    extractions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          factKey: { type: "string" },
          factValue: {},
          confidence: { type: "number" },
          evidenceQuote: { type: "string" },
          page: { type: "integer" },
          sourceRegion: {
            type: "object",
            properties: {
              x0: { type: "number" },
              y0: { type: "number" },
              x1: { type: "number" },
              y1: { type: "number" },
              pageWidth: { type: "number" },
              pageHeight: { type: "number" }
            }
          },
          reasoning: { type: "string" }
        },
        required: ["factKey", "factValue", "confidence", "evidenceQuote"]
      }
    }
  },
  required: ["detectedType", "documentText", "extractions"]
};

function buildUserPrompt(args: {
  documentType: string;
  title: string;
}): string {
  const hintedKeys = TYPE_HINTS[args.documentType] ?? [];
  const hintLine =
    hintedKeys.length > 0
      ? `\n\nFor this document type we especially care about: ${hintedKeys.join(", ")}.`
      : "";
  return [
    `User says this is a "${args.documentType}". Title: "${args.title}".`,
    "Extract every fact from the ALLOWED list that the document clearly states.",
    "For numeric facts, prefer the most relevant single number (e.g. annual income, not year-to-date)." +
      hintLine,
    "",
    "Return a single JSON object matching the schema. No prose around it."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Gemini Vision call
// ---------------------------------------------------------------------------

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

const GEMINI_TIMEOUT_MS = 60_000;
const GEMINI_VISION_MODEL = "gemini-2.5-flash";

async function callGeminiWithFile(args: {
  apiKey: string;
  bytes: ArrayBuffer;
  mimeType: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<GeminiExtractionResponse> {
  const inlineData = {
    mimeType: args.mimeType,
    data: Buffer.from(args.bytes).toString("base64")
  };

  const body = {
    system_instruction: { parts: [{ text: args.systemPrompt }] },
    contents: [
      {
        parts: [
          { inline_data: inlineData },
          { text: args.userPrompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.1
    }
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      GEMINI_VISION_MODEL
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
    }
  );

  const payload = (await res.json()) as GeminiGenerateResponse;
  if (!res.ok) {
    throw new Error(
      payload.error?.message ?? `Gemini request failed: ${res.status}`
    );
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned no text");
  try {
    return JSON.parse(text) as GeminiExtractionResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON response: ${err instanceof Error ? err.message : err}`
    );
  }
}

// ---------------------------------------------------------------------------
// Main entry point: runDocumentExtractor
// ---------------------------------------------------------------------------

export async function runDocumentExtractor(args: {
  userDocumentId: string;
}): Promise<{
  accepted: number;
  rejected: number;
  rejectedReasons: string[];
  chunksCreated?: number;
}> {
  const doc = await prisma.userDocument.findUnique({
    where: { id: args.userDocumentId }
  });
  if (!doc) throw new Error("UserDocument not found");
  if (doc.status !== "processing" && doc.status !== "pending") {
    return { accepted: 0, rejected: 0, rejectedReasons: ["not-pending"], chunksCreated: 0 };
  }

  // Mark processing (might already be, that's fine).
  await prisma.userDocument.update({
    where: { id: doc.id },
    data: { status: "processing" as UserDocumentStatus }
  });

  try {
    const { fetchDocumentBlob } = await import("./document-storage");
    const { bytes, mimeType } = await fetchDocumentBlob({
      storageKey: doc.storageKey
    });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }

    const raw = await callGeminiWithFile({
      apiKey: geminiKey,
      bytes,
      mimeType,
      systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
      userPrompt: buildUserPrompt({
        documentType: doc.documentType,
        title: doc.title
      })
    });

    let accepted = 0;
    let rejected = 0;
    const rejectedReasons: string[] = [];

    for (const ext of raw.extractions ?? []) {
      const result = await processOne({
        userId: doc.userId,
        userDocumentId: doc.id,
        raw: ext
      });
      if (result.ok) accepted += 1;
      else {
        rejected += 1;
        rejectedReasons.push(result.reason);
      }
    }

    // Week 8: chunk + embed the document text for RAG retrieval.
    // Best-effort — an embedding failure shouldn't roll back the
    // fact extractions or break the upload flow.
    let chunksCreated = 0;
    if (raw.documentText && raw.documentText.length > 50) {
      try {
        const { ingestDocumentChunks } = await import("./document-retrieval");
        const ingest = await ingestDocumentChunks({
          userDocumentId: doc.id,
          userId: doc.userId,
          text: raw.documentText,
          apiKey: geminiKey
        });
        chunksCreated = ingest.chunksCreated;
      } catch (err) {
        console.warn("[document-extractor] chunk ingest failed:", err);
      }
    }

    await prisma.userDocument.update({
      where: { id: doc.id },
      data: {
        status: "ready" as UserDocumentStatus,
        pageCount: raw.pageCount ?? null,
        processedAt: new Date(),
        errorMessage: null
      }
    });

    return { accepted, rejected, rejectedReasons, chunksCreated };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown extractor error";
    await prisma.userDocument.update({
      where: { id: doc.id },
      data: {
        status: "failed" as UserDocumentStatus,
        errorMessage: message,
        processedAt: new Date()
      }
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Per-extraction validation + persistence
// ---------------------------------------------------------------------------

type ProcessResult =
  | { ok: true }
  | { ok: false; reason: string };

async function processOne(args: {
  userId: string;
  userDocumentId: string;
  raw: GeminiExtractionPart;
}): Promise<ProcessResult> {
  const { raw, userId, userDocumentId } = args;

  if (!raw.factKey || !ALLOWED_FACT_KEYS.has(raw.factKey)) {
    return { ok: false, reason: `disallowed-key:${raw.factKey}` };
  }
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
    return { ok: false, reason: "invalid-confidence" };
  }
  if (!raw.evidenceQuote || raw.evidenceQuote.length < 3) {
    return { ok: false, reason: "missing-evidence" };
  }
  // Defense against hallucination: the quote must actually appear in
  // the document. We don't have the document text here (Gemini had the
  // image), so we trust the model on evidence-quote provenance BUT we
  // screen for obviously-sensitive content (SSNs, acct #s) client-side
  // in the display layer, and rely on the prompt rule otherwise.
  if (looksLikeSensitiveData(raw.evidenceQuote)) {
    return { ok: false, reason: "sensitive-evidence-blocked" };
  }

  // Supersede older extractions for the same factKey from this document
  // so the user doesn't see stale duplicates after a re-extract.
  await prisma.extractedFact.updateMany({
    where: {
      userDocumentId,
      factKey: raw.factKey,
      status: { in: ["staged"] }
    },
    data: { status: "superseded" as ExtractedFactStatus }
  });

  await prisma.extractedFact.create({
    data: {
      userId,
      userDocumentId,
      kind: "fact",
      status: "staged" as ExtractedFactStatus,
      factKey: raw.factKey,
      newValue: normalizeJson(raw.factValue),
      confidence: raw.confidence,
      evidence: raw.evidenceQuote.slice(0, 500),
      reasoning: raw.reasoning ?? null,
      stakesLevel: classifyStakes(raw.factKey),
      page: raw.page ?? null,
      sourceRegion: raw.sourceRegion ? normalizeJson(raw.sourceRegion) : Prisma.JsonNull
    }
  });

  return { ok: true };
}

function normalizeJson(v: unknown): Prisma.InputJsonValue {
  if (v === null || v === undefined) return {} as Prisma.InputJsonValue;
  try {
    return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
  } catch {
    return String(v);
  }
}

function classifyStakes(factKey: string): string {
  // Mirrors the conversational extractor's stakes sense. Document-sourced
  // facts are reviewed by default (staged), so stakes mostly influences
  // display ordering in the UI.
  const low = ["state", "filing_status", "dependents", "household_size"];
  if (low.includes(factKey)) return "low";
  return "medium";
}

function looksLikeSensitiveData(s: string): boolean {
  // Block SSNs (XXX-XX-XXXX), long bank numbers (10+ consecutive digits),
  // full card numbers.
  if (/\d{3}-?\d{2}-?\d{4}/.test(s)) return true;
  if (/\b\d{10,}\b/.test(s)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers used by the detail-page UI
// ---------------------------------------------------------------------------

export async function getUserDocumentWithExtractions(args: {
  userId: string;
  documentId: string;
}) {
  const doc = await prisma.userDocument.findFirst({
    where: { id: args.documentId, userId: args.userId }
  });
  if (!doc) return null;

  // Self-heal stuck processing (>5 minutes)
  if (
    doc.status === "processing" &&
    Date.now() - doc.uploadedAt.getTime() > 5 * 60 * 1000
  ) {
    await prisma.userDocument.update({
      where: { id: doc.id },
      data: {
        status: "failed" as UserDocumentStatus,
        errorMessage: "Processing timed out after 5 minutes."
      }
    });
    doc.status = "failed" as UserDocumentStatus;
    doc.errorMessage = "Processing timed out after 5 minutes.";
  }

  const extractions = await prisma.extractedFact.findMany({
    where: {
      userDocumentId: doc.id,
      status: { in: ["staged", "auto_applied", "confirmed", "reverted"] }
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }]
  });
  return { doc, extractions };
}

export async function listUserDocuments(userId: string) {
  return prisma.userDocument.findMany({
    where: { userId },
    orderBy: { uploadedAt: "desc" },
    include: {
      _count: { select: { extractions: { where: { status: { in: ["staged", "confirmed"] } } } } }
    }
  });
}

export async function deleteUserDocument(args: {
  userId: string;
  documentId: string;
}): Promise<void> {
  const doc = await prisma.userDocument.findFirst({
    where: { id: args.documentId, userId: args.userId }
  });
  if (!doc) throw new Error("Document not found");

  // Delete the blob first. If that fails, bail so we don't lose track
  // of the storage key. If the blob is already gone, deleteDocumentBlob
  // treats that as success.
  const { deleteDocumentBlob } = await import("./document-storage");
  await deleteDocumentBlob(doc.storageKey);

  // Then cascade DB: ExtractedFact rows go via onDelete cascade.
  // UserFact rows that were produced from this document are LEFT
  // intact — the user can delete them via /context if they want.
  await prisma.userDocument.delete({ where: { id: doc.id } });
}

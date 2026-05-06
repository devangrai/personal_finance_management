/**
 * Token-aware text chunker with overlap.
 *
 * Splits document text into overlapping chunks suitable for embedding.
 * Aims for ~CHUNK_TOKENS tokens per chunk with CHUNK_OVERLAP shared
 * between adjacent chunks. Preserves paragraph/page boundaries where
 * possible so a chunk rarely cuts a sentence mid-word.
 *
 * We approximate tokens as ~4 characters (reasonable for English prose
 * + tabular financial forms). For Gemini's text-embedding-004 the hard
 * limit is 2048 input tokens per request — we stay well under that.
 */

export type ChunkInput = {
  /** Entire document text. Pages can be separated by `\f` (form-feed)
   *  or `\n\n---\n\n`; the splitter respects both if present. */
  text: string;
};

export type Chunk = {
  index: number;
  text: string;
  page: number | null;
  tokenCount: number;
};

const CHUNK_TOKENS = 800;
const CHUNK_OVERLAP = 150;
const CHARS_PER_TOKEN = 4;
const CHUNK_CHAR_TARGET = CHUNK_TOKENS * CHARS_PER_TOKEN;
const CHUNK_OVERLAP_CHARS = CHUNK_OVERLAP * CHARS_PER_TOKEN;

type PagedBlock = { page: number | null; text: string };

/** Try to split the raw text into per-page blocks. Returns one block
 *  with page=null when no page markers are found. */
function splitIntoPages(text: string): PagedBlock[] {
  // Form-feed character is the standard PDF page delimiter.
  if (text.includes("\f")) {
    return text
      .split("\f")
      .map((chunk, i) => ({ page: i + 1, text: chunk.trim() }))
      .filter((b) => b.text.length > 0);
  }
  // Some extractors emit "=== PAGE N ===" markers.
  const m = text.match(/===\s*PAGE\s+\d+/gi);
  if (m && m.length > 1) {
    const pageRegex = /===\s*PAGE\s+(\d+)[^\n]*\n/gi;
    const parts: PagedBlock[] = [];
    let lastEnd = 0;
    let lastPage: number | null = null;
    let match: RegExpExecArray | null;
    while ((match = pageRegex.exec(text))) {
      if (lastPage !== null && match.index > lastEnd) {
        parts.push({
          page: lastPage,
          text: text.slice(lastEnd, match.index).trim()
        });
      }
      lastPage = Number(match[1]);
      lastEnd = match.index + match[0].length;
    }
    if (lastPage !== null && lastEnd < text.length) {
      parts.push({ page: lastPage, text: text.slice(lastEnd).trim() });
    }
    return parts.filter((b) => b.text.length > 0);
  }
  return [{ page: null, text: text.trim() }];
}

/** Prefer to break at paragraph / sentence boundaries near the target
 *  window end. Returns the break index relative to `text`. */
function findBreakPoint(text: string, targetChars: number): number {
  if (text.length <= targetChars) return text.length;
  // Look for a paragraph break within the last 20% of the window.
  const backWindow = Math.floor(targetChars * 0.2);
  const searchStart = Math.max(0, targetChars - backWindow);
  const slice = text.slice(searchStart, targetChars);
  const para = slice.lastIndexOf("\n\n");
  if (para !== -1) return searchStart + para + 2;
  const nl = slice.lastIndexOf("\n");
  if (nl !== -1) return searchStart + nl + 1;
  // Sentence boundary.
  const sent = slice.match(/[.!?]\s+(?=[A-Z0-9])/g);
  if (sent && sent.length > 0) {
    const last = slice.lastIndexOf(sent[sent.length - 1]);
    if (last !== -1) return searchStart + last + sent[sent.length - 1].length;
  }
  // Fallback: break at the next space after the target.
  const space = text.indexOf(" ", targetChars);
  return space === -1 ? text.length : space;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

export function chunkDocumentText(input: ChunkInput): Chunk[] {
  const blocks = splitIntoPages(input.text);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const block of blocks) {
    const pageNumber = block.page;
    let pos = 0;
    const t = block.text;
    if (t.length === 0) continue;

    while (pos < t.length) {
      const remaining = t.length - pos;
      if (remaining <= CHUNK_CHAR_TARGET) {
        const slice = t.slice(pos).trim();
        if (slice.length > 0) {
          chunks.push({
            index: chunkIndex++,
            text: slice,
            page: pageNumber,
            tokenCount: estimateTokens(slice)
          });
        }
        break;
      }
      const windowText = t.slice(pos, pos + CHUNK_CHAR_TARGET + 400);
      const breakAt = findBreakPoint(windowText, CHUNK_CHAR_TARGET);
      const slice = t.slice(pos, pos + breakAt).trim();
      if (slice.length > 0) {
        chunks.push({
          index: chunkIndex++,
          text: slice,
          page: pageNumber,
          tokenCount: estimateTokens(slice)
        });
      }
      // Advance with overlap — back up by CHUNK_OVERLAP_CHARS unless
      // it would go backwards from where we started.
      const nextPos = pos + breakAt - CHUNK_OVERLAP_CHARS;
      pos = Math.max(pos + 1, nextPos);
    }
  }

  return chunks;
}

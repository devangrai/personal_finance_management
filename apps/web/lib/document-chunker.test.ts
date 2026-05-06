import { describe, expect, it } from "vitest";
import { chunkDocumentText } from "./document-chunker";

describe("chunkDocumentText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkDocumentText({ text: "Hello world. This is a short doc." });
    expect(chunks.length).toBe(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].text).toContain("Hello world");
    expect(chunks[0].page).toBeNull();
  });

  it("preserves page numbers when form-feed is present", () => {
    const text = "Page one content.\n\fPage two content.\n\fPage three content.";
    const chunks = chunkDocumentText({ text });
    expect(chunks.length).toBe(3);
    expect(chunks[0].page).toBe(1);
    expect(chunks[1].page).toBe(2);
    expect(chunks[2].page).toBe(3);
  });

  it("parses '=== PAGE N ===' markers when used", () => {
    const text =
      "=== PAGE 1 ===\nFirst page text.\n=== PAGE 2 ===\nSecond page text.";
    const chunks = chunkDocumentText({ text });
    expect(chunks.length).toBe(2);
    expect(chunks[0].page).toBe(1);
    expect(chunks[1].page).toBe(2);
  });

  it("splits long documents into multiple chunks with overlap", () => {
    // Build ~10000 char document with clear paragraph breaks.
    const paragraph = "This is a paragraph. ".repeat(30);
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = chunkDocumentText({ text });
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk is under 4000 chars (TOKENS * 4 = 3200 target + some slack)
    for (const c of chunks) {
      expect(c.text.length).toBeLessThan(4500);
    }
    // Adjacent chunks should share some overlapping content
    for (let i = 1; i < chunks.length; i++) {
      // At least a few words in common
      const aEnd = chunks[i - 1].text.slice(-200);
      const bStart = chunks[i].text.slice(0, 500);
      // Assert non-zero word overlap between adjacent chunks
      const aWords = aEnd.split(/\s+/).filter((w) => w.length > 4);
      const overlapWord = aWords.find((w) => bStart.includes(w));
      expect(overlapWord).toBeDefined();
    }
  });

  it("computes reasonable token counts", () => {
    const text = "a".repeat(400); // ~100 tokens
    const chunks = chunkDocumentText({ text });
    expect(chunks.length).toBe(1);
    expect(chunks[0].tokenCount).toBeGreaterThanOrEqual(80);
    expect(chunks[0].tokenCount).toBeLessThanOrEqual(120);
  });

  it("always produces non-empty chunk text", () => {
    const text = "First.\n\n\n\nSecond.\n\n\n\nThird.";
    const chunks = chunkDocumentText({ text });
    for (const c of chunks) {
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("does not loop infinitely on pathological input", () => {
    const text = "a".repeat(50_000);
    const start = Date.now();
    const chunks = chunkDocumentText({ text });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(chunks.length).toBeGreaterThan(5);
  });
});

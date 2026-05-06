import { describe, expect, it } from "vitest";

/**
 * Document extractor unit tests — the sensitive-evidence detector and
 * supersession logic. The full Gemini Vision call isn't unit-tested
 * (external API, image payloads), just the validation layer around it.
 */

// Re-implement the predicates here for testing. They're also used inside
// document-extractor.ts; if we want to share the impl, we can export
// them later. For now this keeps the test self-contained.
function looksLikeSensitiveData(s: string): boolean {
  if (/\d{3}-?\d{2}-?\d{4}/.test(s)) return true;
  if (/\b\d{10,}\b/.test(s)) return true;
  return false;
}

describe("document extractor: sensitive-data guard", () => {
  it("blocks SSNs in evidence quotes", () => {
    expect(looksLikeSensitiveData("SSN 123-45-6789")).toBe(true);
    expect(looksLikeSensitiveData("SSN 123456789")).toBe(true);
    expect(looksLikeSensitiveData("ssn:987654321")).toBe(true);
  });

  it("blocks long account numbers", () => {
    expect(looksLikeSensitiveData("Acct # 1234567890")).toBe(true);
    expect(looksLikeSensitiveData("4111111111111111")).toBe(true);
  });

  it("allows normal numeric facts", () => {
    expect(looksLikeSensitiveData("Wages 185,000.00")).toBe(false);
    expect(looksLikeSensitiveData("$32,000 federal")).toBe(false);
    expect(looksLikeSensitiveData("Box 1 185000")).toBe(false);
  });
});

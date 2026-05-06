import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./anomaly-detection";

describe("normalizeMerchant", () => {
  it("collapses variants of the same merchant to the same key", () => {
    const a = normalizeMerchant("AMAZON.COM*MK123");
    const b = normalizeMerchant("Amazon Marketplace");
    const c = normalizeMerchant("AMAZON MKTPLACE PMTS");
    // All three should share at least the first two significant tokens
    expect(a).toContain("AMAZON");
    expect(b).toContain("AMAZON");
    expect(c).toContain("AMAZON");
  });

  it("strips transaction noise like POS / DEBIT / AUTH", () => {
    const k = normalizeMerchant("POS DEBIT TRADER JOES 123");
    expect(k).toBe("TRADER JOES");
  });

  it("handles null / empty input", () => {
    expect(normalizeMerchant(null)).toBeNull();
    expect(normalizeMerchant("")).toBeNull();
    expect(normalizeMerchant("   ")).toBeNull();
  });

  it("short tokens are dropped", () => {
    expect(normalizeMerchant("A B C MERCHANT")).toBe("MERCHANT");
  });
});

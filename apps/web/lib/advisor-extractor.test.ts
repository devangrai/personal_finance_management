import { describe, expect, it } from "vitest";
import {
  ALLOWED_FACT_KEYS,
  evidenceMatchesSource,
  isTurnWorthExtracting
} from "./advisor-extractor";

describe("advisor-extractor pre-filter", () => {
  it("skips trivially short turns", () => {
    const r = isTurnWorthExtracting("ok");
    expect(r.worth).toBe(false);
    expect(r.reason).toMatch(/short|words/);
  });

  it("skips pure data queries", () => {
    const r = isTurnWorthExtracting("What is the weather today like outside?");
    // 8 words, contains no personal-signal keywords → skip
    expect(r.worth).toBe(false);
    expect(r.reason).toMatch(/signals/);
  });

  it("accepts turns with personal signals", () => {
    expect(isTurnWorthExtracting("I make about 180k and I'm in Washington.").worth).toBe(true);
    expect(isTurnWorthExtracting("We want to buy a house in 3 years.").worth).toBe(true);
    expect(isTurnWorthExtracting("My 401k match is 6 percent at my job.").worth).toBe(true);
  });

  it("accepts turns about goals even without first-person subjects", () => {
    expect(isTurnWorthExtracting("The goal is to retire by 60 and travel.").worth).toBe(true);
  });
});

describe("advisor-extractor evidence validation", () => {
  it("accepts verbatim evidence", () => {
    const src = "I make about 180k and I'm in Washington state.";
    expect(evidenceMatchesSource("I make about 180k", src)).toBe(true);
    expect(evidenceMatchesSource("Washington state", src)).toBe(true);
  });

  it("rejects fabricated evidence", () => {
    const src = "I make about 180k.";
    expect(evidenceMatchesSource("I make $500,000/yr", src)).toBe(false);
    expect(evidenceMatchesSource("My retirement plan is aggressive", src)).toBe(false);
  });

  it("accepts fuzzy paraphrasing when enough words overlap", () => {
    const src = "I make about 180k per year";
    // evidence with 80% word overlap should pass
    expect(evidenceMatchesSource("I make 180k", src)).toBe(true);
  });

  it("rejects evidence with too little word overlap", () => {
    const src = "I make 180k";
    expect(evidenceMatchesSource("I live in a house with seven children", src)).toBe(false);
  });

  it("rejects empty or tiny evidence", () => {
    expect(evidenceMatchesSource("", "anything")).toBe(false);
    expect(evidenceMatchesSource("hi", "hi there")).toBe(false);
  });
});

describe("advisor-extractor allowlist", () => {
  it("allows expected core keys", () => {
    expect(ALLOWED_FACT_KEYS.has("annual_income")).toBe(true);
    expect(ALLOWED_FACT_KEYS.has("state")).toBe(true);
    expect(ALLOWED_FACT_KEYS.has("marginal_tax_bracket")).toBe(true);
    expect(ALLOWED_FACT_KEYS.has("risk_tolerance")).toBe(true);
  });

  it("rejects injection-style keys", () => {
    expect(ALLOWED_FACT_KEYS.has("admin_password")).toBe(false);
    expect(ALLOWED_FACT_KEYS.has("IGNORE_INSTRUCTIONS")).toBe(false);
    expect(ALLOWED_FACT_KEYS.has("__proto__")).toBe(false);
  });
});

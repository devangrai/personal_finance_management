import { describe, expect, it } from "vitest";
import {
  daysInMonth,
  formatMonthKey,
  mapPlaidPfcToCategoryKey,
  parseMonthKey
} from "./budget-comparison";

describe("budget-comparison helpers", () => {
  it("parses month keys", () => {
    const d = parseMonthKey("2026-06");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // 0-indexed
    expect(d.getDate()).toBe(1);
  });

  it("throws on invalid month keys", () => {
    expect(() => parseMonthKey("not-a-date")).toThrow();
    expect(() => parseMonthKey("2026-13")).toThrow();
    expect(() => parseMonthKey("")).toThrow();
  });

  it("formats month keys with leading zero", () => {
    expect(formatMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(formatMonthKey(new Date(2026, 11, 31))).toBe("2026-12");
  });

  it("computes days in month correctly", () => {
    expect(daysInMonth(new Date(2026, 1, 1))).toBe(28); // Feb 2026 (not leap)
    expect(daysInMonth(new Date(2024, 1, 1))).toBe(29); // Feb 2024 (leap)
    expect(daysInMonth(new Date(2026, 3, 1))).toBe(30); // April
    expect(daysInMonth(new Date(2026, 6, 1))).toBe(31); // July
  });
});

describe("mapPlaidPfcToCategoryKey", () => {
  it("maps groceries specifically", () => {
    expect(mapPlaidPfcToCategoryKey("FOOD_AND_DRINK_GROCERIES")).toBe(
      "groceries"
    );
  });

  it("maps food-and-drink (non-groceries) to dining", () => {
    expect(mapPlaidPfcToCategoryKey("FOOD_AND_DRINK_RESTAURANT")).toBe(
      "dining"
    );
    expect(mapPlaidPfcToCategoryKey("FOOD_AND_DRINK_COFFEE")).toBe("dining");
  });

  it("maps general_merchandise to shopping", () => {
    expect(mapPlaidPfcToCategoryKey("GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES")).toBe(
      "shopping"
    );
  });

  it("maps transportation", () => {
    expect(mapPlaidPfcToCategoryKey("TRANSPORTATION_GAS")).toBe(
      "transportation"
    );
    expect(mapPlaidPfcToCategoryKey("TRANSPORTATION_TAXIS_AND_RIDE_SHARES")).toBe(
      "transportation"
    );
  });

  it("maps rent_and_utilities to utilities", () => {
    expect(mapPlaidPfcToCategoryKey("RENT_AND_UTILITIES_INTERNET")).toBe(
      "utilities"
    );
  });

  it("returns null for non-spending PFCs", () => {
    expect(mapPlaidPfcToCategoryKey("INCOME_CONTRACTOR")).toBeNull();
    expect(mapPlaidPfcToCategoryKey("TRANSFER_IN_DEPOSIT")).toBeNull();
    expect(mapPlaidPfcToCategoryKey("TRANSFER_OUT_ACCOUNT_TRANSFER")).toBeNull();
    expect(mapPlaidPfcToCategoryKey("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBeNull();
  });

  it("returns null for unknown PFC", () => {
    expect(mapPlaidPfcToCategoryKey(null)).toBeNull();
    expect(mapPlaidPfcToCategoryKey("SOMETHING_INVENTED")).toBeNull();
  });
});

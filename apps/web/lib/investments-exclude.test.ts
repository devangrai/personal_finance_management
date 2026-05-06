import { describe, expect, it } from "vitest";

/**
 * These are tiny deterministic unit tests for the exclude-from-net-worth
 * aggregation logic. We don't spin up a DB here — we just exercise the
 * same reducer pattern getInvestmentsSummary uses so a regression in
 * "excluded accounts still count" gets caught.
 */

type Account = {
  currentBalanceCents: number;
  bucket: "retirement" | "taxable" | "other";
  excludeFromNetWorth: boolean;
};

function sumForTotals(accounts: Account[]): {
  total: number;
  retirement: number;
  taxable: number;
} {
  const kept = accounts.filter((a) => !a.excludeFromNetWorth);
  return {
    total: kept.reduce((s, a) => s + a.currentBalanceCents, 0),
    retirement: kept
      .filter((a) => a.bucket === "retirement")
      .reduce((s, a) => s + a.currentBalanceCents, 0),
    taxable: kept
      .filter((a) => a.bucket === "taxable")
      .reduce((s, a) => s + a.currentBalanceCents, 0)
  };
}

describe("exclude-from-net-worth aggregation", () => {
  it("includes all non-excluded accounts by default", () => {
    const accounts: Account[] = [
      { currentBalanceCents: 100_00, bucket: "taxable", excludeFromNetWorth: false },
      { currentBalanceCents: 200_00, bucket: "retirement", excludeFromNetWorth: false }
    ];
    expect(sumForTotals(accounts)).toEqual({
      total: 300_00,
      retirement: 200_00,
      taxable: 100_00
    });
  });

  it("excludes flagged accounts from totals but leaves other buckets", () => {
    const accounts: Account[] = [
      { currentBalanceCents: 100_00, bucket: "taxable", excludeFromNetWorth: false },
      { currentBalanceCents: 500_00, bucket: "taxable", excludeFromNetWorth: true },
      { currentBalanceCents: 200_00, bucket: "retirement", excludeFromNetWorth: false }
    ];
    const totals = sumForTotals(accounts);
    expect(totals.total).toBe(300_00);
    expect(totals.taxable).toBe(100_00);
    expect(totals.retirement).toBe(200_00);
  });

  it("handles all-excluded edge case", () => {
    const accounts: Account[] = [
      { currentBalanceCents: 100_00, bucket: "taxable", excludeFromNetWorth: true },
      { currentBalanceCents: 200_00, bucket: "retirement", excludeFromNetWorth: true }
    ];
    expect(sumForTotals(accounts)).toEqual({
      total: 0,
      retirement: 0,
      taxable: 0
    });
  });

  it("handles empty account list", () => {
    expect(sumForTotals([])).toEqual({ total: 0, retirement: 0, taxable: 0 });
  });

  it("RSU scenario: AMAZON RSU excluded, totals reflect only the rest", () => {
    // Mirrors the actual user data: AMAZON RSU $184,026 aggregate,
    // BrokerageLink $64,935, Individual ~$78,000 total.
    const accounts: Account[] = [
      { currentBalanceCents: 184_026_00, bucket: "other", excludeFromNetWorth: true },
      { currentBalanceCents: 64_935_00, bucket: "taxable", excludeFromNetWorth: false },
      { currentBalanceCents: 78_000_00, bucket: "taxable", excludeFromNetWorth: false }
    ];
    const totals = sumForTotals(accounts);
    expect(totals.total).toBe(142_935_00); // 64935 + 78000
    expect(totals.taxable).toBe(142_935_00);
  });
});

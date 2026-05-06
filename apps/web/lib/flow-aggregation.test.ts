import { describe, expect, it } from "vitest";
import {
  aggregateForSankey,
  classifyIncomeSource,
  looksLikeInternalTransfer,
  resolveWindow,
  type AggregatorTxn
} from "./flow-aggregation";

function txn(overrides: Partial<AggregatorTxn>): AggregatorTxn {
  return {
    id: "t1",
    date: new Date("2026-05-01"),
    amount: 100,
    direction: "debit",
    name: "Unknown",
    merchantName: null,
    accountId: "acct1",
    accountName: "Checking",
    accountType: "depository",
    accountSubtype: "checking",
    categoryKey: "groceries",
    categoryLabel: "Groceries",
    personalFinanceCategory: null,
    ...overrides
  };
}

describe("resolveWindow", () => {
  const now = new Date(Date.UTC(2026, 4, 15)); // May 15 2026

  it("this-month resolves to May 1 - June 1", () => {
    const w = resolveWindow("this-month", now);
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-06-01");
    expect(w.monthsSpanned).toBe(1);
  });

  it("last-month resolves to April 1 - May 1", () => {
    const w = resolveWindow("last-month", now);
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-05-01");
  });

  it("avg-3mo resolves to a 3-month span ending at May 1", () => {
    const w = resolveWindow("avg-3mo", now);
    expect(w.start.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(w.monthsSpanned).toBe(3);
  });

  it("avg-12mo resolves to a 12-month span ending at May 1", () => {
    const w = resolveWindow("avg-12mo", now);
    expect(w.start.toISOString().slice(0, 10)).toBe("2025-05-01");
    expect(w.end.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(w.monthsSpanned).toBe(12);
  });
});

describe("classifyIncomeSource", () => {
  it("classifies direct deposit as paycheck", () => {
    expect(
      classifyIncomeSource(
        txn({ name: "DIRECT DEPOSIT ACME CORP", direction: "credit" })
      ).id
    ).toBe("src:paycheck");
  });

  it("classifies interest payments correctly", () => {
    expect(
      classifyIncomeSource(txn({ name: "INTEREST PAYMENT", direction: "credit" }))
        .id
    ).toBe("src:interest");
  });

  it("falls through to other-income for unknown inflows", () => {
    expect(
      classifyIncomeSource(txn({ name: "CASH RECEIVED", direction: "credit" })).id
    ).toBe("src:other-income");
  });

  it("honors personalFinanceCategory hint for paycheck", () => {
    expect(
      classifyIncomeSource(
        txn({
          name: "ACME INC",
          direction: "credit",
          personalFinanceCategory: "INCOME_PAYROLL"
        })
      ).id
    ).toBe("src:paycheck");
  });
});

describe("looksLikeInternalTransfer", () => {
  it("flags an explicit 'transfer to savings'", () => {
    expect(
      looksLikeInternalTransfer(txn({ name: "Transfer to Savings" }))
    ).toBe(true);
  });

  it("flags Fidelity brokerage deposits", () => {
    expect(
      looksLikeInternalTransfer(txn({ name: "FID BKG SVC LLC MONEYLINE" }))
    ).toBe(true);
  });

  it("does not flag regular merchant purchases", () => {
    expect(looksLikeInternalTransfer(txn({ name: "Trader Joe's" }))).toBe(false);
  });
});

describe("aggregateForSankey", () => {
  it("builds a simple paycheck → checking → grocery flow", () => {
    const txns = [
      txn({
        id: "1",
        amount: 5000,
        direction: "credit",
        name: "DIRECT DEPOSIT",
        categoryKey: null,
        categoryLabel: null
      }),
      txn({
        id: "2",
        amount: 400,
        direction: "debit",
        name: "TRADER JOES",
        categoryKey: "groceries",
        categoryLabel: "Groceries"
      })
    ];
    const result = aggregateForSankey(txns, 1);
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    expect(nodeIds.has("src:paycheck")).toBe(true);
    expect(nodeIds.has("acct:acct1")).toBe(true);
    expect(nodeIds.has("cat:groceries")).toBe(true);
    expect(result.totals.inflow).toBe(5000);
    expect(result.totals.outflow).toBe(400);
    expect(result.totals.net).toBe(4600);
    // 2 links: paycheck→checking $5000, checking→groceries $400
    expect(result.links.length).toBe(2);
  });

  it("filters out internal transfers", () => {
    const txns = [
      txn({
        id: "1",
        amount: 1000,
        direction: "debit",
        name: "Transfer to Savings"
      })
    ];
    const result = aggregateForSankey(txns, 1);
    expect(result.links.length).toBe(0);
    expect(result.nodes.length).toBe(0);
  });

  it("averages per month when monthsSpanned > 1", () => {
    const txns = [
      txn({
        id: "1",
        amount: 300,
        direction: "debit",
        name: "Grocery",
        categoryKey: "groceries",
        categoryLabel: "Groceries"
      })
    ];
    const result = aggregateForSankey(txns, 3);
    // $300 over 3 months → $100 / mo
    expect(result.links[0].value).toBeCloseTo(100, 1);
  });

  it("drops links below the $5/month minimum to avoid noise", () => {
    const txns = [
      txn({
        id: "1",
        amount: 2,
        direction: "debit",
        categoryKey: "misc",
        categoryLabel: "Misc"
      })
    ];
    const result = aggregateForSankey(txns, 1);
    expect(result.links.length).toBe(0);
  });

  it("routes credit-card-payment outflows to the CC payoff node", () => {
    const txns = [
      txn({
        id: "1",
        amount: 800,
        direction: "debit",
        name: "CHASE CREDIT CARD PAYMENT",
        categoryKey: "credit_card_payment",
        categoryLabel: "Credit card payment"
      })
    ];
    const result = aggregateForSankey(txns, 1);
    const nodeIds = new Set(result.nodes.map((n) => n.id));
    expect(nodeIds.has("tgt:cc-payoff")).toBe(true);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@portfolio/db";
import {
  computeMonthlyBudgetStatus,
  suggestBudgetsFromHistory,
  upsertBudget
} from "./budget-comparison";
import { getOrCreateDefaultUser } from "./user";

/**
 * Budget compute integration tests. Seeds test categories, transactions,
 * and budgets, then asserts the monthly status.
 *
 * We create a temporary PlaidItem + Account if one doesn't exist, and
 * tear those down in cleanup. All test rows use distinctive id prefixes
 * so we can filter them out of cross-test pollution.
 */

const CAT_DINING = "__test_dining";
const CAT_GROCERIES = "__test_groceries";
const TXN_PREFIX = "__budget_test_";
const ITEM_PREFIX = "__budget_test_item";
const ACCT_PREFIX = "__budget_test_acct";

async function cleanup() {
  const user = await getOrCreateDefaultUser();
  await prisma.budget.deleteMany({ where: { userId: user.id } });
  await prisma.transactionCategory.deleteMany({
    where: { userId: user.id, key: { in: [CAT_DINING, CAT_GROCERIES] } }
  });
  await prisma.transaction.deleteMany({
    where: { userId: user.id, plaidTransactionId: { startsWith: TXN_PREFIX } }
  });
  await prisma.account.deleteMany({
    where: { userId: user.id, plaidAccountId: { startsWith: ACCT_PREFIX } }
  });
  await prisma.plaidItem.deleteMany({
    where: { userId: user.id, plaidItemId: { startsWith: ITEM_PREFIX } }
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function ensureTestAccount(userId: string): Promise<string> {
  // Prefer an existing non-test account if one exists.
  const existing = await prisma.account.findFirst({ where: { userId } });
  if (existing) return existing.id;
  const item = await prisma.plaidItem.create({
    data: {
      userId,
      plaidItemId: `${ITEM_PREFIX}_${Date.now()}`,
      accessTokenEncrypted: "test",
      institutionId: "test",
      institutionName: "Test Bank",
      status: "active"
    }
  });
  const acct = await prisma.account.create({
    data: {
      userId,
      plaidItemId: item.id,
      plaidAccountId: `${ACCT_PREFIX}_${Date.now()}`,
      name: "Test Checking",
      type: "depository",
      subtype: "checking"
    }
  });
  return acct.id;
}

async function seedCategoriesAndTxns(args: {
  userId: string;
  accountId: string;
  month: Date;
}) {
  const diningCat = await prisma.transactionCategory.create({
    data: { userId: args.userId, key: CAT_DINING, label: "Test Dining" }
  });
  const groceriesCat = await prisma.transactionCategory.create({
    data: { userId: args.userId, key: CAT_GROCERIES, label: "Test Groceries" }
  });
  const txs = [
    { amount: 50, cat: diningCat, day: 3 },
    { amount: 60, cat: diningCat, day: 10 },
    { amount: 40, cat: diningCat, day: 14 },
    { amount: 120, cat: groceriesCat, day: 5 },
    { amount: 80, cat: groceriesCat, day: 12 }
  ];
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    await prisma.transaction.create({
      data: {
        userId: args.userId,
        accountId: args.accountId,
        plaidTransactionId: `${TXN_PREFIX}${args.month.getTime()}_${i}`,
        date: new Date(args.month.getFullYear(), args.month.getMonth(), t.day),
        name: `Test txn ${i}`,
        amount: t.amount,
        direction: "debit",
        categoryId: t.cat.id
      }
    });
  }
  return { diningCat, groceriesCat };
}

describe("computeMonthlyBudgetStatus", () => {
  it("returns per-category spending with no budgets set", async () => {
    const user = await getOrCreateDefaultUser();
    const accountId = await ensureTestAccount(user.id);
    const month = new Date(2026, 5, 1);
    await seedCategoriesAndTxns({ userId: user.id, accountId, month });

    const status = await computeMonthlyBudgetStatus({
      userId: user.id,
      month: "2026-06",
      asOf: new Date(2026, 5, 15)
    });
    expect(status.daysElapsed).toBe(15);
    expect(status.daysInMonth).toBe(30);
    const dining = status.categories.find((c) => c.categoryKey === CAT_DINING);
    const groceries = status.categories.find(
      (c) => c.categoryKey === CAT_GROCERIES
    );
    expect(dining?.spentCents).toBe(15000);
    expect(groceries?.spentCents).toBe(20000);
    expect(dining?.budgetCents).toBeNull();
    expect(dining?.flag).toBe("no_budget");
  });

  it("computes percentages and flags when budgets are set", async () => {
    const user = await getOrCreateDefaultUser();
    const accountId = await ensureTestAccount(user.id);
    const month = new Date(2026, 5, 1);
    const { diningCat, groceriesCat } = await seedCategoriesAndTxns({
      userId: user.id,
      accountId,
      month
    });
    await upsertBudget({
      userId: user.id,
      categoryId: diningCat.id,
      monthlyAmountCents: BigInt(50000),
      activeFromMonth: month
    });
    await upsertBudget({
      userId: user.id,
      categoryId: groceriesCat.id,
      monthlyAmountCents: BigInt(30000),
      activeFromMonth: month
    });

    const status = await computeMonthlyBudgetStatus({
      userId: user.id,
      month: "2026-06",
      asOf: new Date(2026, 5, 15)
    });
    const dining = status.categories.find((c) => c.categoryKey === CAT_DINING)!;
    const groceries = status.categories.find(
      (c) => c.categoryKey === CAT_GROCERIES
    )!;
    // $150 / $500 = 30%
    expect(dining.percent).toBe(30);
    expect(dining.flag).toBe("on_pace");
    // $200 spent over 15 days → projected $400 → 133% of $300 → warning
    expect(groceries.projectedCents).toBeCloseTo(40000, 0);
    expect(groceries.projectedPercent).toBeCloseTo(133.33, 0);
    expect(groceries.flag).toBe("warning");
  });

  it("marks categories as 'over' when spent >= budget", async () => {
    const user = await getOrCreateDefaultUser();
    const accountId = await ensureTestAccount(user.id);
    const month = new Date(2026, 5, 1);
    const { diningCat } = await seedCategoriesAndTxns({
      userId: user.id,
      accountId,
      month
    });
    // $150 spent, budget $100 → over
    await upsertBudget({
      userId: user.id,
      categoryId: diningCat.id,
      monthlyAmountCents: BigInt(10000),
      activeFromMonth: month
    });
    const status = await computeMonthlyBudgetStatus({
      userId: user.id,
      month: "2026-06",
      asOf: new Date(2026, 5, 15)
    });
    const dining = status.categories.find((c) => c.categoryKey === CAT_DINING)!;
    expect(dining.flag).toBe("over");
  });

  it("respects userId scoping", async () => {
    const status = await computeMonthlyBudgetStatus({
      userId: "fake-user-does-not-exist",
      month: "2026-06",
      asOf: new Date(2026, 5, 15)
    });
    expect(status.totalSpentCents).toBe(0);
    expect(status.categories.length).toBe(0);
  });
});

describe("suggestBudgetsFromHistory", () => {
  it("produces rounded suggestions from trailing history", async () => {
    const user = await getOrCreateDefaultUser();
    const accountId = await ensureTestAccount(user.id);
    // Seed categories ONCE then seed transactions for 3 prior months.
    const diningCat = await prisma.transactionCategory.create({
      data: { userId: user.id, key: CAT_DINING, label: "Test Dining" }
    });
    const groceriesCat = await prisma.transactionCategory.create({
      data: { userId: user.id, key: CAT_GROCERIES, label: "Test Groceries" }
    });
    const now = new Date();
    for (let mb = 1; mb <= 3; mb++) {
      const month = new Date(now.getFullYear(), now.getMonth() - mb, 1);
      const txs = [
        { amount: 50, cat: diningCat, day: 3 },
        { amount: 60, cat: diningCat, day: 10 },
        { amount: 40, cat: diningCat, day: 14 },
        { amount: 120, cat: groceriesCat, day: 5 },
        { amount: 80, cat: groceriesCat, day: 12 }
      ];
      for (let i = 0; i < txs.length; i++) {
        const t = txs[i];
        await prisma.transaction.create({
          data: {
            userId: user.id,
            accountId,
            plaidTransactionId: `${TXN_PREFIX}${month.getTime()}_${i}`,
            date: new Date(month.getFullYear(), month.getMonth(), t.day),
            name: `Test txn ${i}`,
            amount: t.amount,
            direction: "debit",
            categoryId: t.cat.id
          }
        });
      }
    }

    const suggestions = await suggestBudgetsFromHistory({
      userId: user.id,
      months: 3
    });
    const dining = suggestions.find((s) => s.categoryLabel === "Test Dining");
    const groceries = suggestions.find(
      (s) => s.categoryLabel === "Test Groceries"
    );
    expect(dining).toBeDefined();
    expect(groceries).toBeDefined();
    expect(dining!.suggestedCents % 500).toBe(0);
    expect(groceries!.suggestedCents % 500).toBe(0);
    expect(dining!.suggestedCents).toBeGreaterThan(0);
  });
});

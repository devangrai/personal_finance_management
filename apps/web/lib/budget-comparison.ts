import { prisma } from "@portfolio/db";

// ---------------------------------------------------------------------------
// Budget vs actual computation.
//
// For a given user and month, returns:
//   - each category the user has budgeted OR has transactions in
//   - the amount spent so far this month
//   - the budget target (if any)
//   - a projected end-of-month amount based on month-to-date pace
//   - an on-pace/warning/over flag
//
// Uses the user's custom TransactionCategory taxonomy. Transactions
// without a categoryId get bucketed under "uncategorized" using a
// heuristic mapping from Plaid's personalFinanceCategory. Totally
// uncategorized goes into "uncategorized" bucket (categoryId=null).
//
// "Spending" = transactions with direction=debit, grouped per category.
// We exclude transfers and credit card payments since those aren't
// real spending (the underlying purchase was already counted elsewhere).
// ---------------------------------------------------------------------------

export type BudgetCategoryStatus = {
  categoryId: string | null;          // null = uncategorized bucket
  categoryKey: string | null;         // the category slug (e.g. "dining")
  categoryLabel: string;               // display name (e.g. "Dining")
  spentCents: number;
  budgetCents: number | null;          // null = no budget set for this category
  percent: number | null;              // 0..∞; null if no budget
  projectedCents: number;              // blended pace + historical + expected recurring
  projectedPercent: number | null;
  expectedRecurringCents: number;      // additional charges from recurring bills expected this month
  flag: "on_pace" | "warning" | "over" | "under" | "no_budget";
};

export type MonthlyBudgetStatus = {
  month: string;                       // "YYYY-MM"
  daysElapsed: number;                 // today's day of month (1..N)
  daysInMonth: number;
  pastPercent: number;                 // daysElapsed / daysInMonth as 0..100
  totalSpentCents: number;
  totalBudgetCents: number;
  projectedTotalCents: number;
  categories: BudgetCategoryStatus[];
};

/**
 * Plaid's personalFinanceCategory values start with coarse prefixes.
 * Map those to our custom category keys where the mapping is obvious.
 * Categories the user has actually seeded live in the DB — we lookup
 * by key after this normalization.
 *
 * Transactions whose PFC prefix is listed as `null` here are considered
 * non-spending (transfers, loan-payments, income, etc.) and excluded.
 */
const PFC_PREFIX_TO_CATEGORY_KEY: Record<string, string | null> = {
  FOOD_AND_DRINK: "dining",               // refined below when ".GROCERIES"
  GENERAL_MERCHANDISE: "shopping",
  TRANSPORTATION: "transportation",
  GENERAL_SERVICES: "subscription",
  ENTERTAINMENT: "entertainment",
  TRAVEL: "travel",
  RENT_AND_UTILITIES: "utilities",
  MEDICAL: "healthcare",
  PERSONAL_CARE: "shopping",
  HOME_IMPROVEMENT: "housing",
  GOVERNMENT_AND_NON_PROFIT: "charity",
  BANK_FEES: "fees",
  // Non-spending: skip
  TRANSFER_IN: null,
  TRANSFER_OUT: null,
  LOAN_PAYMENTS: null,
  INCOME: null
};

export function mapPlaidPfcToCategoryKey(pfc: string | null): string | null {
  if (!pfc) return null;
  const upper = pfc.toUpperCase();
  // Refine groceries vs dining FIRST
  if (upper.startsWith("FOOD_AND_DRINK_GROCERIES")) return "groceries";

  // Match each known multi-word prefix explicitly — simpler than
  // trying to compute a variable split point.
  const MULTI_WORD_PREFIXES = [
    "FOOD_AND_DRINK",
    "GENERAL_MERCHANDISE",
    "GENERAL_SERVICES",
    "RENT_AND_UTILITIES",
    "HOME_IMPROVEMENT",
    "PERSONAL_CARE",
    "BANK_FEES",
    "LOAN_PAYMENTS",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "GOVERNMENT_AND_NON_PROFIT"
  ];
  for (const prefix of MULTI_WORD_PREFIXES) {
    if (upper.startsWith(prefix + "_") || upper === prefix) {
      return prefix in PFC_PREFIX_TO_CATEGORY_KEY
        ? PFC_PREFIX_TO_CATEGORY_KEY[prefix]
        : null;
    }
  }
  // Single-word prefix fallback
  const singlePrefix = upper.split("_")[0];
  if (singlePrefix in PFC_PREFIX_TO_CATEGORY_KEY) {
    return PFC_PREFIX_TO_CATEGORY_KEY[singlePrefix];
  }
  return null;
}

/** Parse a month string "YYYY-MM" into the first-of-month Date. */
export function parseMonthKey(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Invalid month key: ${month}`);
  }
  return new Date(y, m - 1, 1);
}

export function formatMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

export async function computeMonthlyBudgetStatus(args: {
  userId: string;
  month?: string;                      // "YYYY-MM"; defaults to current
  /** When set, use this date as "today" instead of new Date(). For tests. */
  asOf?: Date;
}): Promise<MonthlyBudgetStatus> {
  const now = args.asOf ?? new Date();
  const month = args.month ?? formatMonthKey(now);
  const firstOfMonth = parseMonthKey(month);
  const lastOfMonth = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  const daysInMo = daysInMonth(firstOfMonth);

  // If the requested month is in the past, "daysElapsed" is the whole
  // month. If it's the future, 0. Otherwise today's day.
  let daysElapsed: number;
  if (now < firstOfMonth) {
    daysElapsed = 0;
  } else if (now > lastOfMonth) {
    daysElapsed = daysInMo;
  } else {
    daysElapsed = now.getDate();
  }
  const pastPercent = (daysElapsed / daysInMo) * 100;

  // Non-spending category keys: mechanical money movement (transfers
  // between own accounts, savings contributions, incoming deposits).
  // These never count toward a spending budget. User-applied
  // categories are otherwise respected (e.g. Zelle to a friend tagged
  // as Dining will count as Dining).
  const NON_SPENDING_KEYS = new Set([
    "transfer",
    "investing",
    "retirement_contribution",
    "income",
    "paycheck"
  ]);

  // 1. Load user's custom categories keyed by id
  const categories = await prisma.transactionCategory.findMany({
    where: { userId: args.userId }
  });
  const catById = new Map(categories.map((c) => [c.id, c]));
  const catByKey = new Map(categories.map((c) => [c.key, c]));

  // 2. Load this month's transactions (debit only — spending)
  const transactions = await prisma.transaction.findMany({
    where: {
      userId: args.userId,
      direction: "debit",
      date: { gte: firstOfMonth, lte: lastOfMonth }
    },
    select: {
      amount: true,
      categoryId: true,
      personalFinanceCategory: true
    }
  });

  // 3. Sum spending per category. Transactions without a custom category
  //    get mapped via PFC, else dropped into "uncategorized". Categories
  //    in NON_SPENDING_KEYS are skipped entirely regardless of source —
  //    transfers between own accounts, paycheck deposits, investing
  //    contributions, etc. aren't spending and shouldn't be budgeted.
  const spentByCategory = new Map<string | null, number>();
  for (const t of transactions) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    const cents = Math.round(amt * 100);
    let targetCatId: string | null = t.categoryId;
    // Skip if user-assigned category is a non-spending one
    if (targetCatId) {
      const userCat = catById.get(targetCatId);
      if (userCat && NON_SPENDING_KEYS.has(userCat.key)) continue;
    }
    if (!targetCatId) {
      const inferredKey = mapPlaidPfcToCategoryKey(t.personalFinanceCategory);
      if (t.personalFinanceCategory && inferredKey === null) {
        const upper = t.personalFinanceCategory.toUpperCase();
        if (
          upper.startsWith("TRANSFER_IN") ||
          upper.startsWith("TRANSFER_OUT") ||
          upper.startsWith("LOAN_PAYMENTS") ||
          upper.startsWith("INCOME")
        ) {
          continue;
        }
      }
      if (inferredKey) {
        const cat = catByKey.get(inferredKey);
        targetCatId = cat?.id ?? null;
      }
    }
    spentByCategory.set(
      targetCatId,
      (spentByCategory.get(targetCatId) ?? 0) + cents
    );
  }

  // 4. Load applicable budgets. For each category, pick the most
  //    recent row with activeFromMonth <= our month.
  const budgetRows = await prisma.budget.findMany({
    where: {
      userId: args.userId,
      activeFromMonth: { lte: firstOfMonth }
    },
    orderBy: { activeFromMonth: "desc" }
  });
  const budgetByCategory = new Map<string | null, bigint>();
  for (const b of budgetRows) {
    // Use the first (most recent) budget per categoryId; dedupe.
    const key = b.categoryId ?? "__uncat__";
    if (!budgetByCategory.has(key === "__uncat__" ? null : b.categoryId)) {
      budgetByCategory.set(b.categoryId, b.monthlyAmountCents);
    }
  }

  // 5. Combine — union of categories with budgets OR with spending.
  //    Also compute trailing-3-month historical average per category
  //    for use in the blended projection formula.
  const trailingStart = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth() - 3,
    1
  );
  const trailingEnd = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    0,
    23,
    59,
    59,
    999
  );
  const trailingTxns = await prisma.transaction.findMany({
    where: {
      userId: args.userId,
      direction: "debit",
      date: { gte: trailingStart, lte: trailingEnd }
    },
    select: {
      amount: true,
      categoryId: true,
      personalFinanceCategory: true
    }
  });
  const trailingByCategory = new Map<string | null, number>();
  for (const t of trailingTxns) {
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    const cents = Math.round(amt * 100);
    let catId: string | null = t.categoryId;
    // Skip non-spending categories
    if (catId) {
      const userCat = catById.get(catId);
      if (userCat && NON_SPENDING_KEYS.has(userCat.key)) continue;
    }
    if (!catId) {
      const inferredKey = mapPlaidPfcToCategoryKey(t.personalFinanceCategory);
      if (t.personalFinanceCategory && inferredKey === null) {
        const upper = t.personalFinanceCategory.toUpperCase();
        if (
          upper.startsWith("TRANSFER_IN") ||
          upper.startsWith("TRANSFER_OUT") ||
          upper.startsWith("LOAN_PAYMENTS") ||
          upper.startsWith("INCOME")
        ) {
          continue;
        }
      }
      if (inferredKey) catId = catByKey.get(inferredKey)?.id ?? null;
    }
    trailingByCategory.set(
      catId,
      (trailingByCategory.get(catId) ?? 0) + cents
    );
  }

  const allKeys = new Set<string | null>();
  for (const k of budgetByCategory.keys()) allKeys.add(k);
  for (const k of spentByCategory.keys()) allKeys.add(k);

  // 5b. Expected recurring charges for the rest of this month, per
  // category. Uses the existing recurring detection (trailing 180d).
  // For each recurring outflow whose next expected date falls between
  // today and end-of-month, add its average amount to its category's
  // expected bucket. This mirrors Copilot's "unfilled bar" for bills
  // not yet charged.
  const expectedByLabel = new Map<string, number>();
  try {
    const { getRecurringSummary } = await import("./recurring-summary");
    const recurring = await getRecurringSummary({ includeTransferLike: false });
    const cutoff = now;
    for (const o of recurring.outflows) {
      if (!o.nextExpectedDate || !o.categoryLabel) continue;
      const nextDate = new Date(o.nextExpectedDate);
      if (nextDate < firstOfMonth || nextDate > lastOfMonth) continue;
      if (nextDate < cutoff) continue;  // already passed — should show up in spent, not expected
      const avg = Math.round(Number(o.averageAmount) * 100);
      if (!Number.isFinite(avg) || avg <= 0) continue;
      expectedByLabel.set(
        o.categoryLabel,
        (expectedByLabel.get(o.categoryLabel) ?? 0) + avg
      );
    }
  } catch {
    // Recurring detection is best-effort — if it fails, row.expectedRecurringCents stays 0
  }

  const rows: BudgetCategoryStatus[] = [];
  for (const catId of allKeys) {
    const spent = spentByCategory.get(catId) ?? 0;
    const budget = budgetByCategory.get(catId);
    const budgetCents = budget !== undefined ? Number(budget) : null;
    const cat = catId ? catById.get(catId) : null;
    const label = cat?.label ?? (catId ? "(deleted category)" : "Uncategorized");
    const categoryKey = cat?.key ?? null;

    const percent = budgetCents && budgetCents > 0 ? (spent / budgetCents) * 100 : null;

    // Blended projection: trusts historical average early in the month,
    // transitions to MTD pace as the month progresses. Linear pace
    // extrapolation on day 5 is absurdly noisy (5 coffee purchases →
    // $1000/mo projected). We weight MTD by daysElapsed/21 (capped at
    // 1.0) and historical by the remainder, so:
    //   Day 1:  100% historical, 0% MTD
    //   Day 7:  67% historical, 33% MTD
    //   Day 14: 33% historical, 67% MTD
    //   Day 21+: 100% MTD
    // Historical average is trailing-3-months divided by 3. If the
    // category has no trailing history, fall back to pure MTD pace.
    const trailingCentsTotal = trailingByCategory.get(catId) ?? 0;
    const historicalMonthlyCents = Math.round(trailingCentsTotal / 3);
    const mtdPaceMonthlyCents =
      daysElapsed > 0 ? Math.round((spent / daysElapsed) * daysInMo) : 0;

    // Expected recurring for this row (lookup by category label since
    // getRecurringSummary gives us labels, not ids).
    const expectedRecurringCents = expectedByLabel.get(label) ?? 0;

    let projectedCents: number;
    if (historicalMonthlyCents === 0) {
      projectedCents = mtdPaceMonthlyCents;
    } else {
      const mtdWeight = Math.min(1, daysElapsed / 21);
      const histWeight = 1 - mtdWeight;
      projectedCents = Math.round(
        mtdPaceMonthlyCents * mtdWeight +
          historicalMonthlyCents * histWeight
      );
    }
    // Floor the projection at (spent + expected recurring) — if we
    // KNOW $X of recurring bills will hit this month, the projection
    // can't honestly be below that.
    const committed = spent + expectedRecurringCents;
    if (projectedCents < committed) projectedCents = committed;

    const projectedPercent =
      budgetCents && budgetCents > 0
        ? (projectedCents / budgetCents) * 100
        : null;

    let flag: BudgetCategoryStatus["flag"];
    if (!budgetCents) flag = "no_budget";
    else if (percent !== null && percent >= 100) flag = "over";
    else if (projectedPercent !== null && projectedPercent >= 110) flag = "warning";
    else if (projectedPercent !== null && projectedPercent < 75 && pastPercent > 50) flag = "under";
    else flag = "on_pace";

    rows.push({
      categoryId: catId,
      categoryKey,
      categoryLabel: label,
      spentCents: spent,
      budgetCents,
      percent,
      projectedCents,
      projectedPercent,
      expectedRecurringCents,
      flag
    });
  }

  // Sort: overs first, then by spent desc
  rows.sort((a, b) => {
    const flagRank = { over: 0, warning: 1, on_pace: 2, no_budget: 3, under: 4 };
    const fa = flagRank[a.flag];
    const fb = flagRank[b.flag];
    if (fa !== fb) return fa - fb;
    return b.spentCents - a.spentCents;
  });

  const totalSpent = rows.reduce((acc, r) => acc + r.spentCents, 0);
  const totalBudget = rows.reduce(
    (acc, r) => acc + (r.budgetCents ?? 0),
    0
  );
  const projectedTotal = rows.reduce((acc, r) => acc + r.projectedCents, 0);

  return {
    month,
    daysElapsed,
    daysInMonth: daysInMo,
    pastPercent,
    totalSpentCents: totalSpent,
    totalBudgetCents: totalBudget,
    projectedTotalCents: projectedTotal,
    categories: rows
  };
}

// ---------------------------------------------------------------------------
// Budget CRUD
// ---------------------------------------------------------------------------

export async function listBudgets(userId: string) {
  // Current/future applicable budgets — one row per category (latest
  // activeFromMonth wins for display).
  const rows = await prisma.budget.findMany({
    where: { userId },
    orderBy: { activeFromMonth: "desc" }
  });
  const seen = new Set<string | null>();
  const current: typeof rows = [];
  for (const r of rows) {
    const key = r.categoryId;
    if (seen.has(key)) continue;
    seen.add(key);
    current.push(r);
  }
  return current;
}

export async function upsertBudget(args: {
  userId: string;
  categoryId: string | null;
  monthlyAmountCents: bigint;
  activeFromMonth?: Date;              // defaults to first-of-current-month
  notes?: string;
}) {
  const activeFromMonth =
    args.activeFromMonth ??
    (() => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    })();

  // Upsert by unique (userId, categoryId, activeFromMonth).
  return prisma.budget.upsert({
    where: {
      userId_categoryId_activeFromMonth: {
        userId: args.userId,
        categoryId: args.categoryId ?? "",
        activeFromMonth
      }
    },
    update: {
      monthlyAmountCents: args.monthlyAmountCents,
      notes: args.notes ?? null
    },
    create: {
      userId: args.userId,
      categoryId: args.categoryId ?? null,
      monthlyAmountCents: args.monthlyAmountCents,
      activeFromMonth,
      notes: args.notes ?? null
    }
  });
}

export async function deleteBudget(args: { userId: string; id: string }) {
  return prisma.budget.deleteMany({
    where: { id: args.id, userId: args.userId }
  });
}

/**
 * Suggest budgets from trailing N months of spending. Returns one
 * suggestion per category the user has any spending in, rounded to
 * the nearest $5. Excludes non-spending PFCs (income, transfers).
 */
export async function suggestBudgetsFromHistory(args: {
  userId: string;
  months?: number;                     // default 3
}): Promise<Array<{ categoryId: string | null; suggestedCents: number; categoryLabel: string }>> {
  const months = args.months ?? 3;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  const transactions = await prisma.transaction.findMany({
    where: {
      userId: args.userId,
      direction: "debit",
      date: { gte: start, lte: end }
    },
    select: {
      amount: true,
      categoryId: true,
      personalFinanceCategory: true
    }
  });
  const categories = await prisma.transactionCategory.findMany({
    where: { userId: args.userId }
  });
  const catByKey = new Map(categories.map((c) => [c.key, c]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const NON_SPENDING_KEYS_SUGGEST = new Set([
    "transfer",
    "investing",
    "retirement_contribution",
    "income",
    "paycheck"
  ]);

  const totalByCat = new Map<string | null, number>();
  for (const t of transactions) {
    const cents = Math.round(Number(t.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    let catId: string | null = t.categoryId;
    // Skip user-assigned non-spending categories
    if (catId) {
      const userCat = catById.get(catId);
      if (userCat && NON_SPENDING_KEYS_SUGGEST.has(userCat.key)) continue;
    }
    if (!catId) {
      const key = mapPlaidPfcToCategoryKey(t.personalFinanceCategory);
      if (t.personalFinanceCategory) {
        const upper = t.personalFinanceCategory.toUpperCase();
        if (
          upper.startsWith("TRANSFER_IN") ||
          upper.startsWith("TRANSFER_OUT") ||
          upper.startsWith("LOAN_PAYMENTS") ||
          upper.startsWith("INCOME")
        ) {
          continue;
        }
      }
      if (key) {
        const c = catByKey.get(key);
        catId = c?.id ?? null;
      }
    }
    totalByCat.set(catId, (totalByCat.get(catId) ?? 0) + cents);
  }

  const out: Array<{ categoryId: string | null; suggestedCents: number; categoryLabel: string }> = [];
  for (const [catId, total] of totalByCat) {
    const avgPerMonthCents = Math.round(total / months);
    // Round up to nearest $5 — gives a bit of headroom.
    const rounded = Math.ceil(avgPerMonthCents / 500) * 500;
    const label =
      catId && catById.has(catId)
        ? catById.get(catId)!.label
        : "Uncategorized";
    out.push({ categoryId: catId, suggestedCents: rounded, categoryLabel: label });
  }
  // Order: biggest suggestions first
  out.sort((a, b) => b.suggestedCents - a.suggestedCents);
  return out;
}

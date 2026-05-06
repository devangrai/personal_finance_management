import { prisma, TransactionReviewStatus } from "@portfolio/db";
import { z } from "zod";
import { getAdvisorPlanSnapshot } from "./advisor-plan";
import { getCashflowSummary } from "./cashflow-summary";
import { getInvestmentsSummary } from "./investments";
import { getRecurringSummary } from "./recurring-summary";
import { getOrCreateUserProfile, updateUserProfile } from "./profile";
import { listActiveGoals, upsertGoal, deactivateGoal } from "./goals";
import {
  listUserFacts,
  getUserFact,
  saveUserFact,
  deleteUserFact
} from "./user-facts";
import { getDefaultUserId } from "./categories";
import {
  getIrsLimits,
  getAgeBasedRetirementTarget,
  listSupportedIrsYears
} from "./reference/irs-limits";
import {
  getRelevantLessons,
  graduateCandidate,
  listPendingCandidates,
  noteLessonApplied
} from "./advisor-lessons";
import { LessonTopic } from "@portfolio/db";

/**
 * Advisor tool surface.
 *
 * Each tool has:
 *   - name: what the LLM invokes
 *   - description: short instruction (what it does, when to use)
 *   - parameters: Zod schema (input validation + LLM-readable shape)
 *   - execute: implementation
 *
 * This is the entire "knobs" surface the LLM can turn. Add a tool here,
 * it becomes available to the agent.
 *
 * Design rules:
 *   - Read tools are cheap and side-effect-free. The LLM can call as many
 *     as it wants within the depth budget.
 *   - Write tools MUST be explicit: the LLM should only call them when the
 *     user intent is clearly to save, update, or delete. The tool
 *     description in natural language reinforces this.
 *   - Reference tools return static, curated data (IRS limits, guidance
 *     tables). They don't depend on user state.
 */

export type ToolCategory = "read" | "write" | "reference";

export type AdvisorTool = {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: z.ZodTypeAny;
  execute: (args: unknown) => Promise<unknown>;
};

// ==========================================================================
// READ TOOLS
// ==========================================================================

const getProfileTool: AdvisorTool = {
  name: "get_profile",
  description:
    "Fetch the user's saved profile (birth year, housing status, annual gross income, biweekly net pay, fixed monthly expense, risk tolerance, saved retirement target rate). Call this when you need profile context and do not already have it from this turn.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    return getOrCreateUserProfile();
  }
};

const getAdvisorPlanTool: AdvisorTool = {
  name: "get_advisor_plan",
  description:
    "Fetch the composite advisor plan snapshot: headline facts, emergency fund status, retirement posture, paycheck-allocation scenarios, and observed paycheck flow. This is the most comprehensive read and covers most general 'how am I doing' questions.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    return getAdvisorPlanSnapshot();
  }
};

const getCashflowSummaryTool: AdvisorTool = {
  name: "get_cashflow_summary",
  description:
    "Fetch monthly income, spending, transfer, investing, net cashflow, and top spending categories for the last N months (default 6, max 12). Use this when the user asks about spending trends, month-over-month changes, or top spending categories.",
  category: "read",
  parameters: z
    .object({
      months: z
        .number()
        .int()
        .min(1)
        .max(12)
        .describe("Number of months to include (1-12). Defaults to 6.")
    })
    .partial()
    .strict(),
  execute: async (args) => {
    const parsed = args as { months?: number };
    return getCashflowSummary(parsed.months ?? 6);
  }
};

const getSpendingByCategoryTool: AdvisorTool = {
  name: "get_spending_by_category",
  description:
    "Fetch reviewed spending grouped by category key for a specific month. Returns amount in dollars and transaction count per category. Use this when the user asks 'how much did I spend on X in Y' or wants to see spending breakdown for a specific period.",
  category: "read",
  parameters: z
    .object({
      monthKey: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .describe(
          "Month to query in YYYY-MM format (e.g. 2026-04). Required."
        ),
      direction: z
        .enum(["debit", "credit"])
        .default("debit")
        .describe(
          "debit for outflows (default), credit for inflows. Almost always 'debit' for spending questions."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as {
      monthKey: string;
      direction: "debit" | "credit";
    };
    const userId = await getDefaultUserId();
    const [year, month] = parsed.monthKey.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const rows = await prisma.transaction.findMany({
      where: {
        userId,
        direction: parsed.direction,
        date: { gte: start, lt: end },
        reviewStatus: { not: TransactionReviewStatus.ignored }
      },
      select: {
        amount: true,
        category: { select: { key: true, label: true, parentKey: true } }
      }
    });
    const groups = new Map<
      string,
      { key: string; label: string; amount: number; count: number }
    >();
    for (const row of rows) {
      const key = row.category?.key ?? "uncategorized";
      const label = row.category?.label ?? "Uncategorized";
      const cents = Math.round(Number(row.amount) * 100);
      const existing = groups.get(key);
      if (existing) {
        existing.amount += cents;
        existing.count += 1;
      } else {
        groups.set(key, { key, label, amount: cents, count: 1 });
      }
    }
    return {
      monthKey: parsed.monthKey,
      direction: parsed.direction,
      totalTransactionCount: rows.length,
      categories: [...groups.values()]
        .sort((a, b) => b.amount - a.amount)
        .map((group) => ({
          key: group.key,
          label: group.label,
          amount: (group.amount / 100).toFixed(2),
          count: group.count
        }))
    };
  }
};

const searchTransactionsTool: AdvisorTool = {
  name: "search_transactions",
  description:
    "Search both Plaid-synced bank/credit transactions AND manually-imported investment transactions (Fidelity CSVs) by free-text query. Matches against transaction name and merchant. Use this for questions like 'how much at Amazon', 'all my BrokerageLink deposits', or 'dining charges this quarter'. Returns up to 40 transactions ordered by date descending, each labeled with source='plaid' or source='manual_investment'.",
  category: "read",
  parameters: z
    .object({
      query: z.string().min(1).describe("Text to search for in name/merchant."),
      monthsBack: z
        .number()
        .int()
        .min(1)
        .max(24)
        .default(6)
        .describe(
          "How many months of history to search. Defaults to 6, max 24."
        ),
      source: z
        .enum(["plaid", "manual_investment", "all"])
        .default("all")
        .describe(
          "'plaid' = bank/credit only, 'manual_investment' = Fidelity-imported only, 'all' = both. Default 'all'."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as {
      query: string;
      monthsBack: number;
      source: "plaid" | "manual_investment" | "all";
    };
    const userId = await getDefaultUserId();
    const since = new Date();
    since.setUTCMonth(since.getUTCMonth() - parsed.monthsBack);

    const plaidRows =
      parsed.source === "manual_investment"
        ? []
        : await prisma.transaction.findMany({
            where: {
              userId,
              date: { gte: since },
              OR: [
                { name: { contains: parsed.query, mode: "insensitive" } },
                { merchantName: { contains: parsed.query, mode: "insensitive" } }
              ]
            },
            orderBy: { date: "desc" },
            take: 40,
            select: {
              id: true,
              date: true,
              name: true,
              merchantName: true,
              amount: true,
              direction: true,
              category: { select: { key: true, label: true } }
            }
          });

    const manualRows =
      parsed.source === "plaid"
        ? []
        : await prisma.manualInvestmentTransaction.findMany({
            where: {
              userId,
              date: { gte: since },
              OR: [
                { name: { contains: parsed.query, mode: "insensitive" } },
                { type: { contains: parsed.query, mode: "insensitive" } },
                { subtype: { contains: parsed.query, mode: "insensitive" } },
                { symbol: { contains: parsed.query, mode: "insensitive" } }
              ]
            },
            orderBy: { date: "desc" },
            take: 40,
            select: {
              id: true,
              date: true,
              name: true,
              type: true,
              subtype: true,
              symbol: true,
              amount: true,
              manualInvestmentAccount: {
                select: { name: true, bucket: true }
              }
            }
          });

    const plaidOut = plaidRows.map((row) => ({
      source: "plaid" as const,
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      merchantName: row.merchantName,
      amount: row.amount.toString(),
      direction: row.direction,
      category: row.category?.label ?? null
    }));
    const manualOut = manualRows.map((row) => ({
      source: "manual_investment" as const,
      id: row.id,
      date: row.date.toISOString().slice(0, 10),
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      symbol: row.symbol,
      amount: row.amount.toString(),
      accountName: row.manualInvestmentAccount.name,
      accountBucket: row.manualInvestmentAccount.bucket
    }));

    const merged = [...plaidOut, ...manualOut].sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    return {
      query: parsed.query,
      count: merged.length,
      plaidCount: plaidOut.length,
      manualInvestmentCount: manualOut.length,
      transactions: merged.slice(0, 40)
    };
  }
};

const getRecurringTool: AdvisorTool = {
  name: "get_recurring",
  description:
    "Fetch detected recurring inflows and outflows (subscriptions, paychecks, recurring bills). Use when the user asks about subscriptions, regular bills, or predictable income.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    return getRecurringSummary();
  }
};

const getInvestmentsSummaryTool: AdvisorTool = {
  name: "get_investments_summary",
  description:
    "Fetch investment totals (retirement/taxable balance split, account list, top holdings, recent investment transactions). Use when the user asks about portfolio allocation, investment balances, or recent buys/sells.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    return getInvestmentsSummary();
  }
};

const getGoalsTool: AdvisorTool = {
  name: "get_goals",
  description:
    "Fetch the user's active goals with targets and commitments. Always call this before answering anything related to progress, commitments, or long-term planning so you can ground your answer in what the user has explicitly stated.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    const goals = await listActiveGoals();
    return { goals };
  }
};

const getUserFactsTool: AdvisorTool = {
  name: "get_user_facts",
  description:
    "Fetch all saved user facts (age, target retirement age, current retirement balance, filing status, etc.). Use this BEFORE giving personal advice to make sure you are using what the user has told you in previous turns.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    const facts = await listUserFacts();
    return { facts };
  }
};

const getUserFactTool: AdvisorTool = {
  name: "get_user_fact",
  description:
    "Fetch a single saved user fact by key. Use this when you want to check whether one specific piece of context exists (e.g., 'age', 'target_retirement_age', 'filing_status').",
  category: "read",
  parameters: z
    .object({
      factKey: z.string().min(1).describe("The fact key to look up.")
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { factKey: string };
    const fact = await getUserFact(parsed.factKey);
    return { fact };
  }
};

// ==========================================================================
// WRITE TOOLS
// ==========================================================================

const saveUserFactTool: AdvisorTool = {
  name: "save_user_fact",
  description:
    "Save a fact the user has just told you so it is remembered across conversations. Use this whenever the user volunteers personal context (age, target retirement age, current retirement balance, filing status, employer match rate, student loan interest, etc.). Do NOT invent facts. Only save what the user has explicitly stated. Normalize keys to snake_case (e.g. 'age', 'target_retirement_age', 'current_retirement_balance', 'filing_status').",
  category: "write",
  parameters: z
    .object({
      factKey: z
        .string()
        .min(1)
        .describe(
          "Snake_case fact key (e.g. 'age', 'target_retirement_age', 'filing_status', 'has_emergency_fund')."
        ),
      factValue: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.null(),
          z.record(z.any())
        ])
        .describe(
          "The fact value. Use primitives where possible; use an object only when a unit or qualifier matters (e.g. {value: 32, unit: 'years'})."
        ),
      confidence: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe(
          "0-100 confidence that the user's statement was clear and final. Use ~90 for explicit statements, ~70 for implied."
        ),
      notes: z
        .string()
        .optional()
        .describe(
          "Optional: short human-readable note about the source (e.g. 'User said this in chat on 2026-05-02')."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as {
      factKey: string;
      factValue: unknown;
      confidence?: number;
      notes?: string;
    };
    const fact = await saveUserFact({
      factKey: parsed.factKey,
      factValue: parsed.factValue as never,
      confidence: parsed.confidence,
      notes: parsed.notes ?? null
    });
    return { fact };
  }
};

const deleteUserFactTool: AdvisorTool = {
  name: "delete_user_fact",
  description:
    "Delete a previously-saved user fact by key. Use this only when the user explicitly retracts or corrects something they said earlier, and the correction is a deletion rather than an update.",
  category: "write",
  parameters: z
    .object({
      factKey: z.string().min(1).describe("The fact key to delete.")
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { factKey: string };
    await deleteUserFact(parsed.factKey);
    return { ok: true, deletedKey: parsed.factKey };
  }
};

const saveUserGoalTool: AdvisorTool = {
  name: "save_user_goal",
  description:
    "Save or update a user-stated financial goal. Use this when the user commits to a target (savings rate, dollar amount, deadline, retirement age). Normalize goalKey to snake_case. Target value is in dollars for dollar-denominated goals; for rate-based goals, also save a paired fact with unit info.",
  category: "write",
  parameters: z
    .object({
      goalKey: z
        .string()
        .min(1)
        .describe(
          "Snake_case key (e.g. 'retirement_rate_target', 'emergency_fund_target', 'house_down_payment')."
        ),
      label: z
        .string()
        .min(1)
        .describe("Human-readable label for the goal."),
      targetValue: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe(
          "Target value in dollars for dollar goals, or raw number (e.g. 20 for 20%) for rate goals. Include the unit in the label to avoid ambiguity."
        ),
      targetDate: z
        .string()
        .optional()
        .describe(
          "Target date in ISO 8601 format (YYYY-MM-DD) if the user specified one."
        ),
      commitment: z
        .string()
        .optional()
        .describe(
          "User's own words about their commitment. This is what you will show back to them in future conversations."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as {
      goalKey: string;
      label: string;
      targetValue?: string | number | null;
      targetDate?: string;
      commitment?: string;
    };
    const goal = await upsertGoal({
      goalKey: parsed.goalKey,
      label: parsed.label,
      targetValue: parsed.targetValue ?? null,
      targetDate: parsed.targetDate ?? null,
      commitment: parsed.commitment ?? null
    });
    return { goal };
  }
};

const deactivateGoalTool: AdvisorTool = {
  name: "deactivate_goal",
  description:
    "Mark a goal inactive (soft delete). Use this when the user says they are no longer pursuing a goal. Prefer update_user_goal if they are just changing the target.",
  category: "write",
  parameters: z
    .object({
      goalId: z.string().min(1).describe("The goal id (not goalKey).")
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { goalId: string };
    const goal = await deactivateGoal(parsed.goalId);
    return { goal };
  }
};

const updateProfileTool: AdvisorTool = {
  name: "update_profile",
  description:
    "Update one or more structured profile fields (birth year, housing status, annual gross income, biweekly net pay, monthly fixed expense, emergency fund target, target retirement savings rate, risk tolerance). Use this when the user explicitly states one of these values. For free-form facts not in the profile, use save_user_fact instead.",
  category: "write",
  parameters: z
    .object({
      birthYear: z.number().int().optional(),
      housingStatus: z
        .enum(["rent_free", "rent", "mortgage", "other"])
        .optional(),
      annualIncome: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe("Annual gross income in dollars."),
      biweeklyNetPay: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe("Biweekly take-home net pay in dollars."),
      monthlyFixedExpense: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe("Monthly recurring fixed expense in dollars."),
      emergencyFundTarget: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe("Target emergency fund balance in dollars."),
      targetRetirementSavingsRate: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .describe(
          "Saved target retirement savings rate as a percentage (e.g. 15 for 15%)."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as Record<string, unknown>;
    const profile = await updateUserProfile(parsed as never);
    return { profile };
  }
};

// ==========================================================================
// REFERENCE TOOLS
// ==========================================================================

const getIrsLimitsTool: AdvisorTool = {
  name: "get_irs_limits",
  description:
    "Fetch IRS contribution limits and phaseouts for a given tax year (401k/403b/457 elective deferral + catchup, IRA limits + catchup, HSA limits, Roth IRA phaseouts, FSA limits). Call this whenever the user asks about contribution room, over-contribution, or tax-year planning.",
  category: "reference",
  parameters: z
    .object({
      year: z
        .number()
        .int()
        .optional()
        .describe(
          "Tax year. Defaults to the current calendar year. Supported years can be checked via the tool's response."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { year?: number };
    return {
      limits: getIrsLimits(parsed.year),
      supportedYears: listSupportedIrsYears()
    };
  }
};

const getAgeBasedRetirementTargetTool: AdvisorTool = {
  name: "get_age_based_retirement_target",
  description:
    "Fetch Fidelity's age-based wealth-multiple target (e.g. 1x salary by 30, 3x by 40, 10x by 67) and the recommended savings rate for that age. Use this when grading the user's retirement pace against a standard benchmark, especially if their age is known.",
  category: "reference",
  parameters: z
    .object({
      age: z
        .number()
        .int()
        .min(20)
        .max(80)
        .describe(
          "User's current age. If not in the profile, get it from user facts first."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { age: number };
    return {
      target: getAgeBasedRetirementTarget(parsed.age),
      source:
        "Fidelity 'How much do I need to retire?' guidance, widely published."
    };
  }
};

// ==========================================================================
// ANALYSIS TOOLS (computed reads with more opinionated outputs)
// ==========================================================================

const getSpendingTrendTool: AdvisorTool = {
  name: "get_spending_trend",
  description:
    "Compute a per-month spending trend line (optionally filtered to one category key) over the last N months, plus the change-vs-prior-period delta. Use this for 'is my spending up', 'am I spending more on dining than last quarter', or any question about direction-over-time.",
  category: "read",
  parameters: z
    .object({
      months: z
        .number()
        .int()
        .min(2)
        .max(12)
        .default(6)
        .describe(
          "Number of months to include. Minimum 2 (for delta). Default 6."
        ),
      categoryKey: z
        .string()
        .optional()
        .describe(
          "Optional category key (e.g. 'dining', 'groceries'). If omitted, returns overall spending trend."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { months: number; categoryKey?: string };
    const userId = await getDefaultUserId();
    const startDate = new Date();
    startDate.setUTCDate(1);
    startDate.setUTCMonth(startDate.getUTCMonth() - (parsed.months - 1));
    startDate.setUTCHours(0, 0, 0, 0);

    const transactions = await prisma.transaction.findMany({
      where: {
        userId,
        direction: "debit",
        reviewStatus: { not: TransactionReviewStatus.ignored },
        date: { gte: startDate },
        ...(parsed.categoryKey
          ? {
              category: {
                is: { key: parsed.categoryKey }
              }
            }
          : {})
      },
      select: {
        amount: true,
        date: true
      }
    });

    const byMonth = new Map<string, { cents: number; count: number }>();
    for (const row of transactions) {
      const year = row.date.getUTCFullYear();
      const month = String(row.date.getUTCMonth() + 1).padStart(2, "0");
      const key = `${year}-${month}`;
      const existing = byMonth.get(key) ?? { cents: 0, count: 0 };
      existing.cents += Math.round(Number(row.amount) * 100);
      existing.count += 1;
      byMonth.set(key, existing);
    }

    const series = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, bucket]) => ({
        month: monthKey,
        amount: (bucket.cents / 100).toFixed(2),
        transactionCount: bucket.count
      }));

    // Compute period-over-period delta: second half vs. first half.
    const midpoint = Math.floor(series.length / 2);
    const firstHalf = series.slice(0, midpoint);
    const secondHalf = series.slice(midpoint);
    const sum = (arr: typeof series) =>
      arr.reduce((total, row) => total + Number(row.amount), 0);
    const firstSum = sum(firstHalf);
    const secondSum = sum(secondHalf);
    const absoluteDelta = secondSum - firstSum;
    const percentDelta =
      firstSum > 0 ? (absoluteDelta / firstSum) * 100 : null;

    return {
      categoryKey: parsed.categoryKey ?? "all_spending",
      monthsCovered: series.length,
      series,
      periodOverPeriod: {
        firstHalfSpending: firstSum.toFixed(2),
        secondHalfSpending: secondSum.toFixed(2),
        absoluteDelta: absoluteDelta.toFixed(2),
        percentDelta: percentDelta !== null ? percentDelta.toFixed(1) : null,
        direction:
          absoluteDelta > 0 ? "up" : absoluteDelta < 0 ? "down" : "flat"
      }
    };
  }
};

const analyzeAllocationTool: AdvisorTool = {
  name: "analyze_allocation",
  description:
    "Analyze the user's investment bucket allocation: retirement vs. taxable vs. other dollar and percent share, top holdings by value, and a simple concentration metric (share of top 3 holdings). Use this for 'am I too heavy in X', 'is my portfolio concentrated', 'how much is in retirement vs. taxable'. Data combines Plaid and manual import sources.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    const summary = await getInvestmentsSummary();
    const totalCents = Math.round(
      Number(summary.totals.totalBalance) * 100
    );
    const retirementCents = Math.round(
      Number(summary.totals.retirementBalance) * 100
    );
    const taxableCents = Math.round(
      Number(summary.totals.taxableBalance) * 100
    );
    const otherCents = totalCents - retirementCents - taxableCents;

    const byBucket = {
      retirement: {
        amount: (retirementCents / 100).toFixed(2),
        shareBps:
          totalCents > 0 ? Math.round((retirementCents / totalCents) * 10000) : 0
      },
      taxable: {
        amount: (taxableCents / 100).toFixed(2),
        shareBps:
          totalCents > 0 ? Math.round((taxableCents / totalCents) * 10000) : 0
      },
      other: {
        amount: (otherCents / 100).toFixed(2),
        shareBps:
          totalCents > 0 ? Math.round((otherCents / totalCents) * 10000) : 0
      }
    };

    const topHoldings = summary.topHoldings.slice(0, 5);
    const top3Cents = topHoldings
      .slice(0, 3)
      .reduce((sum, holding) => sum + Number(holding.institutionValue) * 100, 0);
    const topThreeConcentrationBps =
      totalCents > 0 ? Math.round((top3Cents / totalCents) * 10000) : 0;

    return {
      totalBalance: summary.totals.totalBalance,
      byBucket,
      topHoldings: topHoldings.map((holding) => ({
        symbol: holding.symbol,
        name: holding.securityName,
        value: holding.institutionValue,
        accountName: holding.accountName,
        source: holding.source
      })),
      concentration: {
        topThreeConcentrationPercent: (topThreeConcentrationBps / 100).toFixed(1),
        holdingsCount: summary.totals.holdingsCount
      },
      accountCount: summary.totals.accountCount,
      note:
        summary.totals.holdingsCount === 0
          ? "No holdings snapshots imported yet; concentration and top-holdings figures are empty. Import a Fidelity holdings CSV to enable full allocation analysis."
          : "All figures are based on the most recent holdings snapshot per account."
    };
  }
};

const getGoalProgressTool: AdvisorTool = {
  name: "get_goal_progress",
  description:
    "For each active user goal, compute current progress vs. the stated target where measurable. Handles rate-based goals (e.g. '20% savings rate'), dollar-denominated goals (emergency fund balance), and deadline-based goals. Returns progress and a simple on-track/behind/ahead verdict per goal. Use this whenever the user asks about progress, status of commitments, or 'how am I doing on X'.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    const [goals, plan, facts] = await Promise.all([
      listActiveGoals(),
      getAdvisorPlanSnapshot(),
      listUserFacts()
    ]);

    const factByKey = new Map(facts.map((fact) => [fact.factKey, fact]));
    const observedGrossRatePercent = (() => {
      // Use the advisor plan's gross-rate if available.
      const obs = plan.retirement.observedTakeHomeRetirementRatePercent;
      return obs != null ? Number(obs) : null;
    })();

    const progress = goals.map((goal) => {
      // Heuristic goal-type inference:
      //   - Keywords in goalKey/label: "rate" | "savings_rate" | "%" → rate goal
      //   - Keywords "fund", "emergency", "down_payment" → dollar goal
      //   - Otherwise dollar goal by default.
      const lowerKey = `${goal.goalKey} ${goal.label}`.toLowerCase();
      const isRateGoal =
        /\b(rate|savings[-_ ]rate|percent|%)\b/.test(lowerKey);
      const targetNum =
        goal.targetValue != null ? Number(goal.targetValue) : null;

      if (isRateGoal && targetNum != null) {
        const observed =
          observedGrossRatePercent ??
          (plan.paycheckFlow.percentOfTakeHomeToRetirement
            ? Number(plan.paycheckFlow.percentOfTakeHomeToRetirement)
            : null);
        if (observed == null) {
          return {
            goalKey: goal.goalKey,
            label: goal.label,
            kind: "rate",
            targetPercent: targetNum,
            observedPercent: null,
            verdict: "insufficient_data",
            note:
              "No observed savings rate is available yet (missing take-home baseline)."
          };
        }
        const delta = observed - targetNum;
        const verdict =
          delta >= 0 ? "ahead" : delta >= -2 ? "on_track" : "behind";
        return {
          goalKey: goal.goalKey,
          label: goal.label,
          kind: "rate",
          targetPercent: targetNum,
          observedPercent: Number(observed.toFixed(1)),
          deltaPercentPoints: Number(delta.toFixed(1)),
          verdict,
          note: null
        };
      }

      if (targetNum != null) {
        // Dollar goal - compare against closest matching data source.
        // Heuristic: emergency-fund goals compare to plan.emergencyFund.currentLiquidSavings.
        const isEmergencyFund = /emergency|e_?fund/.test(lowerKey);
        if (isEmergencyFund) {
          const current = Number(plan.emergencyFund.currentLiquidSavings);
          const delta = current - targetNum;
          const percentComplete =
            targetNum > 0 ? (current / targetNum) * 100 : null;
          return {
            goalKey: goal.goalKey,
            label: goal.label,
            kind: "emergency_fund",
            targetDollars: targetNum,
            currentDollars: current,
            percentComplete:
              percentComplete !== null ? Number(percentComplete.toFixed(0)) : null,
            verdict:
              delta >= 0
                ? "ahead"
                : percentComplete != null && percentComplete >= 80
                  ? "on_track"
                  : "behind",
            note: null
          };
        }

        return {
          goalKey: goal.goalKey,
          label: goal.label,
          kind: "dollar",
          targetDollars: targetNum,
          currentDollars: null,
          verdict: "insufficient_data",
          note:
            "This dollar goal does not have an obvious data source for auto-progress. Use relevant facts or transactions to assess manually."
        };
      }

      return {
        goalKey: goal.goalKey,
        label: goal.label,
        kind: "unstructured",
        verdict: "insufficient_data",
        note: "Goal has no target value. Consider adding one via save_user_goal."
      };
    });

    return {
      goals: progress,
      referenceDate: new Date().toISOString().slice(0, 10),
      factsUsed: [...factByKey.keys()]
    };
  }
};



// ==========================================================================
// LESSONS TOOLS
// ==========================================================================

const getUserLessonsTool: AdvisorTool = {
  name: "get_user_lessons",
  description:
    "Fetch graduated lessons about this user's preferences and recurring advice patterns. Use at the start of a turn when giving personal advice — these lessons represent what you've previously learned about how this user wants things delivered. Optionally filter by topic for a focused view.",
  category: "read",
  parameters: z
    .object({
      topic: z
        .enum(["tax", "retirement", "spending", "portfolio", "goals", "general"])
        .optional()
        .describe(
          "Optional topic filter. If omitted, returns all graduated lessons (capped)."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { topic?: LessonTopic };
    const lessons = await getRelevantLessons({ topic: parsed.topic, limit: 8 });
    // Best-effort: record that we surfaced these lessons. Don't fail on error.
    for (const lesson of lessons) {
      void noteLessonApplied(lesson.id);
    }
    return {
      lessons: lessons.map((lesson) => ({
        id: lesson.id,
        kind: lesson.kind,
        topic: lesson.topic,
        pattern: lesson.patternSummary,
        action: lesson.actionOrCaveat
      })),
      count: lessons.length,
      note:
        lessons.length === 0
          ? "No graduated lessons yet. If the user confirms a preference during this conversation, use graduate_candidate_lesson to save it."
          : undefined
    };
  }
};

const graduateCandidateLessonTool: AdvisorTool = {
  name: "graduate_candidate_lesson",
  description:
    "Graduate a pending CandidateLesson when the user has clearly confirmed the pattern during conversation. Only use this in response to an unambiguous user signal like 'yes, exactly — remember that', 'that's right, apply this', or similar explicit confirmation. Do NOT use this to make up lessons the user didn't actually confirm. You must supply a concise rationale explaining what the user said that supports graduation.",
  category: "write",
  parameters: z
    .object({
      candidateId: z
        .string()
        .min(1)
        .describe(
          "The id of the CandidateLesson to graduate. Call list_pending_candidate_lessons first to see valid ids."
        ),
      rationale: z
        .string()
        .min(10)
        .max(400)
        .describe(
          "Short quote or paraphrase of what the user said that confirms this pattern, and any extra context from this turn. Required."
        )
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as { candidateId: string; rationale: string };
    const lesson = await graduateCandidate(
      parsed.candidateId,
      parsed.rationale
    );
    return {
      lesson: {
        id: lesson.id,
        kind: lesson.kind,
        topic: lesson.topic,
        pattern: lesson.patternSummary,
        action: lesson.actionOrCaveat
      },
      message: "Lesson graduated successfully; it will apply to future turns."
    };
  }
};

const listPendingCandidateLessonsTool: AdvisorTool = {
  name: "list_pending_candidate_lessons",
  description:
    "List CandidateLessons that are pending review. Useful when the user asks 'what have you noticed about me?' or similar, or before calling graduate_candidate_lesson to check which patterns are currently pending.",
  category: "read",
  parameters: z.object({}).strict(),
  execute: async () => {
    const candidates = await listPendingCandidates();
    return {
      candidates: candidates.map((c) => ({
        id: c.id,
        kind: c.kind,
        topic: c.topic,
        pattern: c.patternSummary,
        clusterStrength: c.clusterStrength
      })),
      count: candidates.length
    };
  }
};

// --------------------------------------------------------------------------
// Document retrieval (Week 8): RAG over the user's uploaded documents.
// --------------------------------------------------------------------------

const searchDocumentsTool: AdvisorTool = {
  name: "search_documents",
  description:
    "Search the user's uploaded financial documents (tax returns, W-2s, 1099s, brokerage statements, comp statements, etc.) for specific content. Use this when the user asks about details that aren't in KNOWN FACTS but are likely in a document they've uploaded — specific line items, clauses, schedules, named amounts, etc. Returns 1-3 text snippets ranked by relevance, each with the source document title and page. Cite the source in your answer.",
  category: "read",
  parameters: z
    .object({
      query: z
        .string()
        .trim()
        .min(2)
        .max(200)
        .describe(
          "Natural-language search query, e.g. 'itemized deductions', 'RSU vesting schedule', '401k match percentage'."
        ),
      documentType: z
        .string()
        .trim()
        .max(40)
        .optional()
        .describe(
          "Optional document-type filter, e.g. 'tax_return_1040', 'w2', 'comp_statement'."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Max number of snippets to return (default 3).")
    })
    .strict(),
  execute: async (args) => {
    const parsed = (args ?? {}) as {
      query: string;
      documentType?: string;
      limit?: number;
    };
    const userId = await getDefaultUserId();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return {
        error: "GEMINI_API_KEY is not configured; document search unavailable."
      };
    }
    const { searchUserDocuments } = await import("./document-retrieval");
    const hits = await searchUserDocuments({
      userId,
      query: parsed.query,
      apiKey,
      limit: parsed.limit ?? 3,
      documentType: parsed.documentType
    });
    return {
      query: parsed.query,
      count: hits.length,
      hits: hits.map((h) => ({
        documentTitle: h.documentTitle,
        documentType: h.documentType,
        page: h.page,
        snippet: h.text,
        similarity: Number(h.similarity.toFixed(3))
      }))
    };
  }
};

// --------------------------------------------------------------------------
// Budget tools (Week 9): read current budget status + create/update budgets.
// --------------------------------------------------------------------------

const getBudgetStatusTool: AdvisorTool = {
  name: "get_budget_status",
  description:
    "Return the user's month-to-date budget vs actual status: for each spending category, the amount spent, budgeted, % used, projected end-of-month, and a flag (over/warning/on_pace/under/no_budget). Use this whenever the user asks about their spending relative to a plan, or whether they're on budget.",
  category: "read",
  parameters: z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/, "Format: YYYY-MM")
        .optional()
        .describe("Month to report on (YYYY-MM). Defaults to current.")
    })
    .strict(),
  execute: async (args) => {
    const parsed = (args ?? {}) as { month?: string };
    const userId = await getDefaultUserId();
    const { computeMonthlyBudgetStatus } = await import("./budget-comparison");
    const status = await computeMonthlyBudgetStatus({
      userId,
      month: parsed.month
    });
    return status;
  }
};

const updateBudgetTool: AdvisorTool = {
  name: "update_budget",
  description:
    "Set or update a monthly budget for a category. Use after the user agrees to a specific budget amount. Amount is in whole dollars. categoryKey uses the user's custom category slug (e.g. 'dining', 'groceries', 'transportation'); pass null to budget the uncategorized bucket.",
  category: "write",
  parameters: z
    .object({
      categoryKey: z
        .string()
        .nullable()
        .describe(
          "Category slug (e.g. 'dining', 'groceries'). Null for uncategorized bucket."
        ),
      monthlyAmountDollars: z
        .number()
        .nonnegative()
        .describe("Monthly budget target in whole dollars.")
    })
    .strict(),
  execute: async (args) => {
    const parsed = args as {
      categoryKey: string | null;
      monthlyAmountDollars: number;
    };
    const userId = await getDefaultUserId();
    let categoryId: string | null = null;
    if (parsed.categoryKey) {
      const cat = await prisma.transactionCategory.findFirst({
        where: { userId, key: parsed.categoryKey }
      });
      if (!cat) {
        return {
          error: `No category with key '${parsed.categoryKey}'. Use get_user_facts or ask the user for a valid category.`
        };
      }
      categoryId = cat.id;
    }
    const { upsertBudget } = await import("./budget-comparison");
    const row = await upsertBudget({
      userId,
      categoryId,
      monthlyAmountCents: BigInt(Math.round(parsed.monthlyAmountDollars * 100))
    });
    return {
      ok: true,
      budgetId: row.id,
      categoryKey: parsed.categoryKey,
      monthlyAmountDollars: parsed.monthlyAmountDollars
    };
  }
};

// ==========================================================================
// REGISTRY + DISPATCHER
// ==========================================================================

export const ALL_TOOLS: AdvisorTool[] = [
  // Reads
  getProfileTool,
  getAdvisorPlanTool,
  getCashflowSummaryTool,
  getSpendingByCategoryTool,
  searchTransactionsTool,
  getRecurringTool,
  getInvestmentsSummaryTool,
  getGoalsTool,
  getUserFactsTool,
  getUserFactTool,
  // Analysis (computed reads)
  getSpendingTrendTool,
  analyzeAllocationTool,
  getGoalProgressTool,
  // Writes
  saveUserFactTool,
  deleteUserFactTool,
  saveUserGoalTool,
  deactivateGoalTool,
  updateProfileTool,
  // Reference
  getIrsLimitsTool,
  getAgeBasedRetirementTargetTool,
  // Lessons (Week 5)
  getUserLessonsTool,
  listPendingCandidateLessonsTool,
  graduateCandidateLessonTool,
  // Document retrieval (Week 8 — RAG)
  searchDocumentsTool,
  // Budget (Week 9)
  getBudgetStatusTool,
  updateBudgetTool
];

const TOOL_BY_NAME = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));

export type ToolExecutionResult =
  | { ok: true; name: string; result: unknown }
  | { ok: false; name: string; error: string };

export async function executeTool(
  name: string,
  rawArgs: unknown
): Promise<ToolExecutionResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      name,
      error: `Unknown tool: ${name}. Available: ${[...TOOL_BY_NAME.keys()].join(", ")}`
    };
  }

  let parsed: unknown;
  try {
    parsed = tool.parameters.parse(rawArgs ?? {});
  } catch (error) {
    return {
      ok: false,
      name,
      error:
        error instanceof Error
          ? `Invalid arguments for ${name}: ${error.message}`
          : `Invalid arguments for ${name}.`
    };
  }

  try {
    const result = await tool.execute(parsed);
    return { ok: true, name, result };
  } catch (error) {
    return {
      ok: false,
      name,
      error:
        error instanceof Error
          ? `Tool ${name} failed: ${error.message}`
          : `Tool ${name} failed.`
    };
  }
}

// Convert Zod parameter schema -> JSON Schema for provider tool definitions.
// Intentionally simple; handles the shapes we use (object with primitive
// properties, unions, enums, nullables). For more exotic schemas, extend
// this function rather than pulling in a large dependency.
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema._def ?? {}) as any;

  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape() as Record<string, z.ZodTypeAny>;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const valueDef = (value._def ?? {}) as any;
        const isOptional =
          valueDef.typeName === "ZodOptional" ||
          valueDef.typeName === "ZodDefault" ||
          valueDef.typeName === "ZodNullable";
        if (!isOptional) {
          required.push(key);
        }
      }
      const jsonSchema: Record<string, unknown> = {
        type: "object",
        properties,
        additionalProperties: false
      };
      if (required.length > 0) {
        jsonSchema.required = required;
      }
      return jsonSchema;
    }
    case "ZodString":
      return { type: "string", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodNumber":
      return { type: "number", ...(schema.description ? { description: schema.description } : {}) };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodEnum":
      return { type: "string", enum: def.values };
    case "ZodUnion":
      return {
        anyOf: (def.options as z.ZodTypeAny[]).map(zodToJsonSchema)
      };
    case "ZodOptional":
    case "ZodDefault":
    case "ZodNullable":
      return zodToJsonSchema(def.innerType);
    case "ZodRecord":
      return { type: "object" };
    case "ZodAny":
      return {};
    default:
      return {};
  }
}

function stripUnsupportedForGemini(
  schema: Record<string, unknown>
): Record<string, unknown> {
  // Gemini's function-declarations JSON schema subset rejects keys
  // OpenAI accepts. Known incompatible keys: additionalProperties, $schema,
  // strict, format-less anyOf with primitives alongside null.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties" || key === "strict") {
      continue;
    }
    if (key === "properties" && value && typeof value === "object") {
      const cleanedProps: Record<string, unknown> = {};
      for (const [propKey, propValue] of Object.entries(
        value as Record<string, unknown>
      )) {
        cleanedProps[propKey] = stripUnsupportedForGemini(
          (propValue ?? {}) as Record<string, unknown>
        );
      }
      cleaned[key] = cleanedProps;
      continue;
    }
    if (key === "anyOf" && Array.isArray(value)) {
      cleaned[key] = value.map((entry) =>
        stripUnsupportedForGemini((entry ?? {}) as Record<string, unknown>)
      );
      continue;
    }
    if (key === "items" && value && typeof value === "object") {
      cleaned[key] = stripUnsupportedForGemini(
        value as Record<string, unknown>
      );
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export function toolsForOpenAi(toolWhitelist?: string[]) {
  const pool = toolWhitelist
    ? ALL_TOOLS.filter((tool) => toolWhitelist.includes(tool.name))
    : ALL_TOOLS;
  return pool.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters),
    strict: false
  }));
}

export function toolsForGemini(toolWhitelist?: string[]) {
  const pool = toolWhitelist
    ? ALL_TOOLS.filter((tool) => toolWhitelist.includes(tool.name))
    : ALL_TOOLS;
  return [
    {
      function_declarations: pool.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: stripUnsupportedForGemini(zodToJsonSchema(tool.parameters))
      }))
    }
  ];
}

export function summarizeToolSurface() {
  const counts = ALL_TOOLS.reduce(
    (acc, tool) => {
      acc[tool.category] = (acc[tool.category] ?? 0) + 1;
      return acc;
    },
    { read: 0, write: 0, reference: 0 } as Record<ToolCategory, number>
  );
  return {
    total: ALL_TOOLS.length,
    byCategory: counts,
    names: ALL_TOOLS.map((tool) => tool.name)
  };
}

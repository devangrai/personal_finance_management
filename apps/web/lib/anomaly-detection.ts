import { prisma } from "@portfolio/db";

export type AnomalyReason =
  | { kind: "new_merchant"; message: string }
  | { kind: "amount_outlier"; message: string; zScore: number }
  | { kind: "large_absolute"; message: string };

export type TransactionAnomaly = {
  transactionId: string;
  reasons: AnomalyReason[];
};

/**
 * Detect anomalies across a set of transactions for a given user. We
 * only consider outflow transactions (direction=debit) because inflows
 * like paychecks would trigger noisy "large absolute" warnings every
 * payday.
 *
 * Heuristics (conservative, see design notes):
 *   1. NEW MERCHANT — merchant hasn't been seen in the prior 90 days
 *      for this user. Strong signal for subscriptions you forgot about.
 *   2. AMOUNT OUTLIER — z-score > 2 against prior charges at this same
 *      merchant. "Amazon $234 when you usually spend $45-$120."
 *   3. LARGE ABSOLUTE — the transaction is > $500. Cheap floor to
 *      surface any single big charge even if it's a normal merchant.
 *
 * NOT used yet (deliberately):
 *   - Category-level z-score. Noisy because categories are broad.
 *   - Frequency spike (more than N charges this week). Noisy in weeks
 *     where you happened to run errands.
 */

const LARGE_ABSOLUTE_THRESHOLD = 500;
const Z_SCORE_THRESHOLD = 2.0;
const MIN_SAMPLES_FOR_Z = 3;
const LOOKBACK_DAYS = 90;

export async function detectAnomaliesForTransactions(params: {
  userId: string;
  transactionIds: string[];
  now?: Date;
}): Promise<Map<string, TransactionAnomaly>> {
  const { userId, transactionIds } = params;
  const now = params.now ?? new Date();
  const lookbackStart = new Date(
    now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );

  if (transactionIds.length === 0) {
    return new Map();
  }

  // 1) Fetch the target transactions
  const targets = await prisma.transaction.findMany({
    where: { userId, id: { in: transactionIds }, direction: "debit" },
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true
    }
  });

  if (targets.length === 0) return new Map();

  // 2) For merchants we care about, load history for last 90 days.
  const targetMerchants = Array.from(
    new Set(
      targets
        .map((t) => normalizeMerchant(t.merchantName ?? t.name))
        .filter((s): s is string => !!s)
    )
  );

  const history = await prisma.transaction.findMany({
    where: {
      userId,
      direction: "debit",
      id: { notIn: transactionIds },
      date: { gte: lookbackStart, lt: now }
    },
    select: {
      id: true,
      date: true,
      name: true,
      merchantName: true,
      amount: true
    }
  });

  // Group history by normalized merchant
  const byMerchant = new Map<string, number[]>();
  for (const txn of history) {
    const m = normalizeMerchant(txn.merchantName ?? txn.name);
    if (!m) continue;
    if (!byMerchant.has(m)) byMerchant.set(m, []);
    byMerchant.get(m)!.push(Math.abs(Number(txn.amount)));
  }

  // 3) Evaluate each target
  const out = new Map<string, TransactionAnomaly>();

  for (const t of targets) {
    const merchantKey = normalizeMerchant(t.merchantName ?? t.name);
    const amount = Math.abs(Number(t.amount));
    const reasons: AnomalyReason[] = [];

    if (merchantKey) {
      const history = byMerchant.get(merchantKey) ?? [];

      if (history.length === 0) {
        // Only flag as "new merchant" if the merchant string is
        // informative (not just bank memos). Short bank-like names
        // are often transfer descriptors, which we skip.
        if ((t.merchantName ?? t.name).trim().length >= 4) {
          reasons.push({
            kind: "new_merchant",
            message: "First time in 90 days"
          });
        }
      } else if (history.length >= MIN_SAMPLES_FOR_Z) {
        const { mean, std } = meanStd(history);
        if (std > 0) {
          const z = (amount - mean) / std;
          if (z >= Z_SCORE_THRESHOLD) {
            const avg = Math.round(mean);
            reasons.push({
              kind: "amount_outlier",
              message: `${Math.round((amount / mean - 1) * 100)}% above your usual at this merchant (avg ~$${avg})`,
              zScore: Number(z.toFixed(2))
            });
          }
        }
      }
    }

    if (amount >= LARGE_ABSOLUTE_THRESHOLD) {
      reasons.push({
        kind: "large_absolute",
        message: `Single charge of $${Math.round(amount)}`
      });
    }

    if (reasons.length > 0) {
      out.set(t.id, { transactionId: t.id, reasons });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

/**
 * Merchants come in noisy, inconsistent forms. We normalize to a
 * lowercase key of the first 3-4 significant words so "AMAZON.COM",
 * "Amazon Marketplace", and "AMAZON MKTPLACE PMTS" group together.
 */
export function normalizeMerchant(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Strip trailing transaction ids, dates, confirmation codes
  const cleaned = trimmed
    .toUpperCase()
    .replace(/[#*]\s*\d+/g, " ")
    .replace(/\b(PURCHASE|POS|DEBIT|AUTH|PENDING)\b/g, " ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 1)
    .filter((t) => !/^\d+$/.test(t)); // drop pure-numeric tokens (store IDs, tx refs)
  return tokens.slice(0, 3).join(" ") || null;
}

function meanStd(values: number[]): { mean: number; std: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance =
    values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return { mean, std: Math.sqrt(variance) };
}

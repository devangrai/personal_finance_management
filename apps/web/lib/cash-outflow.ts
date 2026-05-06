import { prisma } from "@portfolio/db";

/**
 * Cash outflow summary — the complement to the charge-basis budget grid.
 *
 * "Cash basis" = what actually left your checking/savings accounts this
 * month, regardless of when it was charged. Useful for users on
 * credit-card-autopay because charge-side and cash-side calendars can
 * drift: you might have a quiet May of card charges but still see
 * $2k+ leave checking on May 6 to pay April's statement.
 *
 * We count debits from depository accounts and net out internal
 * transfers (anything with Plaid PFC prefix TRANSFER_OUT that hits
 * another of the user's accounts). Credit card autopayments count
 * because they're real cash leaving.
 */

export type CashOutflowSummary = {
  month: string; // "YYYY-MM"
  daysElapsed: number;
  daysInMonth: number;
  totalOutCents: number; // everything debit from depository
  creditCardPaymentCents: number; // subset: CC autopay / payment
  internalTransferCents: number; // subset: transfer to your own other accounts
  otherCashOutCents: number; // totalOut - (CC payments + internal transfers)
};

function daysInMonthOf(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export async function computeCashOutflowSummary(args: {
  userId: string;
  month?: string;
  asOf?: Date;
}): Promise<CashOutflowSummary> {
  const now = args.asOf ?? new Date();
  let firstOfMonth: Date;
  if (args.month) {
    const [y, m] = args.month.split("-").map(Number);
    firstOfMonth = new Date(y, m - 1, 1);
  } else {
    firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  const lastOfMonth = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth() + 1,
    0,
    23,
    59,
    59,
    999
  );
  const daysInMo = daysInMonthOf(firstOfMonth);
  const daysElapsed =
    now < firstOfMonth ? 0 : now > lastOfMonth ? daysInMo : now.getDate();

  // Depository accounts only — we want cash movement, not card charges.
  const depositoryAccts = await prisma.account.findMany({
    where: { userId: args.userId, type: "depository" },
    select: { id: true }
  });
  if (depositoryAccts.length === 0) {
    return {
      month: `${firstOfMonth.getFullYear()}-${String(firstOfMonth.getMonth() + 1).padStart(2, "0")}`,
      daysElapsed,
      daysInMonth: daysInMo,
      totalOutCents: 0,
      creditCardPaymentCents: 0,
      internalTransferCents: 0,
      otherCashOutCents: 0
    };
  }

  const txns = await prisma.transaction.findMany({
    where: {
      userId: args.userId,
      accountId: { in: depositoryAccts.map((a) => a.id) },
      direction: "debit",
      date: { gte: firstOfMonth, lte: lastOfMonth }
    },
    select: {
      amount: true,
      personalFinanceCategory: true
    }
  });

  let total = 0;
  let ccPayments = 0;
  let internalXfer = 0;
  for (const t of txns) {
    const cents = Math.round(Number(t.amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) continue;
    total += cents;
    const pfc = (t.personalFinanceCategory ?? "").toUpperCase();
    if (pfc.startsWith("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")) {
      ccPayments += cents;
    } else if (pfc.startsWith("TRANSFER_OUT")) {
      internalXfer += cents;
    }
  }
  const other = total - ccPayments - internalXfer;

  return {
    month: `${firstOfMonth.getFullYear()}-${String(firstOfMonth.getMonth() + 1).padStart(2, "0")}`,
    daysElapsed,
    daysInMonth: daysInMo,
    totalOutCents: total,
    creditCardPaymentCents: ccPayments,
    internalTransferCents: internalXfer,
    otherCashOutCents: Math.max(0, other)
  };
}

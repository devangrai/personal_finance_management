"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; key: string; label: string };

type Txn = {
  id: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: string;
  direction: "outflow" | "inflow";
  isPending: boolean;
  reviewStatus: string;
  aiSuggestedConfidence: number | null;
  aiSuggestedReason: string | null;
  category: { id: string; key: string; label: string } | null;
  aiSuggestedCategory: { id: string; key: string; label: string } | null;
  account: {
    id: string;
    name: string;
    mask: string | null;
    type: string;
    subtype: string | null;
  };
};

const LOW_CONFIDENCE_THRESHOLD = 70;

function formatDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

function formatAmount(v: string, direction: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  });
  return direction === "inflow" ? `+${abs}` : `-${abs}`;
}

export function RecentTransactions(props: {
  transactions: Txn[];
  categories: Category[];
}) {
  const needsReviewCount = props.transactions.filter(
    (t) =>
      t.reviewStatus === "uncategorized" || t.reviewStatus === "auto_categorized"
  ).length;

  return (
    <section className="card">
      <div className="txnHeader">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Recent transactions</h2>
        </div>
        {needsReviewCount > 0 ? (
          <span className="txnReviewCount">
            {needsReviewCount} still need review
          </span>
        ) : null}
      </div>
      {props.transactions.length === 0 ? (
        <p className="emptyLine">
          No transactions yet. Sync your accounts to pull the latest activity.
        </p>
      ) : (
        <ul className="txnList">
          {props.transactions.map((t) => (
            <TransactionRow key={t.id} txn={t} categories={props.categories} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TransactionRow({
  txn,
  categories
}: {
  txn: Txn;
  categories: Category[];
}) {
  const router = useRouter();
  const [showReview, setShowReview] = useState(false);
  const [busy, setBusy] = useState<null | "accept" | "change" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const needsReview =
    txn.reviewStatus === "uncategorized" ||
    txn.reviewStatus === "auto_categorized";
  const lowConfidence =
    txn.aiSuggestedConfidence !== null &&
    txn.aiSuggestedConfidence < LOW_CONFIDENCE_THRESHOLD;
  const shownCategory = txn.category ?? txn.aiSuggestedCategory;
  async function patch(body: Record<string, unknown>, which: "accept" | "change" | "skip") {
    setBusy(which);
    setError(null);
    try {
      const res = await fetch(`/api/transactions/${txn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "failed");
      }
      setShowReview(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  function acceptAi() {
    if (!txn.aiSuggestedCategory) return;
    return patch({ categoryId: txn.aiSuggestedCategory.id }, "accept");
  }

  function changeTo(categoryId: string) {
    return patch({ categoryId }, "change");
  }

  function skip() {
    return patch({ reviewStatus: "ignored" }, "skip");
  }

  return (
    <li
      className={
        needsReview ? "txnRow txnRowNeedsReview" : "txnRow"
      }
    >
      <div className="txnRowMain">
        <p className="txnName">{txn.merchantName ?? txn.name}</p>
        <p className="txnMeta">
          <span>{formatDate(txn.date)}</span>
          <span>·</span>
          <span>{txn.account.name}</span>
          {txn.isPending ? (
            <>
              <span>·</span>
              <span className="txnPending">pending</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="txnRowMiddle">
        <button
          type="button"
          className={
            shownCategory
              ? "txnCategoryButton"
              : "txnCategoryButton txnCategoryButtonEmpty"
          }
          onClick={() => setShowReview((v) => !v)}
          aria-expanded={showReview}
          title={
            shownCategory
              ? `Change category (currently ${shownCategory.label})`
              : "Assign a category"
          }
        >
          {shownCategory?.label ?? "uncategorized"}
          <span className="txnCategoryButtonCaret" aria-hidden>
            ▾
          </span>
        </button>
        {needsReview && lowConfidence ? (
          <span
            className="txnReviewChip txnReviewChipInline"
            title={txn.aiSuggestedReason ?? "AI confidence is low — review"}
          >
            {txn.aiSuggestedConfidence !== null
              ? `${txn.aiSuggestedConfidence}% confident`
              : "review"}
          </span>
        ) : null}
      </div>
      <p
        className={
          txn.direction === "inflow" ? "txnAmount positive" : "txnAmount"
        }
      >
        {formatAmount(txn.amount, txn.direction)}
      </p>
      {showReview ? (
        <div className="txnReviewPanel">
          {error ? <p className="errorLine">{error}</p> : null}
          {txn.aiSuggestedReason && needsReview ? (
            <p className="txnReviewReason">AI: {txn.aiSuggestedReason}</p>
          ) : null}
          <div className="txnReviewActions">
            {txn.aiSuggestedCategory &&
            needsReview &&
            txn.aiSuggestedCategory.id !== txn.category?.id ? (
              <button
                type="button"
                className="primaryButton"
                onClick={() => void acceptAi()}
                disabled={busy !== null}
              >
                {busy === "accept"
                  ? "…"
                  : `Accept: ${txn.aiSuggestedCategory.label}`}
              </button>
            ) : null}
            <select
              className="txnReviewSelect"
              disabled={busy !== null}
              value={txn.category?.id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v) void changeTo(v);
              }}
            >
              <option value="" disabled>
                {txn.category ? "Change category…" : "Pick a category…"}
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            {needsReview ? (
              <button
                type="button"
                className="linkButton"
                onClick={() => void skip()}
                disabled={busy !== null}
              >
                {busy === "skip" ? "…" : "Skip"}
              </button>
            ) : (
              <button
                type="button"
                className="linkButton"
                onClick={() => setShowReview(false)}
                disabled={busy !== null}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

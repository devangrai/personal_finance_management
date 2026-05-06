"use client";

import { useCallback, useEffect, useState } from "react";

type ManualItem = {
  id: string;
  category: string;
  label: string;
  amountCents: number;
};

type Breakdown = {
  cashCents: number;
  investmentsCents: number;
  manualAssetsCents: number;
  creditCardDebtCents: number;
  loanDebtCents: number;
  manualLiabilitiesCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  netWorthCents: number;
  manualItems: { assets: ManualItem[]; liabilities: ManualItem[] };
};

type HistoryPoint = {
  date: string;
  netWorthCents: number;
  assetsCents: number;
  liabilitiesCents: number;
};

type MomDelta = {
  currentCents: number;
  priorCents: number | null;
  deltaCents: number | null;
  priorDate: string | null;
};

function fmt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const ASSET_CATEGORIES = [
  { value: "real_estate", label: "Real estate (home)" },
  { value: "vehicle", label: "Vehicle" },
  { value: "other", label: "Other asset" }
];
const LIABILITY_CATEGORIES = [
  { value: "private_loan", label: "Private / family loan" },
  { value: "student_loan_manual", label: "Student loan (manual)" },
  { value: "other", label: "Other liability" }
];

export function NetWorthView() {
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [momDelta, setMomDelta] = useState<MomDelta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formKind, setFormKind] = useState<"asset" | "liability">("asset");
  const [formId, setFormId] = useState<string | null>(null);
  const [formCategory, setFormCategory] = useState("other");
  const [formLabel, setFormLabel] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formSubmitting, setFormSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/net-worth", { cache: "no-store" });
      const body = (await res.json()) as {
        ok?: boolean;
        breakdown?: Breakdown;
        history?: HistoryPoint[];
        momDelta?: MomDelta;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.breakdown) {
        throw new Error(body.error ?? "Failed.");
      }
      setBreakdown(body.breakdown);
      setHistory(body.history ?? []);
      setMomDelta(body.momDelta ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAddForm(kind: "asset" | "liability") {
    setFormKind(kind);
    setFormId(null);
    setFormCategory(kind === "asset" ? "real_estate" : "private_loan");
    setFormLabel("");
    setFormAmount("");
    setFormOpen(true);
  }

  function openEditForm(kind: "asset" | "liability", item: ManualItem) {
    setFormKind(kind);
    setFormId(item.id);
    setFormCategory(item.category);
    setFormLabel(item.label);
    setFormAmount((item.amountCents / 100).toString());
    setFormOpen(true);
  }

  async function submitForm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (formSubmitting) return;
    const dollars = Number(formAmount);
    if (!Number.isFinite(dollars) || dollars < 0) {
      alert("Enter a non-negative amount.");
      return;
    }
    if (!formLabel.trim()) {
      alert("Label required.");
      return;
    }
    setFormSubmitting(true);
    try {
      const res = await fetch("/api/net-worth/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: formId ?? undefined,
          kind: formKind,
          category: formCategory,
          label: formLabel.trim(),
          amountCents: Math.round(dollars * 100)
        })
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed.");
      setFormOpen(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setFormSubmitting(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Delete this item?")) return;
    try {
      await fetch(`/api/net-worth/manual/${id}`, { method: "DELETE" });
      await load();
    } catch {
      /* silent */
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="errorLine">{error}</p>;
  if (!breakdown) return null;

  return (
    <>
      <section className="panel">
        <div className="networthHero">
          <div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              Net worth
            </div>
            <div className="networthBigNumber">
              {fmt(breakdown.netWorthCents)}
            </div>
            {momDelta?.deltaCents !== null && momDelta?.deltaCents !== undefined ? (
              <div
                className="muted"
                style={{
                  fontSize: "0.9rem",
                  color:
                    momDelta.deltaCents >= 0 ? "#2f7d5b" : "#b23b3b"
                }}
              >
                {momDelta.deltaCents >= 0 ? "↑" : "↓"}{" "}
                {fmt(Math.abs(momDelta.deltaCents))} since{" "}
                {momDelta.priorDate}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: "0.85rem" }}>
                Tracking from today — chart will build over time.
              </div>
            )}
          </div>
          <NetWorthSparkline history={history} />
        </div>
      </section>

      <section className="panel">
        <h2>Breakdown</h2>
        <table className="breakdownTable">
          <tbody>
            <tr>
              <td>Cash (checking, savings)</td>
              <td>{fmt(breakdown.cashCents)}</td>
            </tr>
            <tr>
              <td>Investments</td>
              <td>{fmt(breakdown.investmentsCents)}</td>
            </tr>
            {breakdown.manualAssetsCents > 0 ? (
              <tr>
                <td>Manual assets</td>
                <td>{fmt(breakdown.manualAssetsCents)}</td>
              </tr>
            ) : null}
            <tr className="breakdownSubtotal">
              <td>Total assets</td>
              <td>{fmt(breakdown.totalAssetsCents)}</td>
            </tr>
            <tr>
              <td>Credit card debt</td>
              <td>−{fmt(breakdown.creditCardDebtCents)}</td>
            </tr>
            {breakdown.loanDebtCents > 0 ? (
              <tr>
                <td>Loans</td>
                <td>−{fmt(breakdown.loanDebtCents)}</td>
              </tr>
            ) : null}
            {breakdown.manualLiabilitiesCents > 0 ? (
              <tr>
                <td>Manual liabilities</td>
                <td>−{fmt(breakdown.manualLiabilitiesCents)}</td>
              </tr>
            ) : null}
            <tr className="breakdownSubtotal">
              <td>Total liabilities</td>
              <td>−{fmt(breakdown.totalLiabilitiesCents)}</td>
            </tr>
            <tr className="breakdownTotal">
              <td>Net worth</td>
              <td>{fmt(breakdown.netWorthCents)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.5rem"
          }}
        >
          <h2>Manual assets</h2>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => openAddForm("asset")}
          >
            + Add asset
          </button>
        </div>
        {breakdown.manualItems.assets.length === 0 ? (
          <p className="muted">
            No manual assets. Add your home value, car, or anything else
            not on Plaid.
          </p>
        ) : (
          <ul className="manualList">
            {breakdown.manualItems.assets.map((a) => (
              <li key={a.id}>
                <span className="manualLabel">
                  <strong>{a.label}</strong>{" "}
                  <em className="muted">({a.category.replace("_", " ")})</em>
                </span>
                <span>{fmt(a.amountCents)}</span>
                <span>
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => openEditForm("asset", a)}
                  >
                    edit
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => deleteItem(a.id)}
                  >
                    delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
            gap: "0.5rem"
          }}
        >
          <h2>Manual liabilities</h2>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => openAddForm("liability")}
          >
            + Add liability
          </button>
        </div>
        {breakdown.manualItems.liabilities.length === 0 ? (
          <p className="muted">
            No manual liabilities. Add mortgage balance, private loans,
            or other debts not on Plaid.
          </p>
        ) : (
          <ul className="manualList">
            {breakdown.manualItems.liabilities.map((l) => (
              <li key={l.id}>
                <span className="manualLabel">
                  <strong>{l.label}</strong>{" "}
                  <em className="muted">({l.category.replace("_", " ")})</em>
                </span>
                <span>−{fmt(l.amountCents)}</span>
                <span>
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => openEditForm("liability", l)}
                  >
                    edit
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="linkButton"
                    onClick={() => deleteItem(l.id)}
                  >
                    delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {formOpen ? (
        <div className="modalBackdrop" onClick={() => setFormOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <h2>
              {formId ? "Edit" : "Add"}{" "}
              {formKind === "asset" ? "asset" : "liability"}
            </h2>
            <form onSubmit={submitForm} className="authForm">
              <label className="authField">
                <span className="authLabel">Category</span>
                <select
                  className="authInput"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                >
                  {(formKind === "asset"
                    ? ASSET_CATEGORIES
                    : LIABILITY_CATEGORIES
                  ).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="authField">
                <span className="authLabel">Label</span>
                <input
                  type="text"
                  className="authInput"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder={
                    formKind === "asset"
                      ? "e.g. Primary home, 2022 Honda"
                      : "e.g. Mortgage on primary, Loan from dad"
                  }
                  maxLength={200}
                  required
                />
              </label>
              <label className="authField">
                <span className="authLabel">Amount ($)</span>
                <input
                  type="number"
                  className="authInput"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  min={0}
                  step="any"
                  required
                />
              </label>
              <div className="authActions">
                <button
                  type="submit"
                  className="primaryButton"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => setFormOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function NetWorthSparkline({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) {
    return (
      <div
        className="muted"
        style={{
          fontSize: "0.75rem",
          maxWidth: "14rem",
          textAlign: "right"
        }}
      >
        Chart will populate as daily snapshots build up.
      </div>
    );
  }
  const width = 320;
  const height = 80;
  const values = history.map((p) => p.netWorthCents);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = history
    .map((p, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = height - ((p.netWorthCents - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      <polyline
        fill="none"
        stroke="#163d4a"
        strokeWidth={2}
        points={points}
      />
    </svg>
  );
}

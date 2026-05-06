"use client";

import { useCallback, useEffect, useState } from "react";

type CashOutflow = {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  totalOutCents: number;
  creditCardPaymentCents: number;
  internalTransferCents: number;
  otherCashOutCents: number;
};

function fmtUsd2(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function CashOutflowCard() {
  const [data, setData] = useState<CashOutflow | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/budgets/cash-outflow", {
          cache: "no-store"
        });
        const body = (await res.json()) as {
          ok?: boolean;
          summary?: CashOutflow;
        };
        if (res.ok && body.ok && body.summary) setData(body.summary);
      } catch {
        /* silent; this card is informational only */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);
  if (!loaded) return null;
  if (!data || data.totalOutCents === 0) return null;
  return (
    <section className="panel">
      <h2>Cash out from checking/savings this month</h2>
      <p className="muted">
        What actually left your bank accounts so far — useful for seeing
        the impact of credit card autopay and transfers alongside your
        charge-basis budget below.
      </p>
      <div className="budgetTotals">
        <div>
          <div className="muted">Total cash out</div>
          <div className="budgetBigNumber">{fmtUsd2(data.totalOutCents)}</div>
        </div>
        <div>
          <div className="muted">Credit card payments</div>
          <div className="budgetBigNumber">
            {fmtUsd2(data.creditCardPaymentCents)}
          </div>
        </div>
        <div>
          <div className="muted">Internal transfers</div>
          <div className="budgetBigNumber">
            {fmtUsd2(data.internalTransferCents)}
          </div>
        </div>
        <div>
          <div className="muted">Other outflow</div>
          <div className="budgetBigNumber">
            {fmtUsd2(data.otherCashOutCents)}
          </div>
        </div>
      </div>
    </section>
  );
}

type CategoryStatus = {
  categoryId: string | null;
  categoryKey: string | null;
  categoryLabel: string;
  spentCents: number;
  budgetCents: number | null;
  percent: number | null;
  projectedCents: number;
  projectedPercent: number | null;
  expectedRecurringCents: number;
  flag: "on_pace" | "warning" | "over" | "under" | "no_budget";
};

type Status = {
  month: string;
  daysElapsed: number;
  daysInMonth: number;
  pastPercent: number;
  totalSpentCents: number;
  totalBudgetCents: number;
  projectedTotalCents: number;
  categories: CategoryStatus[];
};

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function flagColor(flag: CategoryStatus["flag"]): string {
  return {
    over: "statusPill--expired",
    warning: "statusPill--active",
    on_pace: "statusPill--used",
    under: "statusPill--used",
    no_budget: "statusPill--expired"
  }[flag];
}

function flagLabel(flag: CategoryStatus["flag"]): string {
  return {
    over: "Over",
    warning: "On pace to exceed",
    on_pace: "On pace",
    under: "Under",
    no_budget: "No budget"
  }[flag];
}

export function BudgetGrid() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline-edit state: categoryId → draft value in dollars.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  // Suggest flow (for first-time users)
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/budgets/status", { cache: "no-store" });
      const body = (await res.json()) as { ok?: boolean; status?: Status; error?: string };
      if (!res.ok || !body.ok || !body.status) {
        throw new Error(body.error ?? "Failed to load.");
      }
      setStatus(body.status);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveBudget(row: CategoryStatus) {
    const key = row.categoryId ?? "__uncat__";
    const draft = drafts[key];
    if (!draft) return;
    const dollars = Number(draft);
    if (!Number.isFinite(dollars) || dollars < 0) {
      alert("Enter a non-negative number.");
      return;
    }
    setSavingId(key);
    try {
      const res = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: row.categoryId,
          monthlyAmountCents: Math.round(dollars * 100)
        })
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Save failed.");
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSavingId(null);
    }
  }

  async function runSuggest() {
    if (!confirm("Suggest budgets from your trailing 3-month spending?")) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/budgets/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ months: 3 })
      });
      const body = (await res.json()) as {
        ok?: boolean;
        suggestions?: Array<{ categoryId: string | null; suggestedCents: number; categoryLabel: string }>;
        error?: string;
      };
      if (!res.ok || !body.ok || !body.suggestions) {
        throw new Error(body.error ?? "Suggest failed.");
      }
      // Apply each suggestion as a budget
      for (const s of body.suggestions) {
        if (s.suggestedCents <= 0) continue;
        await fetch("/api/budgets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categoryId: s.categoryId,
            monthlyAmountCents: s.suggestedCents
          })
        });
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Suggest failed.");
    } finally {
      setSuggesting(false);
    }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="errorLine">{error}</p>;
  if (!status) return null;

  const hasAnyBudgets = status.categories.some((c) => c.budgetCents !== null);

  return (
    <>
      <section className="panel">
        <div className="budgetMonthHeader">
          <h2>{status.month}</h2>
          <p className="muted">
            Day {status.daysElapsed} of {status.daysInMonth} —{" "}
            {Math.round(status.pastPercent)}% of month elapsed
          </p>
        </div>

        <div className="budgetTotals">
          <div>
            <div className="muted">Spent this month</div>
            <div className="budgetBigNumber">{fmtUsd(status.totalSpentCents)}</div>
          </div>
          <div>
            <div className="muted">Budgeted</div>
            <div className="budgetBigNumber">
              {status.totalBudgetCents > 0 ? fmtUsd(status.totalBudgetCents) : "—"}
            </div>
          </div>
          <div>
            <div className="muted">Projected end-of-month</div>
            <div className="budgetBigNumber">
              {fmtUsd(status.projectedTotalCents)}
            </div>
            <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>
              Blended MTD pace + 3-month average
            </div>
          </div>
        </div>
      </section>

      <CashOutflowCard />

      {!hasAnyBudgets ? (
        <section className="panel">
          <h2>No budgets set yet</h2>
          <p className="muted">
            Set a budget for each category you want to track, or let us
            suggest values based on your last 3 months of spending.
          </p>
          <div className="authActions">
            <button
              type="button"
              className="primaryButton"
              disabled={suggesting}
              onClick={runSuggest}
            >
              {suggesting ? "Suggesting…" : "Auto-suggest from history"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Category breakdown</h2>
        <table className="budgetTable">
          <thead>
            <tr>
              <th>Category</th>
              <th>Spent</th>
              <th>Budget</th>
              <th>% used</th>
              <th>Projected</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {status.categories.map((r) => {
              const key = r.categoryId ?? "__uncat__";
              const editing = drafts[key] !== undefined;
              return (
                <tr key={key} className={`budgetRow budgetRow--${r.flag}`}>
                  <td>{r.categoryLabel}</td>
                  <td>{fmtUsd(r.spentCents)}</td>
                  <td>
                    {editing ? (
                      <span style={{ display: "flex", gap: "0.3rem" }}>
                        <input
                          type="number"
                          className="authInput"
                          style={{ width: "6rem" }}
                          value={drafts[key]}
                          min={0}
                          step={5}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [key]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="primaryButton"
                          disabled={savingId === key}
                          onClick={() => saveBudget(r)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="secondaryButton"
                          onClick={() =>
                            setDrafts((d) => {
                              const next = { ...d };
                              delete next[key];
                              return next;
                            })
                          }
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="linkButton"
                        onClick={() =>
                          setDrafts((d) => ({
                            ...d,
                            [key]:
                              r.budgetCents !== null
                                ? String(r.budgetCents / 100)
                                : ""
                          }))
                        }
                      >
                        {r.budgetCents !== null
                          ? fmtUsd(r.budgetCents)
                          : "Set budget"}
                      </button>
                    )}
                  </td>
                  <td>
                    {r.percent !== null ? `${Math.round(r.percent)}%` : "—"}
                  </td>
                  <td>
                    {fmtUsd(r.projectedCents)}
                    {r.expectedRecurringCents > 0 ? (
                      <div
                        className="muted"
                        style={{ fontSize: "0.75rem", marginTop: "0.15rem" }}
                      >
                        +{fmtUsd(r.expectedRecurringCents)} expected from recurring
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={`statusPill ${flagColor(r.flag)}`}>
                      {flagLabel(r.flag)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

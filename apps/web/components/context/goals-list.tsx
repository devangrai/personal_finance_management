"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Goal = {
  id: string;
  goalKey: string;
  label: string;
  targetValue: string | null;
  targetDate: string | null;
  commitment: string | null;
  isActive: boolean;
};

function formatMoney(v: string | null): string {
  if (!v) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function formatDate(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

export function GoalsList(props: { goals: Goal[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const activeGoals = props.goals.filter((g) => g.isActive);

  async function remove(goalId: string) {
    if (
      !window.confirm(
        "Deactivate this goal? It won't be deleted but it'll stop showing up here."
      )
    ) {
      return;
    }
    setDeletingId(goalId);
    try {
      await fetch(`/api/goals/${goalId}`, { method: "DELETE" });
      startTransition(() => router.refresh());
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="goalsList">
      {activeGoals.length === 0 ? (
        <p className="emptyLine">
          No goals yet. Add one to start tracking progress.
        </p>
      ) : (
        <ul className="goalsUl">
          {activeGoals.map((g) => (
            <li key={g.id} className="goalRow">
              <div className="goalRowMain">
                <strong>{g.label}</strong>
                <div className="goalRowMeta">
                  {g.targetValue ? (
                    <span>Target {formatMoney(g.targetValue)}</span>
                  ) : null}
                  {g.targetDate ? (
                    <span>by {formatDate(g.targetDate)}</span>
                  ) : null}
                </div>
                {g.commitment ? (
                  <p className="goalRowCommitment">{g.commitment}</p>
                ) : null}
              </div>
              <button
                className="linkButton"
                onClick={() => void remove(g.id)}
                disabled={deletingId === g.id}
                type="button"
              >
                {deletingId === g.id ? "…" : "remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showForm ? (
        <GoalForm
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            startTransition(() => router.refresh());
          }}
        />
      ) : (
        <button
          className="secondaryButton"
          onClick={() => setShowForm(true)}
          type="button"
        >
          + Add goal
        </button>
      )}
    </div>
  );
}

function GoalForm(props: { onCancel: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [commitment, setCommitment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError("Label is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const goalKey = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || `goal-${Date.now()}`;
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalKey,
          label: label.trim(),
          targetValue: targetValue.trim() || null,
          targetDate: targetDate || null,
          commitment: commitment.trim() || null,
          isActive: true
        })
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `save failed (${res.status})`);
      }
      props.onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="goalForm" onSubmit={onSubmit}>
      <label className="goalFormField">
        <span className="goalFormLabel">What do you want to achieve?</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Max 401(k) in 2026"
          required
          autoFocus
          className="goalFormInput"
        />
      </label>
      <div className="goalFormRow">
        <label className="goalFormField">
          <span className="goalFormLabel">Target amount (optional)</span>
          <input
            type="number"
            step="0.01"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="24000"
            className="goalFormInput"
          />
        </label>
        <label className="goalFormField">
          <span className="goalFormLabel">Target date (optional)</span>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="goalFormInput"
          />
        </label>
      </div>
      <label className="goalFormField">
        <span className="goalFormLabel">Commitment / notes (optional)</span>
        <textarea
          value={commitment}
          onChange={(e) => setCommitment(e.target.value)}
          placeholder="I'll bump my 401k contribution to 18%."
          rows={2}
          className="goalFormInput"
        />
      </label>
      {error ? <p className="errorLine">{error}</p> : null}
      <div className="goalFormActions">
        <button
          type="button"
          className="linkButton"
          onClick={props.onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button type="submit" className="primaryButton" disabled={saving}>
          {saving ? "Saving…" : "Add goal"}
        </button>
      </div>
    </form>
  );
}

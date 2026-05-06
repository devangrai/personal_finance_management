"use client";

import { useCallback, useEffect, useState } from "react";

type Extraction = {
  id: string;
  kind: string;
  status: "auto_applied" | "staged" | "confirmed" | "reverted";
  factKey: string | null;
  goalKey: string | null;
  newValue: unknown;
  previousValue: unknown;
  confidence: number;
  evidence: string;
  stakesLevel: "low" | "medium" | "high";
  createdAt: string;
  appliedAt: string | null;
  revertedAt: string | null;
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  return String(v);
}

function formatAge(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

/**
 * Recent updates panel for /context. Shows the advisor's recent
 * auto-applied and staged fact extractions, with confirm/reject/revert
 * controls. This is how the user stays in control of what the agent is
 * learning about them.
 */
export function RecentUpdatesPanel() {
  const [rows, setRows] = useState<Extraction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/extractions", { cache: "no-store" });
      const body = (await res.json()) as {
        ok?: boolean;
        extractions?: Extraction[];
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load.");
      }
      setRows(body.extractions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "confirm" | "reject" | "revert") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/extractions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed.");
      }
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <h2>What I&apos;m learning about you</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="panel">
        <h2>What I&apos;m learning about you</h2>
        <p className="errorLine">{error}</p>
      </section>
    );
  }

  const staged = rows?.filter((r) => r.status === "staged") ?? [];
  const applied =
    rows?.filter(
      (r) => r.status === "auto_applied" || r.status === "confirmed"
    ) ?? [];
  const reverted = rows?.filter((r) => r.status === "reverted") ?? [];

  const totalCount = (rows ?? []).length;

  return (
    <section className="panel">
      <div className="extractionsHeader">
        <h2>What I&apos;m learning about you</h2>
        <p className="muted">
          The advisor auto-updates what it knows when you share things in
          chat. Confirm staged items, or undo any auto-applied change.
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="muted">
          No updates yet. As you chat, I&apos;ll save facts and goals I
          learn about you here.
        </p>
      ) : null}

      {staged.length > 0 ? (
        <div className="extractionsGroup">
          <h3 className="extractionsGroupHeader">
            Needs your confirmation <span className="countPill">{staged.length}</span>
          </h3>
          <ul className="extractionsList">
            {staged.map((r) => (
              <li key={r.id} className="extractionItem extractionItem--staged">
                <div className="extractionLabel">
                  <span className="kindPill">{r.kind}</span>
                  <span className="factKey">
                    {r.factKey ?? r.goalKey ?? "?"}
                  </span>
                  <span className="stakesPill stakesPill--{r.stakesLevel}">
                    {r.stakesLevel}
                  </span>
                </div>
                <div className="extractionValue">
                  <strong>Proposed:</strong> {formatValue(r.newValue)}
                </div>
                {r.previousValue !== null ? (
                  <div className="extractionValue extractionValue--previous">
                    <strong>Replacing:</strong> {formatValue(r.previousValue)}
                  </div>
                ) : null}
                <div className="extractionEvidence">
                  &ldquo;{r.evidence}&rdquo;{" "}
                  <span className="muted">({formatAge(r.createdAt)})</span>
                </div>
                <div className="extractionActions">
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, "confirm")}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, "reject")}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {applied.length > 0 ? (
        <div className="extractionsGroup">
          <h3 className="extractionsGroupHeader">Recently saved</h3>
          <ul className="extractionsList">
            {applied.map((r) => (
              <li key={r.id} className="extractionItem extractionItem--applied">
                <div className="extractionLabel">
                  <span className="kindPill">{r.kind}</span>
                  <span className="factKey">
                    {r.factKey ?? r.goalKey ?? "?"}
                  </span>
                  <span
                    className={`statusPill statusPill--${
                      r.status === "confirmed" ? "used" : "active"
                    }`}
                  >
                    {r.status === "confirmed" ? "confirmed" : "auto-saved"}
                  </span>
                </div>
                <div className="extractionValue">
                  {formatValue(r.newValue)}
                </div>
                <div className="extractionEvidence">
                  &ldquo;{r.evidence}&rdquo;{" "}
                  <span className="muted">({formatAge(r.createdAt)})</span>
                </div>
                <div className="extractionActions">
                  <button
                    type="button"
                    className="linkButton"
                    disabled={busyId === r.id}
                    onClick={() => act(r.id, "revert")}
                  >
                    Undo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reverted.length > 0 ? (
        <div className="extractionsGroup">
          <h3 className="extractionsGroupHeader">Reverted</h3>
          <ul className="extractionsList">
            {reverted.map((r) => (
              <li
                key={r.id}
                className="extractionItem extractionItem--reverted"
              >
                <div className="extractionLabel">
                  <span className="kindPill">{r.kind}</span>
                  <span className="factKey">
                    {r.factKey ?? r.goalKey ?? "?"}
                  </span>
                  <span className="statusPill statusPill--expired">
                    reverted
                  </span>
                </div>
                <div className="extractionValue muted">
                  was: {formatValue(r.newValue)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import type { ViewerHighlight } from "./document-viewer";

export type FactRow = {
  id: string;
  factKey: string;
  newValue: unknown;
  confidence: number;
  evidence: string;
  status: "staged" | "confirmed" | "auto_applied" | "reverted";
  stakesLevel: string;
  page: number | null;
  sourceRegion: unknown;
  createdAt: string;
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    // Heuristic: if it looks like currency (>1000 or has key hints), format
    if (v >= 1000 || v <= -1000) return `$${v.toLocaleString()}`;
    if (Number.isInteger(v)) return String(v);
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v).slice(0, 80);
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (m) => m.toUpperCase());
}

export function ExtractedFactsPanel(props: {
  facts: FactRow[];
  onSelectHighlight: (highlight: ViewerHighlight | null) => void;
  onReload: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function act(id: string, action: "confirm" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/extractions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed.");
      props.onReload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmAll(highConfidence: boolean) {
    const targets = props.facts.filter((f) => {
      if (f.status !== "staged") return false;
      if (highConfidence && f.confidence < 0.9) return false;
      return true;
    });
    if (targets.length === 0) return;
    if (!confirm(`Confirm ${targets.length} fact${targets.length === 1 ? "" : "s"}?`)) return;
    for (const f of targets) {
      await fetch(`/api/extractions/${f.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" })
      });
    }
    props.onReload();
  }

  function selectFact(f: FactRow) {
    setSelectedId(f.id);
    const sr = f.sourceRegion as
      | { x0?: number; y0?: number; x1?: number; y1?: number; pageWidth?: number; pageHeight?: number }
      | null;
    if (!sr || typeof sr.x0 !== "number") {
      props.onSelectHighlight(null);
      return;
    }
    // Normalize if the model returned absolute coords
    const w = typeof sr.pageWidth === "number" && sr.pageWidth > 1 ? sr.pageWidth : 1;
    const h = typeof sr.pageHeight === "number" && sr.pageHeight > 1 ? sr.pageHeight : 1;
    props.onSelectHighlight({
      page: f.page ?? 1,
      x0: (sr.x0 ?? 0) / w,
      y0: (sr.y0 ?? 0) / h,
      x1: (sr.x1 ?? 0) / w,
      y1: (sr.y1 ?? 0) / h
    });
  }

  const staged = props.facts.filter((f) => f.status === "staged");
  const confirmed = props.facts.filter(
    (f) => f.status === "confirmed" || f.status === "auto_applied"
  );

  return (
    <div className="factsPanel">
      <div className="factsHeader">
        <h3>What I found</h3>
        {staged.length > 0 ? (
          <div className="factsBulkActions">
            <button
              type="button"
              className="linkButton"
              onClick={() => confirmAll(true)}
            >
              Confirm all high-confidence
            </button>
            <button
              type="button"
              className="linkButton"
              onClick={() => confirmAll(false)}
            >
              Confirm all
            </button>
          </div>
        ) : null}
      </div>

      {staged.length === 0 && confirmed.length === 0 ? (
        <p className="muted">
          No facts extracted yet. If extraction failed, try re-running it.
        </p>
      ) : null}

      {staged.length > 0 ? (
        <div className="factsGroup">
          <h4 className="factsGroupHeader">
            Needs your review <span className="countPill">{staged.length}</span>
          </h4>
          <ul className="factsList">
            {staged.map((f) => (
              <li
                key={f.id}
                className={`factItem ${selectedId === f.id ? "factItem--selected" : ""}`}
                onClick={() => selectFact(f)}
              >
                <div className="factLabel">
                  <span className="factKeyName">{humanizeKey(f.factKey)}</span>
                  <span className="factConfidence">
                    {(f.confidence * 100).toFixed(0)}% conf
                  </span>
                </div>
                <div className="factValue">{formatValue(f.newValue)}</div>
                <div className="factEvidence">
                  &ldquo;{f.evidence}&rdquo;
                  {f.page ? ` · p.${f.page}` : ""}
                </div>
                <div className="factActions">
                  <button
                    type="button"
                    className="primaryButton"
                    disabled={busyId === f.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void act(f.id, "confirm");
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className="secondaryButton"
                    disabled={busyId === f.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      void act(f.id, "reject");
                    }}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {confirmed.length > 0 ? (
        <div className="factsGroup">
          <h4 className="factsGroupHeader">Confirmed</h4>
          <ul className="factsList">
            {confirmed.map((f) => (
              <li
                key={f.id}
                className={`factItem factItem--confirmed ${selectedId === f.id ? "factItem--selected" : ""}`}
                onClick={() => selectFact(f)}
              >
                <div className="factLabel">
                  <span className="factKeyName">{humanizeKey(f.factKey)}</span>
                </div>
                <div className="factValue">{formatValue(f.newValue)}</div>
                <div className="factEvidence">
                  &ldquo;{f.evidence}&rdquo;
                  {f.page ? ` · p.${f.page}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

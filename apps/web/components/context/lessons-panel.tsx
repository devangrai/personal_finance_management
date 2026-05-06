"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  id: string;
  kind: string;
  topic: string;
  patternSummary: string;
  clusterStrength: number;
  createdAt: string;
};

type Graduated = {
  id: string;
  kind: string;
  topic: string;
  patternSummary: string;
  actionOrCaveat: string;
  timesApplied: number;
  lastAppliedAt: string | null;
  graduatedAt: string;
};

export function LessonsPanel(props: {
  pending: Candidate[];
  graduated: Graduated[];
}) {
  return (
    <div className="lessonsPanel">
      <h3 className="lessonsPanelHeading">Confirmed patterns</h3>
      {props.graduated.length === 0 ? (
        <p className="emptyLine">
          The advisor hasn&apos;t learned any patterns yet. After a few
          conversations, patterns will show up here to confirm.
        </p>
      ) : (
        <ul className="lessonList">
          {props.graduated.map((l) => (
            <GraduatedRow key={l.id} lesson={l} />
          ))}
        </ul>
      )}

      <h3 className="lessonsPanelHeading lessonsPanelHeadingSpaced">
        Pending for your review{" "}
        {props.pending.length > 0 ? (
          <span className="pendingBadge">{props.pending.length}</span>
        ) : null}
      </h3>
      {props.pending.length === 0 ? (
        <p className="emptyLine">Nothing waiting.</p>
      ) : (
        <ul className="lessonList">
          {props.pending.map((c) => (
            <PendingRow key={c.id} candidate={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function GraduatedRow(props: { lesson: Graduated }) {
  const l = props.lesson;
  return (
    <li className="lessonRow graduated">
      <div className="lessonRowMain">
        <span className="lessonTopicChip">{l.topic}</span>
        <p className="lessonAction">{l.actionOrCaveat}</p>
        <p className="lessonPattern">Pattern: {l.patternSummary}</p>
      </div>
      <div className="lessonMeta">
        applied {l.timesApplied}×
        {l.lastAppliedAt ? (
          <> · last {l.lastAppliedAt.slice(0, 10)}</>
        ) : null}
      </div>
    </li>
  );
}

function PendingRow(props: { candidate: Candidate }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(which: "accept" | "reject") {
    const rationale = window.prompt(
      which === "accept"
        ? "Why are you accepting this? A short reason helps the advisor."
        : "Why are you rejecting this? A short reason helps the advisor.",
      which === "accept" ? "Yes, this matches my expectations." : ""
    );
    if (rationale === null) return;
    if (!rationale.trim()) {
      setError("Rationale is required.");
      return;
    }
    setBusy(which);
    setError(null);
    try {
      const url =
        which === "accept"
          ? `/api/lessons/${props.candidate.id}/graduate`
          : `/api/lessons/${props.candidate.id}/reject`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rationale: rationale.trim() })
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `${which} failed`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="lessonRow pending">
      <div className="lessonRowMain">
        <span className="lessonTopicChip">{props.candidate.topic}</span>
        <p className="lessonAction">{props.candidate.patternSummary}</p>
        <p className="lessonPattern">
          evidence strength: {props.candidate.clusterStrength} · queued{" "}
          {props.candidate.createdAt.slice(0, 10)}
        </p>
        {error ? <p className="errorLine">{error}</p> : null}
      </div>
      <div className="lessonActions">
        <button
          type="button"
          className="primaryButton"
          onClick={() => void act("accept")}
          disabled={!!busy}
        >
          {busy === "accept" ? "…" : "Accept"}
        </button>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => void act("reject")}
          disabled={!!busy}
        >
          {busy === "reject" ? "…" : "Reject"}
        </button>
      </div>
    </li>
  );
}

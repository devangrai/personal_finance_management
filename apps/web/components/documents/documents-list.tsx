"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UploadDialog } from "@/components/documents/upload-dialog";

type DocumentRow = {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  documentType: string;
  status: "pending" | "processing" | "ready" | "failed";
  errorMessage: string | null;
  uploadedAt: string;
  processedAt: string | null;
  extractionCount: number;
};

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

export function DocumentsList() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      const body = (await res.json()) as {
        ok?: boolean;
        documents?: DocumentRow[];
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load.");
      setDocs(body.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // If any doc is processing, poll every 2s so the list refreshes.
  useEffect(() => {
    const hasProcessing = docs?.some(
      (d) => d.status === "pending" || d.status === "processing"
    );
    if (!hasProcessing) return;
    const interval = setInterval(() => {
      void load();
    }, 2500);
    return () => clearInterval(interval);
  }, [docs, load]);

  return (
    <>
      <section className="panel">
        <div className="docsHeader">
          <h2>Your documents</h2>
          <button
            type="button"
            className="primaryButton"
            onClick={() => setUploadOpen(true)}
          >
            + Upload document
          </button>
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="errorLine">{error}</p>
        ) : !docs || docs.length === 0 ? (
          <p className="muted">
            No documents yet. Upload your tax forms, W-2s, brokerage
            statements, and other financial documents so the advisor
            can reference them.
          </p>
        ) : (
          <div className="docsGrid">
            {docs.map((d) => (
              <Link
                key={d.id}
                href={`/documents/${d.id}`}
                className="docCard"
              >
                <div className="docCardIcon">
                  {d.mimeType.startsWith("image/") ? "🖼️" : "📄"}
                </div>
                <div className="docCardBody">
                  <div className="docCardTitle">{d.title}</div>
                  <div className="docCardMeta">
                    <span className={`statusPill statusPill--${statusVariant(d.status)}`}>
                      {d.status}
                    </span>
                    {d.status === "ready" ? (
                      <span className="muted">
                        {d.extractionCount} fact{d.extractionCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <span className="muted">{formatBytes(d.sizeBytes)}</span>
                    <span className="muted">{formatAge(d.uploadedAt)}</span>
                  </div>
                  {d.errorMessage ? (
                    <div className="docCardError">{d.errorMessage}</div>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <UploadDialog
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
          void load();
        }}
      />
    </>
  );
}

function statusVariant(status: DocumentRow["status"]): string {
  switch (status) {
    case "ready":
      return "used";
    case "processing":
    case "pending":
      return "active";
    case "failed":
      return "expired";
  }
}

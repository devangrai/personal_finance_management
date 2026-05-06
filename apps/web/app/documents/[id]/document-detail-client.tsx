"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ExtractedFactsPanel, type FactRow } from "@/components/documents/extracted-facts-panel";
import type { ViewerHighlight } from "@/components/documents/document-viewer";

// react-pdf brings pdfjs-dist — a hefty dep. Only load it client-side
// on the detail page, not on the /documents list.
const DocumentViewer = dynamic(
  () => import("@/components/documents/document-viewer").then((m) => m.DocumentViewer),
  { ssr: false, loading: () => <div className="viewerLoading">Loading viewer…</div> }
);

type DocMeta = {
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
};

export default function DocumentDetailClient(props: { documentId: string }) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<ViewerHighlight | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${props.documentId}`, {
        cache: "no-store"
      });
      const body = (await res.json()) as {
        ok?: boolean;
        document?: DocMeta;
        extractions?: FactRow[];
        error?: string;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to load.");
      setDoc(body.document ?? null);
      setFacts(body.extractions ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [props.documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while processing
  useEffect(() => {
    if (!doc) return;
    if (doc.status !== "processing" && doc.status !== "pending") return;
    const interval = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(interval);
  }, [doc, load]);

  async function saveTitle() {
    if (!doc || !titleDraft.trim()) return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleDraft.trim() })
      });
      if (!res.ok) throw new Error("Failed to update.");
      setEditingTitle(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed.");
    }
  }

  async function deleteDoc() {
    if (!doc) return;
    if (!confirm(`Permanently delete "${doc.title}"? This removes the file and its extracted facts (confirmed facts in /context stay).`))
      return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed.");
      router.push("/documents");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  async function reprocess() {
    if (!doc) return;
    await fetch(`/api/documents/${doc.id}/reprocess`, { method: "POST" });
    setFacts([]);
    await load();
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="errorLine">{error}</p>;
  if (!doc) return <p className="muted">Not found.</p>;

  return (
    <>
      <section className="hero heroCompact">
        <p className="eyebrow">
          <Link href="/documents">Documents</Link> ·{" "}
          <span className="statusPill statusPill--{doc.status}">{doc.status}</span>
        </p>
        <div className="docDetailTitleRow">
          {editingTitle ? (
            <>
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="authInput"
                style={{ maxWidth: "32rem", fontSize: "1.5rem" }}
              />
              <button
                type="button"
                className="primaryButton"
                onClick={saveTitle}
              >
                Save
              </button>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setEditingTitle(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1>{doc.title}</h1>
              <button
                type="button"
                className="linkButton"
                onClick={() => {
                  setTitleDraft(doc.title);
                  setEditingTitle(true);
                }}
              >
                Edit title
              </button>
            </>
          )}
        </div>
        <div className="docDetailMeta muted">
          <span>{doc.documentType}</span>
          <span>·</span>
          <span>{doc.originalFilename}</span>
          <span>·</span>
          <span>
            {(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB
            {doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </section>

      {doc.status === "failed" ? (
        <section className="panel">
          <h2>Extraction failed</h2>
          <p>{doc.errorMessage ?? "An unknown error occurred."}</p>
          <div className="authActions">
            <button type="button" className="primaryButton" onClick={reprocess}>
              Retry extraction
            </button>
            <button type="button" className="secondaryButton" onClick={deleteDoc}>
              Delete document
            </button>
          </div>
        </section>
      ) : doc.status === "processing" || doc.status === "pending" ? (
        <section className="panel">
          <h2>Extracting facts…</h2>
          <p className="muted">
            The advisor is reading your document. This usually takes 10-30
            seconds. We&apos;ll refresh this page automatically when it&apos;s done.
          </p>
        </section>
      ) : (
        <section className="docDetailLayout">
          <div className="docDetailViewer">
            <DocumentViewer
              documentId={doc.id}
              mimeType={doc.mimeType}
              highlight={highlight}
            />
          </div>
          <div className="docDetailFacts">
            <ExtractedFactsPanel
              facts={facts}
              onSelectHighlight={setHighlight}
              onReload={load}
            />
            <div className="docDetailFooter">
              <button
                type="button"
                className="secondaryButton"
                onClick={reprocess}
              >
                Re-extract
              </button>
              <button
                type="button"
                className="secondaryButton"
                onClick={deleteDoc}
              >
                Delete document
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

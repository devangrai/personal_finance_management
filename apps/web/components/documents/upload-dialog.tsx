"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Common document type options. Stored as free-form strings in the DB
 * so adding a type requires no schema change — just expand this list.
 */
const DOCUMENT_TYPES: Array<{ value: string; label: string; yearRelevant: boolean }> = [
  { value: "w2", label: "W-2 (wage & tax)", yearRelevant: true },
  { value: "paystub", label: "Paystub", yearRelevant: false },
  { value: "comp_statement", label: "Compensation statement", yearRelevant: true },
  { value: "ten99_nec", label: "1099-NEC", yearRelevant: true },
  { value: "ten99_div", label: "1099-DIV", yearRelevant: true },
  { value: "ten99_int", label: "1099-INT", yearRelevant: true },
  { value: "ten99_b", label: "1099-B (brokerage sales)", yearRelevant: true },
  { value: "ten99_r", label: "1099-R (retirement)", yearRelevant: true },
  { value: "tax_return_1040", label: "Federal tax return (1040)", yearRelevant: true },
  { value: "k1", label: "Schedule K-1", yearRelevant: true },
  { value: "brokerage_statement", label: "Brokerage statement", yearRelevant: false },
  { value: "mortgage_statement", label: "Mortgage statement", yearRelevant: false },
  { value: "bank_statement", label: "Bank statement", yearRelevant: false },
  { value: "loan_statement", label: "Loan statement", yearRelevant: false },
  { value: "other", label: "Other", yearRelevant: false }
];

function suggestTitle(filename: string, documentType: string, year: string): string {
  const typeLabel = DOCUMENT_TYPES.find((t) => t.value === documentType)?.label ??
    filename.replace(/\.[^.]+$/, "");
  const base = typeLabel.replace(/\s*\(.*\)\s*/g, "").trim();
  if (year) return `${year} ${base}`;
  return base;
}

export function UploadDialog(props: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("w2");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedType = DOCUMENT_TYPES.find((t) => t.value === documentType);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    // Auto-suggest title if user hasn't typed one yet
    if (!title.trim()) {
      setTitle(suggestTitle(f.name, documentType, selectedType?.yearRelevant ? year : ""));
    }
  }

  function onTypeChange(newType: string) {
    setDocumentType(newType);
    if (file && !title.trim()) {
      const typeObj = DOCUMENT_TYPES.find((t) => t.value === newType);
      setTitle(suggestTitle(file.name, newType, typeObj?.yearRelevant ? year : ""));
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim());
      form.append("documentType", documentType);
      const res = await fetch("/api/documents", {
        method: "POST",
        body: form
      });
      const body = (await res.json()) as {
        ok?: boolean;
        document?: { id: string };
        error?: string;
      };
      if (!res.ok || !body.ok || !body.document) {
        throw new Error(body.error ?? "Upload failed.");
      }
      // Close dialog, navigate to the new document's detail page
      props.onClose();
      router.push(`/documents/${body.document.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="modalBackdrop" onClick={props.onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <h2>Upload a document</h2>
        <p className="muted">
          PDFs and images up to 25MB. Your document stays private —
          only you can see it.
        </p>
        <form onSubmit={onSubmit} className="authForm">
          <label className="authField">
            <span className="authLabel">File</span>
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={onFileChange}
              disabled={submitting}
              className="authInput"
              required
            />
            {file ? (
              <span className="muted">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            ) : null}
          </label>

          <label className="authField">
            <span className="authLabel">Document type</span>
            <select
              value={documentType}
              onChange={(e) => onTypeChange(e.target.value)}
              disabled={submitting}
              className="authInput"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {selectedType?.yearRelevant ? (
            <label className="authField">
              <span className="authLabel">Year</span>
              <input
                type="number"
                min={1990}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={submitting}
                className="authInput"
                style={{ maxWidth: "8rem" }}
              />
            </label>
          ) : null}

          <label className="authField">
            <span className="authLabel">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2024 W-2"
              disabled={submitting}
              className="authInput"
              required
              maxLength={200}
            />
          </label>

          {error ? <p className="errorLine authError">{error}</p> : null}

          <div className="authActions" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              className="secondaryButton"
              onClick={props.onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="primaryButton"
              disabled={submitting || !file || !title.trim()}
            >
              {submitting ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

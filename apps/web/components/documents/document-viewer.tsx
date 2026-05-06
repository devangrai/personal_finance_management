"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// pdfjs worker setup.
//
// react-pdf ships with its own `pdfjs-dist` peer dependency. The worker
// BINARY must match the `pdfjs` API that react-pdf imported, otherwise
// <Document> fails silently on load. Rather than pin pdfjs-dist at the
// app level (which couples our package.json to react-pdf's internals),
// we set the worker URL to the CDN-hosted worker keyed to the version
// pdfjs.version reports. That version is always the one react-pdf is
// actually using, so there's no mismatch.
//
// Loading from unpkg keeps bundle size small and sidesteps Next's
// static-asset pipeline for the worker. The CDN is cached aggressively
// on the client so repeat loads are free.
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export type ViewerHighlight = {
  page: number; // 1-indexed
  /** Normalized bounding box 0..1 in the PDF's own coordinate space */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type Props = {
  documentId: string;
  mimeType: string;
  highlight: ViewerHighlight | null;
  /** Optional: called when user navigates pages manually */
  onPageChange?: (page: number) => void;
};

/**
 * Renders either a PDF (via react-pdf) or an image directly. In both
 * cases, when a `highlight` is provided, renders an absolutely-positioned
 * overlay on top of the current page.
 *
 * The `highlight` coordinate space is normalized (0..1) so we can scale
 * it to whatever the rendered page pixel size happens to be.
 */
export function DocumentViewer({
  documentId,
  mimeType,
  highlight,
  onPageChange
}: Props) {
  const fileUrl = `/api/documents/${documentId}/file`;
  const [pageCount, setPageCount] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pageDimensions, setPageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // When a highlight is set, jump to its page
  useEffect(() => {
    if (highlight && highlight.page && highlight.page !== currentPage) {
      setCurrentPage(highlight.page);
    }
  }, [highlight, currentPage]);

  // Notify parent of page changes
  useEffect(() => {
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);

  if (mimeType.startsWith("image/")) {
    return (
      <div className="viewerRoot" ref={containerRef}>
        <div className="viewerPageWrap">
          <img
            src={fileUrl}
            alt="Document"
            className="viewerImage"
            onLoad={(e) => {
              const el = e.currentTarget;
              setPageDimensions({
                width: el.clientWidth,
                height: el.clientHeight
              });
            }}
          />
          {highlight && pageDimensions ? (
            <HighlightOverlay
              highlight={highlight}
              pageDimensions={pageDimensions}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="viewerRoot" ref={containerRef}>
      <Document
        file={fileUrl}
        onLoadSuccess={(info) => {
          setPageCount(info.numPages);
          setLoadError(null);
        }}
        onLoadError={(err) => {
          console.error("[DocumentViewer] PDF load error:", err);
          setLoadError(err.message || "Failed to load PDF.");
        }}
        loading={<div className="viewerLoading">Loading PDF…</div>}
        error={
          <div className="viewerError">
            <p>Couldn&apos;t render the PDF in the viewer.</p>
            {loadError ? (
              <p className="muted" style={{ fontSize: "0.8rem" }}>
                {loadError}
              </p>
            ) : null}
            <p>
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Open the original file in a new tab →
              </a>
            </p>
          </div>
        }
      >
        <div className="viewerPageWrap">
          <Page
            pageNumber={currentPage}
            width={680}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            onRenderSuccess={(page) => {
              // react-pdf's Page gives us the rendered dimensions after
              // scaling. Use those to position the overlay correctly.
              setPageDimensions({
                width: page.width,
                height: page.height
              });
            }}
          />
          {highlight && highlight.page === currentPage && pageDimensions ? (
            <HighlightOverlay
              highlight={highlight}
              pageDimensions={pageDimensions}
            />
          ) : null}
        </div>
      </Document>
      {pageCount > 1 ? (
        <div className="viewerPager">
          <button
            type="button"
            className="secondaryButton"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
          >
            ← Prev
          </button>
          <span className="muted">
            Page {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => setCurrentPage((p) => Math.min(pageCount, p + 1))}
            disabled={currentPage >= pageCount}
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

function HighlightOverlay({
  highlight,
  pageDimensions
}: {
  highlight: ViewerHighlight;
  pageDimensions: { width: number; height: number };
}) {
  const left = highlight.x0 * pageDimensions.width;
  const top = highlight.y0 * pageDimensions.height;
  const width = (highlight.x1 - highlight.x0) * pageDimensions.width;
  const height = (highlight.y1 - highlight.y0) * pageDimensions.height;
  return (
    <div
      className="viewerHighlight"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`
      }}
    />
  );
}

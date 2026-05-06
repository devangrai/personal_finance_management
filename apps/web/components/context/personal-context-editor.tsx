"use client";

import { useEffect, useRef, useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

const MAX_LENGTH = 4000;

/**
 * A single freeform "tell the advisor about your life" text area.
 * Persists to UserFact with factKey="personal_context".
 *
 * Debounced autosave at 800ms. Pressing Save immediately flushes.
 */
export function PersonalContextEditor(props: { initial: string }) {
  const [text, setText] = useState(props.initial);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const lastSavedRef = useRef(props.initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(next: string) {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factKey: "personal_context",
          factValue: { text: next },
          source: "manual"
        })
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? `save failed (${res.status})`);
      }
      lastSavedRef.current = next;
      setState("saved");
      // Revert indicator after a moment so the UI doesn't shout "saved"
      // forever when the user stops editing.
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  function scheduleSave(next: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (next !== lastSavedRef.current) {
        void save(next);
      }
    }, 800);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dirty = text !== lastSavedRef.current;
  const remaining = MAX_LENGTH - text.length;

  return (
    <div className="personalContextEditor">
      <label className="srOnly" htmlFor="personal-context-textarea">
        Personal context
      </label>
      <textarea
        id="personal-context-textarea"
        className="personalContextTextarea"
        placeholder={
          "Tell the advisor about your life. For example: \n" +
          "• I live rent-free at home in the Bay Area.\n" +
          "• I might help my parents with my brother's med-school tuition.\n" +
          "• I want to max out my 401(k) every year.\n" +
          "\nFree-form text is fine."
        }
        value={text}
        maxLength={MAX_LENGTH}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          scheduleSave(next);
        }}
        rows={10}
      />
      <div className="personalContextFooter">
        <p className="personalContextHelp">
          The advisor reads this at the start of every conversation.
        </p>
        <div className="personalContextStatus">
          <span className="personalContextCount">{remaining} chars left</span>
          <span
            className={
              state === "error"
                ? "personalContextSaveIndicator err"
                : state === "saving"
                  ? "personalContextSaveIndicator saving"
                  : state === "saved"
                    ? "personalContextSaveIndicator saved"
                    : dirty
                      ? "personalContextSaveIndicator dirty"
                      : "personalContextSaveIndicator idle"
            }
          >
            {state === "saving"
              ? "Saving…"
              : state === "saved"
                ? "Saved"
                : state === "error"
                  ? error ?? "Save failed"
                  : dirty
                    ? "Unsaved"
                    : "Saved"}
          </span>
        </div>
      </div>
    </div>
  );
}

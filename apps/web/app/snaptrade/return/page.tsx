"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Landing page after the user completes the SnapTrade Connection Portal
 * flow. We kick off a sync to pull fresh data, then redirect back to
 * /overview. The user sees a brief "syncing…" status so the page doesn't
 * feel empty during the ~2-15 second sync.
 */
export default function SnapTradeReturnPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"syncing" | "done" | "error">("syncing");
  const [summary, setSummary] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch("/api/snaptrade/sync", { method: "POST" });
        const data = (await res.json()) as {
          ok?: boolean;
          connectionsSynced?: number;
          accountsSynced?: number;
          activitiesWritten?: number;
          holdingsWritten?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `sync failed (${res.status})`);
        }
        setSummary(
          `${data.connectionsSynced ?? 0} connection(s), ${data.accountsSynced ?? 0} account(s), ${data.activitiesWritten ?? 0} activities, ${data.holdingsWritten ?? 0} holdings`
        );
        setStatus("done");
        // Give the user a beat to read "done", then redirect.
        setTimeout(() => {
          if (!cancelled) router.replace("/overview");
        }, 1500);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setSummary(e instanceof Error ? e.message : "sync failed");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <section className="card snaptradeReturn">
      <p className="eyebrow">SnapTrade</p>
      {status === "syncing" ? (
        <>
          <h2>Connecting your brokerage…</h2>
          <p className="cardHelp">
            Pulling fresh holdings and activities. This usually takes under
            10 seconds.
          </p>
          <div className="snaptradeSpinner" aria-hidden />
        </>
      ) : status === "done" ? (
        <>
          <h2>Connected ✓</h2>
          <p className="cardHelp">
            {summary}. Redirecting to your overview…
          </p>
        </>
      ) : (
        <>
          <h2>Something went wrong</h2>
          <p className="cardHelp">{summary}</p>
          <p className="cardHelp">
            Try again from the <a href="/overview">Overview tab</a>.
          </p>
        </>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConnectAccountModal } from "./connect-account-modal";

function relativeTime(d: Date | string | null): string {
  if (!d) return "never synced";
  const t = new Date(d).getTime();
  const now = Date.now();
  const seconds = Math.floor((now - t) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(d: Date | string | null): boolean {
  if (!d) return true;
  return Date.now() - new Date(d).getTime() > 24 * 60 * 60 * 1000;
}

function formatCurrency(n: number, currency = "USD"): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  });
}

type Account = {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalance: string | null;
  isoCurrencyCode: string | null;
  institutionName: string | null;
  lastSyncedAt: string | null;
};

export function AccountsList(props: { accounts: Account[] }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Simple ordering: bank/credit first, investment last (investments are
  // synced less often and live further from daily check-ins).
  const ordered = [...props.accounts].sort((a, b) => {
    const typeOrder: Record<string, number> = {
      depository: 0,
      credit: 1,
      loan: 2,
      investment: 3,
      other: 99
    };
    return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
  });

  async function onSync() {
    setSyncing(true);
    setError(null);
    try {
      // Fire Plaid + SnapTrade syncs in parallel. Either can fail without
      // bringing down the other; we aggregate the error message.
      const [plaidRes, snapRes] = await Promise.all([
        fetch("/api/sync/all", { method: "POST" }).catch(() => null),
        fetch("/api/snaptrade/sync", { method: "POST" }).catch(() => null)
      ]);
      const errors: string[] = [];
      if (plaidRes && !plaidRes.ok) {
        const data = (await plaidRes.json().catch(() => ({}))) as {
          error?: string;
        };
        errors.push(`Plaid: ${data.error ?? plaidRes.status}`);
      } else if (!plaidRes) {
        errors.push("Plaid sync network error");
      }
      if (snapRes && !snapRes.ok) {
        // SnapTrade may be unconfigured — surface but don't mark as fatal.
        const data = (await snapRes.json().catch(() => ({}))) as {
          error?: string;
        };
        // Silently ignore "not configured" so users without SnapTrade
        // keys don't see noise every time.
        const msg = data.error ?? `${snapRes.status}`;
        if (!msg.toLowerCase().includes("not configured")) {
          errors.push(`SnapTrade: ${msg}`);
        }
      }
      if (errors.length > 0 && errors.length === 2) {
        throw new Error(errors.join(" · "));
      }
      setSyncedAt(Date.now());
      if (errors.length > 0) {
        setError(errors.join(" · "));
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="card">
      <div className="accountsHeader">
        <div>
          <p className="eyebrow">Accounts</p>
          <h2>Where your money is</h2>
        </div>
        <div className="accountsHeaderActions">
          {error ? <span className="errorLine">{error}</span> : null}
          {syncedAt ? (
            <span className="metaNote">Synced {relativeTime(new Date(syncedAt))}</span>
          ) : null}
          <button
            type="button"
            className="primaryButton"
            onClick={() => void onSync()}
            disabled={syncing}
          >
            {syncing ? "Syncing…" : "Sync all accounts"}
          </button>
        </div>
      </div>
      {ordered.length === 0 ? (
        <p className="emptyLine">
          No accounts linked yet. Connect your first bank below.
        </p>
      ) : (
        <ul className="accountsList">
          {ordered.map((a) => {
            const stale = isStale(a.lastSyncedAt);
            const balance = Number(a.currentBalance ?? 0);
            const displayBalance =
              a.type === "credit" || a.type === "loan"
                ? -Math.abs(balance)
                : balance;
            return (
              <li key={a.id} className="accountRow">
                <div className="accountRowLeft">
                  <span className="accountTypeChip">{a.subtype ?? a.type}</span>
                  <div>
                    <p className="accountName">{a.name}</p>
                    <p className="accountInstitution">
                      {a.institutionName ?? "—"}{" "}
                      {a.mask ? <span className="accountMask">· {a.mask}</span> : null}
                    </p>
                  </div>
                </div>
                <div className="accountRowRight">
                  <p
                    className={
                      displayBalance < 0
                        ? "accountBalance negative"
                        : "accountBalance"
                    }
                  >
                    {formatCurrency(displayBalance, a.isoCurrencyCode ?? "USD")}
                  </p>
                  <p className={stale ? "accountSync stale" : "accountSync"}>
                    {relativeTime(a.lastSyncedAt)}
                    {stale ? " (stale)" : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="accountsFooterActions">
        <button
          type="button"
          className="primaryButton"
          onClick={() => setModalOpen(true)}
        >
          + Connect an account
        </button>
      </div>
      <ConnectAccountModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </section>
  );
}

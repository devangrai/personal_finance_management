"use client";

import { useCallback, useEffect, useState } from "react";

type Invite = {
  id: string;
  code: string;
  intendedEmail: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  note: string | null;
  status: "active" | "used" | "expired";
};

type CreateResponse = {
  ok: boolean;
  code?: string;
  url?: string;
  expiresAt?: string;
  error?: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function InvitesPanel() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [ttlDays, setTtlDays] = useState(7);
  const [note, setNote] = useState("");
  const [minting, setMinting] = useState(false);

  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadInvites = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/invites", { cache: "no-store" });
      const body = (await res.json()) as {
        ok?: boolean;
        invites?: Invite[];
        error?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Failed to load invites.");
      }
      setInvites(body.invites ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  async function handleMint(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMinting(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim() || undefined,
          ttlDays,
          note: note.trim() || undefined
        })
      });
      const body = (await res.json()) as CreateResponse;
      if (!res.ok || !body.ok || !body.url) {
        throw new Error(body.error ?? "Failed to mint invite.");
      }
      setLastUrl(body.url);
      setEmail("");
      setNote("");
      await loadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mint invite.");
    } finally {
      setMinting(false);
    }
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API may be blocked — tell the user to select manually
      alert("Copy failed — select the URL manually.");
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invite? This can't be undone.")) return;
    try {
      const res = await fetch(`/api/admin/invites/${id}`, {
        method: "DELETE"
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Revoke failed.");
      }
      await loadInvites();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Revoke failed.");
    }
  }

  return (
    <div className="invitesPanel">
      <section className="panel">
        <h2>Mint an invite</h2>
        <p className="muted">
          Single-use code. Send the generated URL to the invitee via text,
          email, or any other channel. They click it, set a password,
          verify their email, and log in.
        </p>
        <form onSubmit={handleMint} className="invitesForm">
          <label className="authField">
            <span className="authLabel">
              Invitee email <em className="muted">(optional — leaves invite open if blank)</em>
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
              disabled={minting}
              className="authInput"
            />
          </label>
          <label className="authField">
            <span className="authLabel">
              Expires in (days) <em className="muted">(1–30)</em>
            </span>
            <input
              type="number"
              min={1}
              max={30}
              value={ttlDays}
              onChange={(e) => setTtlDays(Number(e.target.value))}
              disabled={minting}
              className="authInput"
              style={{ maxWidth: "8rem" }}
            />
          </label>
          <label className="authField">
            <span className="authLabel">
              Note <em className="muted">(optional, private)</em>
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For Jane — family finances"
              disabled={minting}
              className="authInput"
              maxLength={200}
            />
          </label>
          {error ? <p className="errorLine authError">{error}</p> : null}
          <div className="authActions">
            <button
              type="submit"
              className="primaryButton"
              disabled={minting}
            >
              {minting ? "Minting…" : "Mint invite"}
            </button>
          </div>
        </form>
        {lastUrl ? (
          <div className="mintedBanner">
            <p>
              <strong>Invite URL ready.</strong> Paste this into a message
              and send to your invitee:
            </p>
            <div className="urlRow">
              <code className="urlCode">{lastUrl}</code>
              <button
                type="button"
                className="secondaryButton"
                onClick={() => handleCopy(lastUrl)}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Recent invites</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !invites || invites.length === 0 ? (
          <p className="muted">No invites yet.</p>
        ) : (
          <table className="invitesTable">
            <thead>
              <tr>
                <th>Status</th>
                <th>Email</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className={`statusPill statusPill--${i.status}`}>
                      {i.status}
                    </span>
                  </td>
                  <td>{i.intendedEmail ?? <em className="muted">any</em>}</td>
                  <td>{formatDate(i.createdAt)}</td>
                  <td>{formatDate(i.expiresAt)}</td>
                  <td>{i.note ?? <em className="muted">—</em>}</td>
                  <td>
                    {i.status === "active" ? (
                      <button
                        type="button"
                        className="linkButton"
                        onClick={() => handleRevoke(i.id)}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

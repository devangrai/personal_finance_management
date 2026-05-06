"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ManagedAccount = {
  id: string;
  name: string;
  institutionName: string | null;
  balance: string | null; // pre-formatted display
  source: "plaid" | "snaptrade" | "manual";
  excludeFromNetWorth: boolean;
  // For disconnect: every account belongs to a "connection" that can be
  // removed. For Plaid this is the plaidItem. For SnapTrade, the
  // SnapTradeConnection. For manual CSV imports, we only expose
  // per-account delete (not implemented in this cut).
  connectionId: string | null;
  connectionLabel: string;
};

export type ManagedConnection = {
  id: string;
  label: string;
  institutionName: string;
  source: "plaid" | "snaptrade";
  accountCount: number;
  status: string;
  isDuplicate: boolean;
};

type Props = {
  accounts: ManagedAccount[];
  connections: ManagedConnection[];
};

/**
 * "Manage accounts" section on /overview. For every account: toggle
 * exclude-from-net-worth. For every connection: disconnect.
 *
 * Also surfaces a gentle warning when two connections exist for the
 * same institution (typical footgun after a re-link).
 */
export function ManageAccountsSection(props: Props) {
  const [open, setOpen] = useState(false);
  const duplicateCount = props.connections.filter((c) => c.isDuplicate).length;

  return (
    <section className="card">
      <button
        type="button"
        className="manageAccountsToggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          <p className="eyebrow">Connections</p>
          <h2 className="manageAccountsTitle">Manage accounts</h2>
        </span>
        <span className="manageAccountsMeta">
          {duplicateCount > 0 ? (
            <span className="manageAccountsWarning">
              ⚠ {duplicateCount} duplicate{duplicateCount > 1 ? "s" : ""}
            </span>
          ) : null}
          <span className="manageAccountsCaret" aria-hidden>
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>

      {open ? (
        <div className="manageAccountsBody">
          <ConnectionsList connections={props.connections} />
          <AccountsTable accounts={props.accounts} />
        </div>
      ) : null}
    </section>
  );
}

function ConnectionsList(props: { connections: ManagedConnection[] }) {
  if (props.connections.length === 0) {
    return (
      <p className="emptyLine">
        No connections. Add one via the Connect button above.
      </p>
    );
  }

  return (
    <div className="manageConnections">
      <h3 className="manageSubheading">Connections</h3>
      <ul className="manageConnectionsList">
        {props.connections.map((c) => (
          <ConnectionRow key={c.id} connection={c} />
        ))}
      </ul>
    </div>
  );
}

function ConnectionRow({ connection }: { connection: ManagedConnection }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    const label = connection.label;
    if (
      !window.confirm(
        `Disconnect ${label}? Historical transactions are kept; the connection stops syncing.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url =
        connection.source === "plaid"
          ? `/api/plaid/items/${connection.id}`
          : `/api/snaptrade/connections/${connection.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={
        connection.isDuplicate
          ? "manageConnectionRow manageConnectionRowDup"
          : "manageConnectionRow"
      }
    >
      <div className="manageConnectionLeft">
        <strong>{connection.label}</strong>
        <span className="manageConnectionMeta">
          {connection.source} · {connection.accountCount} account
          {connection.accountCount === 1 ? "" : "s"}
          {connection.status !== "active" ? ` · ${connection.status}` : null}
          {connection.isDuplicate ? " · ⚠ duplicate" : null}
        </span>
      </div>
      <div className="manageConnectionRight">
        {error ? <span className="errorLine">{error}</span> : null}
        <button
          type="button"
          className="linkButton manageDisconnectButton"
          onClick={() => void disconnect()}
          disabled={busy}
        >
          {busy ? "…" : "Disconnect"}
        </button>
      </div>
    </li>
  );
}

function AccountsTable(props: { accounts: ManagedAccount[] }) {
  if (props.accounts.length === 0) {
    return null;
  }
  return (
    <div className="manageAccountsTable">
      <h3 className="manageSubheading">Accounts</h3>
      <p className="cardHelp">
        Toggle off any account you don&apos;t want counted in net worth
        (unvested RSUs, shared accounts, etc.).
      </p>
      <ul className="manageAccountsList">
        {props.accounts.map((a) => (
          <AccountRow key={a.id} account={a} />
        ))}
      </ul>
    </div>
  );
}

function AccountRow({ account }: { account: ManagedAccount }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [excluded, setExcluded] = useState(account.excludeFromNetWorth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    const previous = excluded;
    setExcluded(next); // optimistic
    try {
      const url =
        account.source === "plaid"
          ? `/api/accounts/${account.id}`
          : `/api/investments/accounts/${account.id}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludeFromNetWorth: next })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setExcluded(previous); // rollback
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className={
        excluded ? "manageAccountRow manageAccountRowExcluded" : "manageAccountRow"
      }
    >
      <div className="manageAccountLeft">
        <strong>{account.name}</strong>
        <span className="manageAccountMeta">
          {account.institutionName ?? "—"}
          {account.balance ? ` · ${account.balance}` : null}
          <span className="manageAccountSource">{account.source}</span>
        </span>
      </div>
      <div className="manageAccountRight">
        {error ? <span className="errorLine">{error}</span> : null}
        <label className="manageAccountSwitchLabel">
          <input
            type="checkbox"
            className="manageAccountSwitch"
            checked={!excluded}
            disabled={busy}
            onChange={(e) => void toggle(!e.target.checked)}
          />
          <span>In net worth</span>
        </label>
      </div>
    </li>
  );
}

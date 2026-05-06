"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata
} from "react-plaid-link";
import {
  clearPlaidLinkSession,
  writePlaidLinkSession
} from "@/lib/plaid-link-session";

type Props = {
  label: string;
  productScope: "transactions" | "investments" | "default";
  className?: string;
};

/**
 * Minimal "Connect a bank" button. Starts a Plaid-Link session by calling
 * /api/plaid/link-token, then drives react-plaid-link's hook.
 *
 * Mirrors the subset of the legacy PlaidConnectionPanel's Link flow we
 * actually need on /overview. Keeps all the extracted state internal so
 * the parent just drops it in.
 */
export function PlaidLinkButton(props: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startLink() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "connect",
          productScope: props.productScope
        })
      });
      const body = (await res.json()) as {
        linkToken?: string;
        error?: string;
      };
      if (!res.ok || !body.linkToken) {
        throw new Error(body.error ?? "unable to create Plaid link token");
      }
      writePlaidLinkSession({
        linkToken: body.linkToken,
        mode: "connect",
        plaidItemId: null,
        productScope: props.productScope
      });
      setLinkToken(body.linkToken);
      setPendingOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start Plaid");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={props.className ?? "secondaryButton"}
        onClick={() => void startLink()}
        disabled={busy}
      >
        {busy ? "Preparing…" : props.label}
      </button>
      {error ? <span className="errorLine">{error}</span> : null}
      {linkToken ? (
        <PlaidLauncher
          token={linkToken}
          pendingOpen={pendingOpen}
          onOpened={() => {
            setPendingOpen(false);
          }}
          onDone={() => {
            setBusy(false);
            clearPlaidLinkSession();
            setLinkToken(null);
            startTransition(() => router.refresh());
          }}
          onError={(msg) => {
            setBusy(false);
            setError(msg);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * usePlaidLink requires that the hook be mounted — `open()` only fires
 * when `ready` is true, which happens after Plaid's script initializes
 * the token. We therefore gate mounting this inner component on having a
 * linkToken, and auto-open once ready.
 */
function PlaidLauncher(props: {
  token: string;
  pendingOpen: boolean;
  onOpened: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const { token, pendingOpen, onOpened, onDone, onError } = props;
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (
      publicToken: string,
      metadata: PlaidLinkOnSuccessMetadata
    ) => {
      try {
        const res = await fetch("/api/plaid/exchange-public-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institution: metadata.institution ?? null
          })
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "Plaid exchange failed");
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Plaid exchange failed");
        return;
      }
      onDone();
    },
    onExit: (err: PlaidLinkError | null, _metadata: PlaidLinkOnExitMetadata) => {
      if (err) {
        onError(err.display_message ?? err.error_message ?? "Plaid exit");
      } else {
        onDone();
      }
    }
  });

  useEffect(() => {
    if (ready && pendingOpen) {
      open();
      onOpened();
    }
  }, [ready, pendingOpen, open, onOpened]);

  return null;
}

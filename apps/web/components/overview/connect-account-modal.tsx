"use client";

import { useCallback, useEffect, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata,
  type PlaidLinkOnSuccessMetadata
} from "react-plaid-link";
import { useRouter } from "next/navigation";
import {
  clearPlaidLinkSession,
  writePlaidLinkSession
} from "@/lib/plaid-link-session";

type Props = {
  open: boolean;
  onClose: () => void;
};

type Phase =
  | "choose"
  | "starting-plaid-bank"
  | "starting-plaid-investments"
  | "starting-snaptrade"
  | "error";

/**
 * One-button connect flow. Shows three labeled options:
 *   - Bank (Plaid)      — checking/savings/credit
 *   - Brokerage (SnapTrade) — Fidelity, Schwab, Vanguard, etc.
 *   - CSV import       — links to the /admin page
 *
 * The labels are framed by what the user is trying to connect, with the
 * provider name as a byline — intentionally honest about which service
 * handles the flow.
 */
export function ConnectAccountModal(props: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState<string | null>(null);
  const [plaidLinkToken, setPlaidLinkToken] = useState<string | null>(null);
  const [plaidPendingOpen, setPlaidPendingOpen] = useState(false);

  useEffect(() => {
    if (!props.open) {
      // Reset when modal is dismissed so a future open is clean.
      setPhase("choose");
      setError(null);
      setPlaidLinkToken(null);
      setPlaidPendingOpen(false);
    }
  }, [props.open]);

  const startPlaidLink = useCallback(
    async (scope: "transactions" | "investments") => {
      setPhase(
        scope === "transactions"
          ? "starting-plaid-bank"
          : "starting-plaid-investments"
      );
      setError(null);
      try {
        const res = await fetch("/api/plaid/link-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "connect", productScope: scope })
        });
        const body = (await res.json()) as {
          linkToken?: string;
          error?: string;
        };
        if (!res.ok || !body.linkToken) {
          throw new Error(body.error ?? "Plaid Link token request failed");
        }
        writePlaidLinkSession({
          linkToken: body.linkToken,
          mode: "connect",
          plaidItemId: null,
          productScope: scope
        });
        setPlaidLinkToken(body.linkToken);
        setPlaidPendingOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Plaid Link failed");
        setPhase("error");
      }
    },
    []
  );

  const startSnapTrade = useCallback(async () => {
    setPhase("starting-snaptrade");
    setError(null);
    try {
      const res = await fetch("/api/snaptrade/connect-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const body = (await res.json()) as {
        redirectURI?: string;
        error?: string;
      };
      if (!res.ok || !body.redirectURI) {
        throw new Error(
          body.error ?? "SnapTrade connect URL request failed"
        );
      }
      // Hand off to SnapTrade Connection Portal. After the user finishes
      // the OAuth flow, they'll be redirected to /snaptrade/return which
      // triggers a sync and sends them back here.
      window.location.assign(body.redirectURI);
    } catch (e) {
      setError(e instanceof Error ? e.message : "SnapTrade failed");
      setPhase("error");
    }
  }, []);

  if (!props.open) return null;

  return (
    <div
      className="modalOverlay"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="modalPanel">
        <button
          type="button"
          className="modalClose"
          aria-label="Close"
          onClick={props.onClose}
        >
          ×
        </button>
        <p className="eyebrow">Add an account</p>
        <h2 className="modalTitle">What do you want to connect?</h2>

        {phase === "choose" ? (
          <div className="connectChoices">
            <button
              type="button"
              className="connectChoice"
              onClick={() => void startPlaidLink("transactions")}
            >
              <span className="connectChoiceTitle">Bank account</span>
              <span className="connectChoiceSubtitle">
                Checking, savings, credit cards
              </span>
              <span className="connectChoiceByline">via Plaid</span>
            </button>

            <button
              type="button"
              className="connectChoice connectChoiceFeatured"
              onClick={() => void startSnapTrade()}
            >
              <span className="connectChoiceTitle">Brokerage</span>
              <span className="connectChoiceSubtitle">
                Fidelity, Schwab, Vanguard, IRA, 401(k)
              </span>
              <span className="connectChoiceByline">
                via SnapTrade · OAuth
              </span>
            </button>

            <a href="/admin#manual-import" className="connectChoice">
              <span className="connectChoiceTitle">Import CSV</span>
              <span className="connectChoiceSubtitle">
                Upload a Fidelity holdings or transaction export
              </span>
              <span className="connectChoiceByline">manual</span>
            </a>
          </div>
        ) : phase === "starting-plaid-bank" ||
          phase === "starting-plaid-investments" ? (
          <>
            <h3 className="modalStatus">Preparing Plaid Link…</h3>
            <p className="modalHelp">
              This opens a popup from Plaid to connect your financial
              institution.
            </p>
            {plaidLinkToken ? (
              <PlaidOpener
                token={plaidLinkToken}
                pendingOpen={plaidPendingOpen}
                onOpened={() => setPlaidPendingOpen(false)}
                onDone={() => {
                  clearPlaidLinkSession();
                  props.onClose();
                  router.refresh();
                }}
                onError={(msg) => {
                  clearPlaidLinkSession();
                  setError(msg);
                  setPhase("error");
                }}
              />
            ) : null}
          </>
        ) : phase === "starting-snaptrade" ? (
          <>
            <h3 className="modalStatus">Handing you off to SnapTrade…</h3>
            <p className="modalHelp">
              You&apos;ll be redirected to select your brokerage and
              complete OAuth. After you finish, you&apos;ll come back here
              with your accounts synced.
            </p>
          </>
        ) : phase === "error" ? (
          <>
            <h3 className="modalStatus modalStatusError">
              Something went wrong
            </h3>
            <p className="modalHelp">{error ?? "Unknown error."}</p>
            <div className="modalActions">
              <button
                type="button"
                className="secondaryButton"
                onClick={() => setPhase("choose")}
              >
                Try again
              </button>
              <button
                type="button"
                className="linkButton"
                onClick={props.onClose}
              >
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PlaidOpener(props: {
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

"use client";

import { useEffect, useState } from "react";
import {
  type PlaidLinkError,
  type PlaidLinkOnExitMetadata,
  type PlaidLinkOnSuccessMetadata,
  usePlaidLink
} from "react-plaid-link";
import {
  clearPlaidLinkSession,
  readPlaidLinkSession
} from "@/lib/plaid-link-session";

export default function PlaidOauthReturnPage() {
  const [message, setMessage] = useState(
    "Resuming your bank connection with Plaid..."
  );
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [plaidItemId, setPlaidItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<"connect" | "update">("connect");
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(null);

  useEffect(() => {
    const session = readPlaidLinkSession();

    if (!session) {
      setMessage("The Plaid session could not be resumed. Return to the dashboard and try again.");
      return;
    }

    setLinkToken(session.linkToken);
    setPlaidItemId(session.plaidItemId);
    setMode(session.mode);
    setReceivedRedirectUri(window.location.href);
  }, []);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: async (
      publicToken: string,
      metadata: PlaidLinkOnSuccessMetadata
    ) => {
      setMessage(
        mode === "update"
          ? "Refreshing your linked institution..."
          : "Saving your linked institution..."
      );

      try {
        if (mode === "update" && plaidItemId) {
          const response = await fetch(`/api/plaid/items/${plaidItemId}/refresh`, {
            method: "POST"
          });
          const payload = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(
              payload.error ?? "Unable to refresh the linked institution."
            );
          }
        } else {
          const response = await fetch("/api/plaid/exchange-public-token", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              publicToken,
              institution: metadata.institution
            })
          });
          const payload = (await response.json()) as { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Unable to exchange public token.");
          }
        }

        clearPlaidLinkSession();
        window.location.assign("/");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to complete the Plaid OAuth flow."
        );
      }
    },
    onExit: (error: PlaidLinkError | null, _metadata: PlaidLinkOnExitMetadata) => {
      if (error) {
        setMessage(error.error_message ?? "Plaid Link exited with an error.");
      } else {
        setMessage("Plaid Link was closed before the OAuth flow completed.");
      }

      clearPlaidLinkSession();
    }
  });

  useEffect(() => {
    if (ready && linkToken && receivedRedirectUri) {
      open();
    }
  }, [linkToken, open, ready, receivedRedirectUri]);

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Plaid OAuth Return</p>
        <h1>Resume bank authentication</h1>
        <p className="lede">{message}</p>
      </section>
    </main>
  );
}

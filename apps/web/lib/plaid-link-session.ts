export type StoredPlaidLinkSession = {
  linkToken: string;
  mode: "connect" | "update";
  plaidItemId: string | null;
  productScope: "default" | "transactions" | "investments";
};

const plaidLinkSessionKey = "pfm.plaid.link-session";

export function readPlaidLinkSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(plaidLinkSessionKey);
  if (!value) {
    return null;
  }

  try {
    const session = JSON.parse(value) as Partial<StoredPlaidLinkSession>;
    if (!session.linkToken || !session.mode) {
      window.localStorage.removeItem(plaidLinkSessionKey);
      return null;
    }

    return {
      linkToken: session.linkToken,
      mode: session.mode,
      plaidItemId: session.plaidItemId ?? null,
      productScope: session.productScope ?? "default"
    };
  } catch {
    window.localStorage.removeItem(plaidLinkSessionKey);
    return null;
  }
}

export function writePlaidLinkSession(session: StoredPlaidLinkSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(plaidLinkSessionKey, JSON.stringify(session));
}

export function clearPlaidLinkSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(plaidLinkSessionKey);
}

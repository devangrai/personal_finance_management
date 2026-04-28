export type StoredPlaidLinkSession = {
  linkToken: string;
  mode: "connect" | "update";
  plaidItemId: string | null;
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
    return JSON.parse(value) as StoredPlaidLinkSession;
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

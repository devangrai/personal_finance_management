import crypto from "node:crypto";

/**
 * Signed one-shot action tokens for links embedded in email.
 *
 * The pattern: email contains `?token=<b64>` where the token is an
 * HMAC-signed JSON blob of {purpose, subject, meta, exp}. The server
 * verifies the HMAC and the expiry before acting.
 *
 * We don't encrypt — just sign. The payload is already public-safe
 * (transaction IDs) and the signature prevents tampering. Expiry is
 * 14 days, which comfortably covers email-reading latency without
 * making links permanently valid.
 */

const DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

export type ActionTokenPayload = {
  /** The kind of action this token authorizes. */
  purpose: "daily-review-action";
  /** The transaction ID the token applies to. */
  subject: string;
  /** Free-form qualifier (e.g. `"accept"`, `"flag-anomaly"`, a category key). */
  action: string;
  /** Issued-at timestamp (seconds since epoch). */
  iat: number;
  /** Expiry timestamp (seconds since epoch). */
  exp: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

/**
 * Sign an action token with our shared ENCRYPTION_KEY. Returned string
 * is URL-safe and can be pasted directly into a mailto link.
 */
export function signActionToken(params: {
  subject: string;
  action: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ActionTokenPayload = {
    purpose: "daily-review-action",
    subject: params.subject,
    action: params.action,
    iat: now,
    exp: now + (params.ttlSeconds ?? DEFAULT_TTL_SECONDS)
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", params.secret)
    .update(payloadB64)
    .digest();
  const sigB64 = b64url(sig);
  return `${payloadB64}.${sigB64}`;
}

export type VerifyResult =
  | { ok: true; payload: ActionTokenPayload }
  | { ok: false; reason: string };

/**
 * Verify an action token. Returns the parsed payload if valid, a reason
 * string if invalid. The caller is expected to additionally check that
 * `payload.subject` and `payload.action` match what the URL is asking
 * for — otherwise a token issued for one action could be replayed into
 * a different action endpoint.
 */
export function verifyActionToken(params: {
  token: string;
  secret: string;
  now?: number;
}): VerifyResult {
  const parts = params.token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed token" };
  }
  const [payloadB64, sigB64] = parts;

  const expected = crypto
    .createHmac("sha256", params.secret)
    .update(payloadB64)
    .digest();
  const provided = b64urlDecode(sigB64);
  // timingSafeEqual requires equal lengths — short-circuit if not.
  if (provided.length !== expected.length) {
    return { ok: false, reason: "signature mismatch" };
  }
  if (!crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }

  let payload: ActionTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as
      ActionTokenPayload;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }

  if (payload.purpose !== "daily-review-action") {
    return { ok: false, reason: "wrong token purpose" };
  }

  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, reason: "token expired" };
  }

  return { ok: true, payload };
}

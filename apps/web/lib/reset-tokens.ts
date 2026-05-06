import crypto from "node:crypto";

/**
 * Password-reset tokens. Same HMAC pattern as the email-action tokens
 * but scoped to purpose="pw-reset". TTL 1 hour.
 */

const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

type ResetPayload = {
  purpose: "pw-reset";
  subject: string; // userId
  email: string;
  iat: number;
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

export function signResetToken(params: {
  userId: string;
  email: string;
  secret: string;
  ttlSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: ResetPayload = {
    purpose: "pw-reset",
    subject: params.userId,
    email: params.email,
    iat: now,
    exp: now + (params.ttlSeconds ?? DEFAULT_TTL_SECONDS)
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", params.secret)
    .update(payloadB64)
    .digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: ResetPayload }
  | { ok: false; reason: string };

export function verifyResetToken(params: {
  token: string;
  secret: string;
  now?: number;
}): VerifyResult {
  const parts = params.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed token" };
  const [payloadB64, sigB64] = parts;

  const expected = crypto
    .createHmac("sha256", params.secret)
    .update(payloadB64)
    .digest();
  const provided = b64urlDecode(sigB64);
  if (provided.length !== expected.length) {
    return { ok: false, reason: "signature mismatch" };
  }
  if (!crypto.timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }

  let payload: ResetPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")) as ResetPayload;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }
  if (payload.purpose !== "pw-reset") {
    return { ok: false, reason: "wrong token purpose" };
  }
  const now = params.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, reason: "token expired" };
  }

  return { ok: true, payload };
}

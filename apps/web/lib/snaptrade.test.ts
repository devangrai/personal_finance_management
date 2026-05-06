import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./snaptrade";
import crypto from "node:crypto";

describe("verifyWebhookSignature", () => {
  const testBody = JSON.stringify({ eventType: "ACCOUNT_HOLDINGS_UPDATED" });

  it("rejects when signature header is missing", () => {
    // NOTE: this test relies on SNAPTRADE_WEBHOOK_SECRET or
    // SNAPTRADE_CONSUMER_KEY being set in the test env. If neither is,
    // we short-circuit and return false — which is still "reject", so
    // this assertion is meaningful either way.
    expect(verifyWebhookSignature(testBody, null)).toBe(false);
  });

  it("rejects when secret is not configured", () => {
    // Clear env vars so both fall through
    const saved = {
      secret: process.env.SNAPTRADE_WEBHOOK_SECRET,
      consumer: process.env.SNAPTRADE_CONSUMER_KEY
    };
    delete process.env.SNAPTRADE_WEBHOOK_SECRET;
    delete process.env.SNAPTRADE_CONSUMER_KEY;
    try {
      // Even a technically-valid HMAC can't verify because there's no
      // secret to verify against.
      expect(verifyWebhookSignature(testBody, "abc123")).toBe(false);
    } finally {
      if (saved.secret !== undefined)
        process.env.SNAPTRADE_WEBHOOK_SECRET = saved.secret;
      if (saved.consumer !== undefined)
        process.env.SNAPTRADE_CONSUMER_KEY = saved.consumer;
    }
  });

  it("accepts a correctly signed body", () => {
    // Use a known secret for this test
    const savedSecret = process.env.SNAPTRADE_WEBHOOK_SECRET;
    const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    const savedEncKey = process.env.ENCRYPTION_KEY;
    process.env.SNAPTRADE_WEBHOOK_SECRET = "unit-test-secret";
    // Also ensure other required env vars are present so getAppEnv() doesn't throw.
    process.env.NEXT_PUBLIC_APP_URL ??=
      "http://localhost:3001";
    process.env.ENCRYPTION_KEY ??= "0".repeat(64);
    // getAppEnv also requires PLAID_* — provide minimal stubs.
    process.env.PLAID_ENV ??= "sandbox";
    process.env.PLAID_CLIENT_ID ??= "test";
    process.env.PLAID_SECRET ??= "test";
    try {
      const expected = crypto
        .createHmac("sha256", "unit-test-secret")
        .update(testBody)
        .digest("hex");
      expect(verifyWebhookSignature(testBody, expected)).toBe(true);
      // A wrong signature should be rejected
      expect(
        verifyWebhookSignature(
          testBody,
          expected.replace(/^./, (c) => (c === "a" ? "b" : "a"))
        )
      ).toBe(false);
    } finally {
      if (savedSecret !== undefined) {
        process.env.SNAPTRADE_WEBHOOK_SECRET = savedSecret;
      } else {
        delete process.env.SNAPTRADE_WEBHOOK_SECRET;
      }
      if (savedAppUrl !== undefined) {
        process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
      }
      if (savedEncKey !== undefined) {
        process.env.ENCRYPTION_KEY = savedEncKey;
      }
    }
  });
});

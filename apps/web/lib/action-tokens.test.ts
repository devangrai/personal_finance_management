import { describe, expect, it } from "vitest";
import { signActionToken, verifyActionToken } from "./action-tokens";

const SECRET = "unit-test-secret-0".repeat(2); // 36 chars, plenty of entropy

describe("signActionToken / verifyActionToken", () => {
  it("round-trips a valid token", () => {
    const token = signActionToken({
      subject: "txn-abc-123",
      action: "accept",
      secret: SECRET
    });
    const result = verifyActionToken({ token, secret: SECRET });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.subject).toBe("txn-abc-123");
      expect(result.payload.action).toBe("accept");
    }
  });

  it("rejects a token signed with a different secret", () => {
    const token = signActionToken({
      subject: "txn-1",
      action: "accept",
      secret: SECRET
    });
    const r = verifyActionToken({ token, secret: "a different secret" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/);
  });

  it("rejects a tampered payload", () => {
    const token = signActionToken({
      subject: "txn-1",
      action: "accept",
      secret: SECRET
    });
    // Swap the payload to something else; signature is now invalid
    const sig = token.split(".")[1];
    const tampered = `eyJzdWJqZWN0IjoidHhuLTIifQ.${sig}`;
    const r = verifyActionToken({ token: tampered, secret: SECRET });
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed token shape", () => {
    expect(verifyActionToken({ token: "no-dot-here", secret: SECRET }).ok).toBe(
      false
    );
    expect(verifyActionToken({ token: "a.b.c", secret: SECRET }).ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = signActionToken({
      subject: "txn-1",
      action: "accept",
      secret: SECRET,
      ttlSeconds: 100 // 100s window
    });
    const now = Math.floor(Date.now() / 1000) + 200;
    const r = verifyActionToken({ token, secret: SECRET, now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it("preserves the action field for downstream matching", () => {
    const token = signActionToken({
      subject: "txn-1",
      action: "change:cat:groceries",
      secret: SECRET
    });
    const r = verifyActionToken({ token, secret: SECRET });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload.action).toBe("change:cat:groceries");
  });
});

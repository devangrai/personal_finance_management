import { describe, expect, it } from "vitest";
import { signResetToken, verifyResetToken } from "./reset-tokens";

const SECRET = "unit-test-secret-" + "x".repeat(20);

describe("password reset tokens", () => {
  it("round-trips a valid token", () => {
    const tok = signResetToken({
      userId: "user-abc",
      email: "a@b.com",
      secret: SECRET
    });
    const r = verifyResetToken({ token: tok, secret: SECRET });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.subject).toBe("user-abc");
      expect(r.payload.email).toBe("a@b.com");
    }
  });

  it("rejects a token signed with a different secret", () => {
    const tok = signResetToken({
      userId: "u",
      email: "a@b.com",
      secret: SECRET
    });
    const r = verifyResetToken({ token: tok, secret: "other secret" });
    expect(r.ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const tok = signResetToken({
      userId: "u",
      email: "a@b.com",
      secret: SECRET,
      ttlSeconds: 10
    });
    const later = Math.floor(Date.now() / 1000) + 100;
    const r = verifyResetToken({ token: tok, secret: SECRET, now: later });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it("rejects malformed shapes", () => {
    expect(verifyResetToken({ token: "garbage", secret: SECRET }).ok).toBe(
      false
    );
    expect(
      verifyResetToken({ token: "one.two.three", secret: SECRET }).ok
    ).toBe(false);
  });
});

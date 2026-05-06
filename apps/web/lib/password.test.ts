import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("hashes and verifies a valid password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(hash).toBeTruthy();
    expect(hash.length).toBeGreaterThan(20);
    expect(
      await verifyPassword("correct-horse-battery-staple", hash)
    ).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("throws on too-short password", async () => {
    await expect(hashPassword("short")).rejects.toThrow();
  });

  it("handles empty inputs gracefully on verify", async () => {
    expect(await verifyPassword("", "")).toBe(false);
    expect(await verifyPassword("anything", "")).toBe(false);
  });
});

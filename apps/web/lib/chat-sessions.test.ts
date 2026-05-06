import { describe, expect, it } from "vitest";
import { deriveTitleFromMessage } from "./chat-sessions";

describe("deriveTitleFromMessage", () => {
  it("returns 'New chat' for empty input", () => {
    expect(deriveTitleFromMessage("")).toBe("New chat");
    expect(deriveTitleFromMessage("    \n  ")).toBe("New chat");
  });

  it("returns the trimmed message for short inputs", () => {
    expect(deriveTitleFromMessage("  Am I on track?  ")).toBe("Am I on track?");
  });

  it("collapses internal whitespace/newlines", () => {
    expect(deriveTitleFromMessage("Line one\n\nline two")).toBe(
      "Line one line two"
    );
  });

  it("truncates at 40 chars with an ellipsis", () => {
    const long =
      "This is a pretty long question about retirement planning and my 401k";
    const out = deriveTitleFromMessage(long);
    expect(out.length).toBe(41); // 40 chars + ellipsis
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not truncate exactly 40-char input", () => {
    const msg40 = "1234567890123456789012345678901234567890"; // 40 chars
    expect(deriveTitleFromMessage(msg40)).toBe(msg40);
  });
});

import { describe, it, expect } from "vitest";
import { escapeMd, freezeInlineRefs } from "./reportExport";
import { solError } from "./errorValue";

describe("escapeMd", () => {
  it("escapes markdown-special characters", () => {
    expect(escapeMd("the *dev* build")).toBe("the \\*dev\\* build");
    expect(escapeMd("a_b_c")).toBe("a\\_b\\_c");
    expect(escapeMd("[link]")).toBe("\\[link\\]");
    expect(escapeMd("plain text")).toBe("plain text");
  });
});

describe("freezeInlineRefs", () => {
  it("substitutes a `=name` span with its current value, no live editor needed", () => {
    const out = freezeInlineRefs("n1", "Revenue was `=revenue` last quarter.", ["revenue"], () => 4200);
    expect(out).toBe("Revenue was 4200 last quarter.");
  });

  it("substitutes multiple distinct refs", () => {
    const values: Record<string, unknown> = { a: 1, b: "two" };
    const out = freezeInlineRefs("n1", "`=a` and `=b`.", ["a", "b"], (k) => values[k]);
    expect(out).toBe("1 and two.");
  });

  it("leaves a span untouched when its name isn't a known ref key", () => {
    const out = freezeInlineRefs("n1", "Run `=notAKey` here.", [], () => 0);
    expect(out).toBe("Run `=notAKey` here.");
  });

  it("escapes markdown-special characters IN the substituted value", () => {
    const out = freezeInlineRefs("n1", "Name: `=name`", ["name"], () => "under_score");
    expect(out).toBe("Name: under\\_score");
  });

  it("freezes an error value to its #CODE!", () => {
    const err = solError("#DIV/0!", "divide by zero");
    const out = freezeInlineRefs("n1", "`=x`", ["x"], () => err);
    expect(out).toBe("#DIV/0!");
  });

  it("freezes null to the em-dash placeholder", () => {
    const out = freezeInlineRefs("n1", "`=x`", ["x"], () => null);
    expect(out).toBe("—");
  });
});

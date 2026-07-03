import { describe, it, expect } from "vitest";
import { refPreview } from "./inlineRefDisplay";
import type { LambdaValue } from "../nodes/lambda";
import type { MermaidValue } from "../mermaidValue";

// The inline-ref preview (the short text form used in the ref-input row and as
// the KaTeX fallback) knows how to describe a wired lambda: signature + body.
describe("refPreview — lambda", () => {
  const mk = (params: string[], expr: string): LambdaValue => ({
    __lambda: true, params, expr, fn: () => 0,
  });

  it("shows the signature and body of a lambda with an expression", () => {
    expect(refPreview(mk(["x"], "a*x^2 + b*x + c"), undefined)).toBe("λ(x) = a*x^2 + b*x + c");
  });

  it("shows just the signature for a bare (bodyless) lambda", () => {
    expect(refPreview(mk(["acc", "x"], ""), undefined)).toBe("λ(acc, x)");
  });
});

describe("refPreview — mermaid", () => {
  const mk = (title?: string): MermaidValue => ({ __mermaid: true, source: "graph TD; A-->B", title });

  it("previews a wired diagram by its title", () => {
    expect(refPreview(mk("Pipeline"), undefined)).toBe("Pipeline");
  });

  it("falls back to 'diagram' when the figure has no title", () => {
    expect(refPreview(mk(), undefined)).toBe("diagram");
  });
});

// [[C17]] shareImpl, [[B27]] computeAnswersToExcel: the Regex card reads its pattern as the REGEX functions do, with
// Excel's case setting and the pattern's own inline flags.
import { describe, it, expect } from "vitest";
import { RegexNode, type RegexOp } from "../../src/graph/nodes/text";
import { isSolError } from "../../src/graph/errorValue";

const run = (op: RegexOp, text: unknown, pattern: string, opts: { replacement?: string; occurrence?: number; matchCase?: boolean } = {}) => {
  const n = new RegexNode({ op, matchCase: opts.matchCase });
  n.stringLiterals = { pattern, replacement: opts.replacement ?? "" };
  if (opts.occurrence !== undefined) n.literals.occurrence = opts.occurrence;
  return n.data({ text: [text] }).result;
};

describe("the Regex card", () => {
  it("matches case unless told not to, as case_sensitivity 0 and 1", () => {
    expect(run("test", "Hello", "hello")).toBe(0);
    expect(run("test", "Hello", "hello", { matchCase: false })).toBe(1);
    expect(run("test", "Hello", "(?i)hello")).toBe(1);
  });

  it("takes (?m) and (?s) inline", () => {
    expect(run("test", "a\nb", "^b$")).toBe(0);
    expect(run("test", "a\nb", "(?m)^b$")).toBe(1);
    expect(run("test", "a\nb", "a.b")).toBe(0);
    expect(run("test", "a\nb", "(?s)a.b")).toBe(1);
  });

  it("extracts and replaces as REGEXEXTRACT and REGEXREPLACE do", () => {
    expect(run("extract", "a1b22", "\\d+")).toBe("1");
    expect(run("extract_all", "a1b22", "\\d+")).toEqual(["1", "22"]);
    expect(run("extract_groups", "a1 b2", "(\\w)(\\d)")).toEqual(["a", "1"]);
    expect(run("replace", "AaA", "a", { replacement: "x", matchCase: false, occurrence: 2 })).toBe("AxA");
    expect(run("replace", "Ada Lovelace", "(\\w+) (?<last>\\w+)", { replacement: "${last}, $1" })).toBe("Lovelace, Ada");
  });

  it("answers #N/A for no match and #VALUE! for a pattern it can't read", () => {
    const none = run("extract", "abc", "x");
    expect(isSolError(none) && none.code).toBe("#N/A");
    const bad = run("test", "abc", "(");
    expect(isSolError(bad) && bad.code).toBe("#VALUE!");
  });
});

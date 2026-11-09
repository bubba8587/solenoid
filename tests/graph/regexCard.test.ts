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
    expect(run("test", "Hello", "hello")).toBe(false);
    expect(run("test", "Hello", "hello", { matchCase: false })).toBe(true);
    expect(run("test", "Hello", "(?i)hello")).toBe(true);
  });

  it("takes (?m) and (?s) inline", () => {
    expect(run("test", "a\nb", "^b$")).toBe(false);
    expect(run("test", "a\nb", "(?m)^b$")).toBe(true);
    expect(run("test", "a\nb", "a.b")).toBe(false);
    expect(run("test", "a\nb", "(?s)a.b")).toBe(true);
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

describe("the Regex card wired", () => {
  // A wired single text stays single: the Text socket takes one text or a list, never wrapping one into a list.
  it("answers one text for one text, and a list for a list", async () => {
    const { GraphEditor } = await import("../../src/graph/graphEditor");
    const { GraphConnection, GraphNode, GraphOutput, GraphSocket } = await import("../../src/graph/graphModel");
    const { DataflowEngine } = await import("../../src/graph/dataflowEngine");
    class Src extends GraphNode {
      constructor(public out: unknown) { super("src"); this.addOutput("out", new GraphOutput(new GraphSocket("string"))); }
      data() { return { out: this.out }; }
    }
    const through = async (text: unknown) => {
      const editor = new GraphEditor<never>();
      editor.use(new DataflowEngine<never>());
      const src = new Src(text), re = new RegexNode({ op: "replace" });
      re.stringLiterals = { pattern: "a", replacement: "x" };
      for (const n of [src, re]) await editor.addNode(n as never);
      await editor.addConnection(new GraphConnection(src, "out", re, "text") as never);
      await editor.engine!.pass(undefined, undefined, false);
      editor.dispose();
      return re.cachedResult;
    };
    expect(await through("banana")).toBe("bxnxnx");
    expect(await through(["ab", "ba"])).toEqual(["xb", "bx"]);
  });
});

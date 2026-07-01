import { describe, it, expect } from "vitest";
import { parseListLiteral, wrapNodeData } from "./coerceInputs";
import { SolenoidSocket } from "./sockets";

describe("parseListLiteral — typed 1-D list literals", () => {
  it("strlist: split on commas, trim, drop empties", () => {
    expect(parseListLiteral("name, qty ,", "strlist")).toEqual(["name", "qty"]);
  });
  it("strlist: a quoted field keeps its embedded comma (RFC 4180)", () => {
    expect(parseListLiteral('"First, Last", qty', "strlist")).toEqual(["First, Last", "qty"]);
    expect(parseListLiteral('"He said ""hi""", x', "strlist")).toEqual(['He said "hi"', "x"]);
  });
  it("datelist: each part → a date serial", () => {
    expect(parseListLiteral("2026-03-15", "datelist")).toEqual([46096]);
  });
  it("logicallist: each part → a boolean (TRUE/FALSE, 0/1)", () => {
    expect(parseListLiteral("true, 0, FALSE, 1", "logicallist")).toEqual([true, false, false, true]);
  });
});

describe("coerceInputs — typed-list literal injection", () => {
  function mockNode(literal: string | undefined) {
    let received: Record<string, unknown[]> | undefined;
    const node = {
      data: (inputs: Record<string, unknown[]>) => { received = inputs; return {}; },
      inputs: { cols: { socket: new SolenoidSocket("strlist") } },
      stringLiterals: literal === undefined ? {} : { cols: literal },
    };
    wrapNodeData(node as Parameters<typeof wrapNodeData>[0]);
    return { run: (inputs: Record<string, unknown[]>) => { node.data(inputs); return received ?? {}; } };
  }

  it("injects the parsed list for an UNWIRED strlist input", () => {
    expect(mockNode("a, b").run({}).cols).toEqual([["a", "b"]]);
  });
  it("a WIRED value wins over the literal", () => {
    expect(mockNode("a, b").run({ cols: [["x", "y", "z"]] }).cols).toEqual([["x", "y", "z"]]);
  });
  it("an empty wired array still falls back to the literal (like a scalar ??)", () => {
    expect(mockNode("a, b").run({ cols: [] }).cols).toEqual([["a", "b"]]);
  });
  it("no literal → the input stays absent (no field typed)", () => {
    expect(mockNode(undefined).run({}).cols).toBeUndefined();
  });
});

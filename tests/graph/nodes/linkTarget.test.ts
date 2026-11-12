// [[B1]] obsidianBet, [[obsidian-plugin#A note can opt in to read in Obsidian as its Note card does, chips included]]
import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../../src/graph/excelFormula";
import { TextTransformNode } from "../../../src/graph/nodes/text";
import { JoinNode } from "../../../src/graph/nodes/frame";
import { frameFromCells, type CubeValue, type FrameValue } from "../../../src/graph/frame";
import { isFrameRef, readFrame } from "../../../src/graph/frameBackend";

const ev = (src: string, vars: Record<string, unknown> = {}) => compileEvaluator(src)!(vars);

describe("LINKNAME and LINKPATH read the note a link names", () => {
  it("a wikilink, with or without a folder, a heading or an alias", () => {
    expect(ev('LINKNAME("[[Projects/Website launch|Launch]]")')).toBe("Website launch");
    expect(ev('LINKPATH("[[Projects/Website launch#Plan|Launch]]")')).toBe("Projects/Website launch");
    expect(ev('LINKNAME("[[Ada#Notes]]")')).toBe("Ada");
    expect(ev('LINKPATH("![[People/Ada]]")')).toBe("People/Ada");
  });
  it("a markdown link, its .md and %20 dropped", () => {
    expect(ev('LINKNAME("[the plan](Projects/Website%20launch.md)")')).toBe("Website launch");
    expect(ev('LINKPATH("[the plan](Projects/Website%20launch.md#Scope)")')).toBe("Projects/Website launch");
  });
  it("text that is no link stays as it is, a path included, and a blank stays blank", () => {
    expect(ev('LINKNAME("Website launch")')).toBe("Website launch");
    expect(ev('LINKNAME("Projects/Website launch")')).toBe("Projects/Website launch");
    expect(ev("LINKNAME(x)", { x: null })).toBeNull();
  });
  it("reads a list of links item by item, in a formula and on the card", () => {
    const links = ["[[Projects/A]]", "[[People/Ada|Ada L.]]", "plain"];
    expect(ev("LINKNAME(x)", { x: links })).toEqual(["A", "Ada", "plain"]);
    expect(new TextTransformNode({ op: "linkname" }).data({ text: [links] }).result).toEqual(["A", "Ada", "plain"]);
    expect(new TextTransformNode({ op: "linkpath" }).data({ text: [links] }).result).toEqual(["Projects/A", "People/Ada", "plain"]);
  });
});

describe("Join reads a Cube", () => {
  const left = frameFromCells(["project", "minutes"], [["A", "30"], ["B", "5"]]);
  const cube = (extra: CubeValue["columns"] = []): CubeValue => ({
    __cube: true, depth: 1,
    columns: [{ name: "name", cells: ["A", "B"], type: "string" }, { name: "budget", cells: [9000, 1200], type: "number" }, ...extra],
  });
  const join = (right: unknown) => new JoinNode({ how: "left" }).data({ left: [left], right: [right], leftKey: ["project"], rightKey: ["name"] }).frame;

  it("of plain columns as its rows", async () => {
    const answer = join(cube());
    const out = (isFrameRef(answer) ? await readFrame(answer) : answer) as FrameValue;
    expect(out.columns.map((c) => c.name)).toEqual(["project", "minutes", "budget"]);
    expect(out.columns[2].values).toEqual([9000, 1200]);
  });
  it("and carries its lists and tables along, each beside the row it came from", () => {
    const out = join(cube([{ name: "tags", cells: [["home"], ["work", "q4"]] }])) as CubeValue;
    expect(out.columns.map((c) => c.name)).toEqual(["project", "minutes", "budget", "tags"]);
    expect(out.columns[3].cells).toEqual([["home"], ["work", "q4"]]);
  });
  it("a row the join gave no partner is blank in the carried columns", () => {
    const right: CubeValue = { __cube: true, depth: 1, columns: [{ name: "name", cells: ["A"], type: "string" }, { name: "tags", cells: [["home"]] }] };
    const out = join(right) as CubeValue;
    expect(out.columns.map((c) => c.name)).toEqual(["project", "minutes", "tags"]);
    expect(out.columns[2].cells).toEqual([["home"], null]);
  });
});

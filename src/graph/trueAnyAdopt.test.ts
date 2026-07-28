import { describe, it, expect } from "vitest";
import { ClassicPreset } from "rete";
import { reconcileTrueAnyTypes, type AdoptEditor } from "./trueAnyAdopt";
import { extractInit } from "./copyPaste";
import { DisplayNode } from "./nodes/display";
import { IfNode, NaNode } from "./nodes/logic";
import { CableSwitchNode } from "./nodes/control";
import { ListIndexNode, ReverseNode, SortByNode, GroupByNode, SetOpNode, ConcatListsNode, InterleaveNode, TableReshapeNode, VStackNode, HStackTableNode, FrameInputNode, SortFrameNode, SelectColumnsNode } from "./rete-nodes";
import { numberSocket, stringSocket, frameSocket, dateListSocket, strListSocket, strTableSocket, SolenoidSocket, adoptTypeForBase, canConnect } from "./sockets";

// Same fake-editor surface as conduitTrace.test.ts — the pass only reads
// getNodes/getNode/getConnections and mutates sockets in place.
type Conn = { source: string; sourceOutput: string; target: string; targetInput: string };
function makeEditor(nodes: ClassicPreset.Node[], conns: Conn[]): AdoptEditor {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return {
    getNodes: () => nodes as never[],
    getNode: (id: string) => byId[id] as never,
    getConnections: () => conns,
  };
}

const dt = (sock: ClassicPreset.Socket | undefined) =>
  sock instanceof SolenoidSocket ? sock.dataType : undefined;

function numSource(): ClassicPreset.Node {
  const n = new ClassicPreset.Node("Num");
  n.addOutput("value", new ClassicPreset.Output(numberSocket));
  return n;
}
function strSource(): ClassicPreset.Node {
  const n = new ClassicPreset.Node("Text");
  n.addOutput("value", new ClassicPreset.Output(stringSocket));
  return n;
}

describe("trueany adoption — placeholder sockets take the wired cable's type (D17)", () => {
  it("a Display adopts on both sides and REVERTS on disconnect", () => {
    const src = numSource();
    const disp = new DisplayNode();
    const wire: Conn = { source: src.id, sourceOutput: "value", target: disp.id, targetInput: "in" };
    const ed = makeEditor([src, disp], [wire]);
    reconcileTrueAnyTypes(ed);
    expect(dt(disp.inputs.in?.socket)).toBe("number");
    expect(dt(disp.outputs.out?.socket)).toBe("number"); // passthrough adopts through
    // Disconnect → both revert to the hollow placeholder.
    reconcileTrueAnyTypes(makeEditor([src, disp], []));
    expect(dt(disp.inputs.in?.socket)).toBe("trueany");
    expect(dt(disp.outputs.out?.socket)).toBe("trueany");
  });

  it("adoption never PERSISTS: a save/paste init carries no adopted type (SOCK-5)", () => {
    // The save records a node's init fields (extractInit — persistence and paste
    // share it), never its sockets, so an adopted type must not appear there and
    // a reconstructed node must start hollow. This is the "never persists" half
    // of SOCK-5, previously unpinned: if Display ever grows a whitelisted field
    // holding the adopted type, this fails.
    const src = numSource();
    const disp = new DisplayNode();
    reconcileTrueAnyTypes(makeEditor([src, disp], [
      { source: src.id, sourceOutput: "value", target: disp.id, targetInput: "in" },
    ]));
    expect(dt(disp.inputs.in?.socket)).toBe("number"); // adopted live
    const init = extractInit(disp);
    expect(JSON.stringify(init)).not.toContain('"number"');
    const clone = new DisplayNode(init as ConstructorParameters<typeof DisplayNode>[0]);
    expect(dt(clone.inputs.in?.socket)).toBe("trueany");
    expect(dt(clone.outputs.out?.socket)).toBe("trueany");
  });

  it("adoption propagates down a passthrough CHAIN (Display → Display)", () => {
    const src = strSource();
    const d1 = new DisplayNode();
    const d2 = new DisplayNode();
    const ed = makeEditor([src, d1, d2], [
      { source: src.id, sourceOutput: "value", target: d1.id, targetInput: "in" },
      { source: d1.id, sourceOutput: "out", target: d2.id, targetInput: "in" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(d2.inputs.in?.socket)).toBe("string");
    expect(dt(d2.outputs.out?.socket)).toBe("string");
  });

  it("two Displays do NOT share adoption (per-instance sockets)", () => {
    const num = numSource();
    const str = strSource();
    const dNum = new DisplayNode();
    const dStr = new DisplayNode();
    const ed = makeEditor([num, str, dNum, dStr], [
      { source: num.id, sourceOutput: "value", target: dNum.id, targetInput: "in" },
      { source: str.id, sourceOutput: "value", target: dStr.id, targetInput: "in" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(dNum.inputs.in?.socket)).toBe("number");
    expect(dt(dStr.inputs.in?.socket)).toBe("string");
  });

  it("IF's result adopts when the wired branches AGREE, stays hollow when they disagree", () => {
    const num = numSource();
    const str = strSource();
    const agreeing = new IfNode();
    let ed = makeEditor([num, agreeing], [
      { source: num.id, sourceOutput: "value", target: agreeing.id, targetInput: "then" },
      { source: num.id, sourceOutput: "value", target: agreeing.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(agreeing.outputs.result?.socket)).toBe("number");

    const mixed = new IfNode();
    ed = makeEditor([num, str, mixed], [
      { source: num.id, sourceOutput: "value", target: mixed.id, targetInput: "then" },
      { source: str.id, sourceOutput: "value", target: mixed.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(mixed.inputs.then?.socket)).toBe("number"); // inputs adopt individually
    expect(dt(mixed.inputs.else?.socket)).toBe("string");
    expect(dt(mixed.outputs.result?.socket)).toBe("trueany"); // result genuinely runtime-dependent
  });

  it("a single wired IF branch is enough to adopt the result", () => {
    const num = numSource();
    const n = new IfNode();
    const ed = makeEditor([num, n], [
      { source: num.id, sourceOutput: "value", target: n.id, targetInput: "then" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(n.outputs.result?.socket)).toBe("number");
  });

  it("Input Switch (One mode) adopts the ACTIVE slot's type", () => {
    const num = numSource();
    const str = strSource();
    const sw = new CableSwitchNode();
    const [k0, k1] = Object.keys(sw.inputs);
    const conns: Conn[] = [
      { source: num.id, sourceOutput: "value", target: sw.id, targetInput: k0 },
      { source: str.id, sourceOutput: "value", target: sw.id, targetInput: k1 },
    ];
    sw.activeIndex = 0;
    reconcileTrueAnyTypes(makeEditor([num, str, sw], conns));
    expect(dt(sw.outputs.out?.socket)).toBe("number");
    sw.activeIndex = 1;
    reconcileTrueAnyTypes(makeEditor([num, str, sw], conns));
    expect(dt(sw.outputs.out?.socket)).toBe("string");
  });

  it("an element-preserving op (Reverse) FORWARDS its input's type through to its output", () => {
    const src = new ClassicPreset.Node("Dates");
    src.addOutput("out", new ClassicPreset.Output(dateListSocket));
    const rev = new ReverseNode();
    const ed = makeEditor([src, rev], [
      { source: src.id, sourceOutput: "out", target: rev.id, targetInput: "list" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(rev.inputs.list?.socket)).toBe("datelist");   // input adopts
    expect(dt(rev.outputs.result?.socket)).toBe("datelist"); // output forwards it (was neutral `anylist`)
    // Reverts to the neutral base when unwired (both dots gray again).
    reconcileTrueAnyTypes(makeEditor([src, rev], []));
    expect(dt(rev.outputs.result?.socket)).toBe("anylist");
  });

  it("INDEX: the Array input adopts, and an unknown frame's whole-row slice is a frame", () => {
    // A bare frame OUTPUT with no resolvable shape behind it (a CSV / Web Source):
    // with no Column named, the extraction is the whole row — still a frame.
    const src = new ClassicPreset.Node("Frame");
    src.addOutput("frame", new ClassicPreset.Output(frameSocket));
    const idx = new ListIndexNode();
    const ed = makeEditor([src, idx], [
      { source: src.id, sourceOutput: "frame", target: idx.id, targetInput: "list" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.inputs.list?.socket)).toBe("frame");
    expect(dt(idx.outputs.result?.socket)).toBe("frame");
    // Name a column and the shape is unknown, so the family is too.
    idx.literals.column = 2;
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("trueany");
  });

  // 2026-07-27: a frame's element family is per COLUMN, so INDEX resolves it from the
  // static shape walk instead of giving up at the `frame` socket. Without this a date
  // pulled out of a frame read as a raw serial downstream (isDateType reads the socket).
  it("INDEX over a FRAME adopts the named COLUMN's type, through a verb chain", () => {
    const src = new FrameInputNode({ frameText: JSON.stringify([
      { name: "Item", type: "string", cells: ["nut", "bolt"] },
      { name: "Due", type: "date", cells: ["2026-03-20", "2026-04-01"] },
      { name: "Qty", type: "number", cells: ["3", "4"] },
    ]) });
    const sort = new SortFrameNode(); // a row-only verb: shape passes straight through
    const idx = new ListIndexNode();
    const ed = makeEditor([src, sort, idx], [
      { source: src.id, sourceOutput: "frame", target: sort.id, targetInput: "frame" },
      { source: sort.id, sourceOutput: "frame", target: idx.id, targetInput: "list" },
    ]);

    idx.literals.column = 2; // the Due column
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("datecombo"); // one date, or the whole column

    idx.literals.column = 1;
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("strcombo");

    idx.literals.column = 3;
    idx.literals.index = 2; // a single CELL — same family, the combo covers both ranks
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("numlist");

    // Blank / 0 Column = the whole row: a one-row frame.
    delete idx.literals.column;
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("frame");
  });

  it("INDEX over a FRAME reads the column the VERB CHAIN produced, not the source", () => {
    const src = new FrameInputNode({ frameText: JSON.stringify([
      { name: "Item", type: "string", cells: ["nut"] },
      { name: "Due", type: "date", cells: ["2026-03-20"] },
    ]) });
    const sel = new SelectColumnsNode();
    (sel as unknown as { stringLiterals: Record<string, string> }).stringLiterals = { columns: "Due, Item" };
    const idx = new ListIndexNode();
    const ed = makeEditor([src, sel, idx], [
      { source: src.id, sourceOutput: "frame", target: sel.id, targetInput: "frame" },
      { source: sel.id, sourceOutput: "frame", target: idx.id, targetInput: "list" },
    ]);
    idx.literals.column = 1; // Select Columns reordered — column 1 is now Due
    reconcileTrueAnyTypes(ed);
    expect(dt(idx.outputs.result?.socket)).toBe("datecombo");
  });

  it("INDEX over a FRAME: a WIRED Column is a runtime value — back to the placeholder", () => {
    const src = new FrameInputNode({ frameText: JSON.stringify([
      { name: "Due", type: "date", cells: ["2026-03-20"] },
    ]) });
    const which = numSource();
    const idx = new ListIndexNode();
    idx.literals.column = 1;
    const wire = { source: src.id, sourceOutput: "frame", target: idx.id, targetInput: "list" };
    reconcileTrueAnyTypes(makeEditor([src, which, idx], [wire]));
    expect(dt(idx.outputs.result?.socket)).toBe("datecombo");
    // Wire the Column socket: data() takes the cable over the literal, so the stale
    // literal must stop deciding the type.
    reconcileTrueAnyTypes(makeEditor([src, which, idx], [
      wire, { source: which.id, sourceOutput: "value", target: idx.id, targetInput: "column" },
    ]));
    expect(dt(idx.outputs.result?.socket)).toBe("trueany");
  });

  // The 2026-07-19 sweep: every honest element-preserving list op adopts its
  // output (a String List through it never reads back as the neutral Any List —
  // the stale glyph the author caught on a collapsed group's edge socket).
  it("Sort By / Group Lists keys / Set / Concat / Interleave forward the element type", () => {
    const strList = () => {
      const n = new ClassicPreset.Node("Strs");
      n.addOutput("out", new ClassicPreset.Output(strListSocket));
      return n;
    };
    const s1 = strList(), s2 = strList();

    const sort = new SortByNode();
    reconcileTrueAnyTypes(makeEditor([s1, sort], [
      { source: s1.id, sourceOutput: "out", target: sort.id, targetInput: "array" },
    ]));
    expect(dt(sort.outputs.list?.socket)).toBe("strlist");

    const gb = new GroupByNode();
    reconcileTrueAnyTypes(makeEditor([s1, gb], [
      { source: s1.id, sourceOutput: "out", target: gb.id, targetInput: "keys" },
    ]));
    expect(dt(gb.outputs.keys?.socket)).toBe("strlist");
    expect(dt(gb.outputs.values?.socket)).toBe("list"); // aggregates stay numeric

    const set = new SetOpNode();
    reconcileTrueAnyTypes(makeEditor([s1, s2, set], [
      { source: s1.id, sourceOutput: "out", target: set.id, targetInput: "a" },
      { source: s2.id, sourceOutput: "out", target: set.id, targetInput: "b" },
    ]));
    expect(dt(set.outputs.result?.socket)).toBe("strlist");

    const cat = new ConcatListsNode();
    const catKeys = cat.valueInputKeys();
    reconcileTrueAnyTypes(makeEditor([s1, s2, cat], [
      { source: s1.id, sourceOutput: "out", target: cat.id, targetInput: catKeys[0] },
      { source: s2.id, sourceOutput: "out", target: cat.id, targetInput: catKeys[1] },
    ]));
    expect(dt(cat.outputs.result?.socket)).toBe("strlist");

    const il = new InterleaveNode();
    reconcileTrueAnyTypes(makeEditor([s1, s2, il], [
      { source: s1.id, sourceOutput: "out", target: il.id, targetInput: "a" },
      { source: s2.id, sourceOutput: "out", target: il.id, targetInput: "b" },
    ]));
    expect(dt(il.outputs.result?.socket)).toBe("strlist");
  });

  it("VSTACK / HSTACK adopt the agreed row type — a LIST row lifts to the table rank", () => {
    // The 2-D rung of the append ladder, mirroring Concat Lists above. A list wired to
    // an `anytable` row already adopts at the input's rank (strlist → strtable), so the
    // `agree` over the rows settles on strtable whichever rank the rows arrive at.
    const strs = new ClassicPreset.Node("Strs");
    strs.addOutput("out", new ClassicPreset.Output(strListSocket));
    const tbl = new ClassicPreset.Node("StrTable");
    tbl.addOutput("out", new ClassicPreset.Output(strTableSocket));

    for (const stack of [new VStackNode(), new HStackTableNode()]) {
      const [k0, k1] = stack.valueInputKeys();
      reconcileTrueAnyTypes(makeEditor([strs, tbl, stack], [
        { source: strs.id, sourceOutput: "out", target: stack.id, targetInput: k0 },
        { source: tbl.id,  sourceOutput: "out", target: stack.id, targetInput: k1 },
      ]));
      expect(dt(stack.outputs.result?.socket)).toBe("strtable");
      // A disagreeing row keeps the neutral rung — the selector rule, unchanged.
      const nums = new ClassicPreset.Node("Nums");
      nums.addOutput("out", new ClassicPreset.Output(dateListSocket));
      reconcileTrueAnyTypes(makeEditor([strs, nums, stack], [
        { source: strs.id, sourceOutput: "out", target: stack.id, targetInput: k0 },
        { source: nums.id, sourceOutput: "out", target: stack.id, targetInput: k1 },
      ]));
      expect(dt(stack.outputs.result?.socket)).toBe("anytable");
      // Unwired → reverts to the declared wildcard rank.
      reconcileTrueAnyTypes(makeEditor([stack], []));
      expect(dt(stack.outputs.result?.socket)).toBe("anytable");
    }
  });

  it("rank-CROSSING reshapes project the element family onto the output's rank", () => {
    const strs = new ClassicPreset.Node("Strs");
    strs.addOutput("out", new ClassicPreset.Output(strListSocket));
    const wrap = new TableReshapeNode({ op: "wraprows" });
    reconcileTrueAnyTypes(makeEditor([strs, wrap], [
      { source: strs.id, sourceOutput: "out", target: wrap.id, targetInput: "list" },
    ]));
    expect(dt(wrap.outputs.result?.socket)).toBe("strtable"); // strlist in → strtable out

    const tbl = new ClassicPreset.Node("StrTable");
    tbl.addOutput("out", new ClassicPreset.Output(strTableSocket));
    const flat = new TableReshapeNode({ op: "tocol" });
    const flatKey = Object.keys(flat.inputs)[0];
    reconcileTrueAnyTypes(makeEditor([tbl, flat], [
      { source: tbl.id, sourceOutput: "out", target: flat.id, targetInput: flatKey },
    ]));
    expect(dt(flat.outputs.result?.socket)).toBe("strlist"); // strtable in → strlist out
    // Unwired → both revert to their declared wildcard rank.
    reconcileTrueAnyTypes(makeEditor([tbl, flat], []));
    expect(dt(flat.outputs.result?.socket)).toBe("anylist");
  });
});

// ─── The agree VOTE distinguishes unwired / unknowable / error-only (2026-07-28) ──
// Three branch states, three dispositions: UNWIRED contributes no value (no vote);
// wired to a STATIC-trueany source (XLOOKUP, Get Cell) is a real value of unknowable
// type (VETO — a typed agreement would format it wrongly, the fa3565a bug); wired to
// NA() is always a tagged error, which formats as an error under any type (abstain).
describe("agree vote — unknowable vetoes, NA() abstains", () => {
  const trueAnySource = () => {
    const n = new ClassicPreset.Node("Lookupish");
    n.addOutput("value", new ClassicPreset.Output(new SolenoidSocket("trueany")));
    return n;
  };

  it("a wired static-trueany branch VETOES: IF(cond, XLOOKUP…, date) is unknown", () => {
    const unknowable = trueAnySource();
    const num = numSource();
    const iff = new IfNode();
    const ed = makeEditor([unknowable, num, iff], [
      { source: unknowable.id, sourceOutput: "value", target: iff.id, targetInput: "then" },
      { source: num.id, sourceOutput: "value", target: iff.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(iff.outputs.result?.socket)).toBe("trueany");
  });

  it("NA() abstains: IFERROR-style IF(cond, num, NA()) keeps the number type", () => {
    const na = new NaNode();
    const num = numSource();
    const iff = new IfNode();
    const ed = makeEditor([na, num, iff], [
      { source: num.id, sourceOutput: "value", target: iff.id, targetInput: "then" },
      { source: na.id, sourceOutput: "result", target: iff.id, targetInput: "else" },
    ]);
    reconcileTrueAnyTypes(ed);
    expect(dt(iff.outputs.result?.socket)).toBe("number");
  });
});

// ─── Rank-0/combo wildcard bases keep themselves on a family-less wire ────────
describe("any/anycombo bases — a family-less wire keeps the base (Bug C, completed)", () => {
  it("adoptTypeForBase(any, trueany) is any; (anycombo, trueany) is anycombo", () => {
    expect(adoptTypeForBase("any", "trueany")).toBe("any");
    expect(adoptTypeForBase("anycombo", "trueany")).toBe("anycombo");
    expect(adoptTypeForBase("anycombo", "anylist")).toBe("anycombo");
    // Family-typed wires still adopt verbatim.
    expect(adoptTypeForBase("any", "number")).toBe("number");
    expect(adoptTypeForBase("anycombo", "strlist")).toBe("strlist");
    // A trueany BASE still adopts anything verbatim.
    expect(adoptTypeForBase("trueany", "frame")).toBe("frame");
  });

  it("…so an occupied SWITCH row still refuses a frame", () => {
    expect(canConnect("frame", adoptTypeForBase("any", "trueany"))).toBe(false);
    expect(canConnect("lambda", adoptTypeForBase("any", "trueany"))).toBe(false);
  });
});

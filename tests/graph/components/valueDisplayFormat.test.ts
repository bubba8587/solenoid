import { describe, it, expect, afterEach } from "vitest";
import { ClassicPreset, NodeEditor } from "rete";
import { dateFormatDisplay, shouldRenderListInline, formatListCell, nodeOutputIsDate, nodeOutputElemFamily, formatRowValue } from "../../../src/graph/components/valueDisplayFormat";
import { ListInputNode, type ListElemType } from "../../../src/graph/nodes/list";
import { IfNode, NaNode, IFErrorNode } from "../../../src/graph/nodes/logic";
import { ExpectNode } from "../../../src/graph/nodes/quality";
import { dateSocket, numberSocket, SolenoidSocket, canConnect } from "../../../src/graph/sockets";
import { wrapNodeData } from "../../../src/graph/coerceInputs";
import { jsDateToSerial } from "../../../src/graph/nodes/date";
import { solError, isSolError } from "../../../src/graph/errorValue";
import { setEditorRefs, getEditor } from "../../../src/graph/process";
import type { Schemes } from "../../../src/graph/schemes";
import { ConduitNode, conduitInKey, conduitOutKey } from "../../../src/graph/nodes/conduit";
import { settleWildcardTypes } from "../../../src/graph/trueAnyAdopt";
import { DisplayNode } from "../../../src/graph/nodes/display";
import { dateOut } from "../../../src/graph/nodes/shared";

const ser = (y: number, m: number, d: number) => jsDateToSerial(new Date(Date.UTC(y, m - 1, d)));

// ValueDisplay calls dateFormatDisplay(value, dateLike, hasAnnotation) so any
// node whose OUTPUT socket is a date type shows formatted dates in its box —
// scalars AND lists — without each node wiring up its own formatter.

describe("dateFormatDisplay", () => {
  it("formats a scalar serial as a date string when the output is date-typed", () => {
    expect(dateFormatDisplay(ser(2026, 1, 3), true, false)).toBe("03-Jan-2026");
  });

  it("formats a list of serials, so the value renders as a chip of dates", () => {
    const out = dateFormatDisplay([ser(2026, 1, 3), ser(2026, 2, 4)], true, false);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(["03-Jan-2026", "04-Feb-2026"]);
  });

  it("shows the time when the serial carries a fraction (e.g. NOW())", () => {
    const noonNewYear = ser(2026, 1, 1) + 0.5;
    expect(dateFormatDisplay(noonNewYear, true, false)).toBe("01-Jan-2026 12:00");
  });

  it("is a no-op when the output is NOT a date type", () => {
    expect(dateFormatDisplay(45000, false, false)).toBe(45000);
    expect(dateFormatDisplay([45000, 45001], false, false)).toEqual([45000, 45001]);
  });

  it("defers to the Format Controller when one is docked (annotation present)", () => {
    expect(dateFormatDisplay(45000, true, true)).toBe(45000);
  });

  it("leaves non-numeric values (text, errors) untouched", () => {
    expect(dateFormatDisplay("hello", true, false)).toBe("hello");
    expect(dateFormatDisplay(["a", "b"], true, false)).toEqual(["a", "b"]);
    expect(dateFormatDisplay(null, true, false)).toBeNull();
  });

  it("keeps an error cell's #CODE! — it must never render as an empty cell", () => {
    // The list branch used to be gated on `typeof value[0] === "number"` and mapped
    // every non-finite to "", so a VALID leading date is what turned the #AMBIGUOUS!
    // after it into a blank: the cell that most needed to speak was the silent one.
    const out = dateFormatDisplay(
      [ser(2026, 1, 3), solError("#AMBIGUOUS!", "either way"), null], true, false,
    ) as unknown[];
    expect(out).toEqual(["03-Jan-2026", "#AMBIGUOUS!", ""]);
  });

  it("formats a date list whose FIRST cell is an error, not just one led by a number", () => {
    const out = dateFormatDisplay(
      [solError("#AMBIGUOUS!", "either way"), ser(2026, 1, 3)], true, false,
    ) as unknown[];
    expect(out).toEqual(["#AMBIGUOUS!", "03-Jan-2026"]);
  });

  it("end to end: a typed ambiguous date reaches the display as #AMBIGUOUS!", () => {
    // The whole chain the author reported: text typed into a date row -> parseDate ->
    // the node's list -> what the value box and popup grid render. Every link used to
    // drop the error somewhere different, so pin the chain, not just the last hop.
    const n = new ListInputNode({ dataType: "date" });
    const [a, b] = [n.addValueInput(), n.addValueInput()];
    n.stringLiterals[a] = "13-04-2026";  // day > 12, so it can only read one way
    n.stringLiterals[b] = "02-03-2026";  // could be 2 Mar or 3 Feb
    const list = n.data({}).list;
    expect(list.filter((v) => isSolError(v)).map((v) => (v as { code: string }).code))
      .toEqual(["#AMBIGUOUS!"]);
    const shown = dateFormatDisplay(list as never, true, false) as unknown[];
    expect(shown).toEqual(["13-Apr-2026", "#AMBIGUOUS!"]);
  });

  it("renders a non-finite serial in a list as blank, not NaN text", () => {
    expect(dateFormatDisplay([ser(2026, 1, 3), NaN], true, false)).toEqual(["03-Jan-2026", ""]);
  });
});

describe("shouldRenderListInline (chip vs joined text)", () => {
  // The Display node passes full = !collapsed; normal nodes never pass full.
  it("expanded Display shows the list inline (joined)", () => {
    expect(shouldRenderListInline(true, false)).toBe(true);
    expect(shouldRenderListInline(true, true)).toBe(true);
  });

  it("COLLAPSED Display always chips — even with an FC docked (the bug this fixes)", () => {
    expect(shouldRenderListInline(false, false)).toBe(false);
    expect(shouldRenderListInline(false, true)).toBe(false); // FC must not defeat collapse
  });

  it("a normal node chips a plain list but shows an annotated one inline", () => {
    expect(shouldRenderListInline(undefined, false)).toBe(false); // no FC → chip
    expect(shouldRenderListInline(undefined, true)).toBe(true);   // FC → inline (formatting visible)
  });
});

describe("formatListCell", () => {
  const fmt = (n: number) => n.toFixed(1);
  it("renders a missing cell literally as null", () => {
    expect(formatListCell(null, fmt)).toBe("null");
  });
  it("renders a per-cell error as its code", () => {
    expect(formatListCell(solError("#DIV/0!", "x"), fmt)).toBe("#DIV/0!");
  });
  it("passes text through and formats numbers via the scalar formatter", () => {
    expect(formatListCell("hi", fmt)).toBe("hi");
    expect(formatListCell(2, fmt)).toBe("2.0");
  });
  it("renders a logical as Excel-form TRUE/FALSE", () => {
    expect(formatListCell(true, fmt)).toBe("TRUE");
    expect(formatListCell(false, fmt)).toBe("FALSE");
  });
});

// Layer 1 — the type-default display: a date reads as a date wherever it flows,
// resolved through pass-throughs (Display) and Conduit lanes, not just at the
// node that produced it.
describe("nodeOutputIsDate — type resolves through pass-throughs / conduits", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  async function wire() {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const dateSrc = new ClassicPreset.Node("Date") as unknown as Schemes["Node"];
    dateSrc.addOutput("result", dateOut("Date"));
    const cond = new ConduitNode({}) as unknown as Schemes["Node"];
    const dispThroughConduit = new DisplayNode() as unknown as Schemes["Node"];
    const dispDirect = new DisplayNode() as unknown as Schemes["Node"];
    for (const n of [dateSrc, cond, dispThroughConduit, dispDirect]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(dateSrc, "result", cond, conduitInKey(0)) as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(cond, conduitOutKey(0), dispThroughConduit, "in") as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(dateSrc, "result", dispDirect, "in") as Schemes["Connection"]);
    settleWildcardTypes(getEditor()!); // lanes + adoptive sockets take `date`
    return { dateSrc, cond, dispThroughConduit, dispDirect };
  }

  it("a date reads as a date at the producer, through a Conduit, and at a direct Display", async () => {
    const { dateSrc, dispThroughConduit, dispDirect } = await wire();
    expect(nodeOutputIsDate(dateSrc.id)).toBe(true);          // the producer
    expect(nodeOutputIsDate(dispDirect.id)).toBe(true);        // a pass-through Display fed directly
    expect(nodeOutputIsDate(dispThroughConduit.id)).toBe(true); // a Display fed through a Conduit lane
  });

  it("a plain number does NOT read as a date", async () => {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const numSrc = new ClassicPreset.Node("Num") as unknown as Schemes["Node"];
    numSrc.addOutput("result", new ClassicPreset.Output(new (await import("../../../src/graph/sockets")).SolenoidSocket("number")));
    const disp = new DisplayNode() as unknown as Schemes["Node"];
    for (const n of [numSrc, disp]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(numSrc, "result", disp, "in") as Schemes["Connection"]);
    expect(nodeOutputIsDate(disp.id)).toBe(false);
  });
});

// ─── The element family comes from the SOCKET, not the cells ─────────────────
// A List Input's SegToggle forces the list's type; the value box must agree no
// matter what the entries are. Scanning cells can't deliver that: every entry
// unparseable leaves a list of nulls with nothing to vote, so a Bool list tinted
// and opened as NUMERIC. `nodeOutputElemFamily` reads the declared socket instead
// (the same walk `nodeOutputIsDate` uses — that is now just this === "date").
describe("nodeOutputElemFamily — the declared family, whatever the cells say", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  async function listInputOf(dt: ListElemType) {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const n = new ListInputNode({ dataType: dt }) as unknown as Schemes["Node"];
    await editor.addNode(n);
    return n;
  }

  it("reports each List Input type from its output socket", async () => {
    for (const [dt, fam] of [["logical", "logical"], ["string", "string"], ["date", "date"], ["number", "number"]] as const) {
      const n = await listInputOf(dt);
      expect(nodeOutputElemFamily(n.id)).toBe(fam);
    }
  });

  it("still reports `logical` when EVERY entry was unparseable (the reported bug)", async () => {
    const n = await listInputOf("logical");
    // The data really is all-null — nothing here could vote for a family.
    const node = n as unknown as ListInputNode;
    node.stringLiterals.v0 = "xyz, pqr";
    wrapNodeData(node as never);
    expect((node.data({}) as { list: unknown[] }).list).toEqual([null, null]);
    // The socket is unmoved, so the box stays a Bool list.
    expect(nodeOutputElemFamily(n.id)).toBe("logical");
  });

  it("nodeOutputIsDate stays consistent with it", async () => {
    expect(nodeOutputIsDate((await listInputOf("date")).id)).toBe(true);
    expect(nodeOutputIsDate((await listInputOf("logical")).id)).toBe(false);
  });

  it("is undefined for an unknown node, so the chip's cell scan stays the fallback", () => {
    expect(nodeOutputElemFamily(null)).toBeUndefined();
    expect(nodeOutputElemFamily("nope")).toBeUndefined();
  });
});

// ─── The display walk applies the SAME rule as socket adoption ────────────────
// `displayedType` used to hand-roll its own resolution: a loop over every incoming
// connection returning the FIRST non-wildcard type it met. That ignored `combine`
// and didn't tell a VALUE branch from a side input, so it could answer where the
// adoption pass had deliberately declined to. Both now run
// resolvePassthroughType + agreeTypes, so display can never contradict the socket.
describe("displayedType — one rule with socket adoption (no first-branch guessing)", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  async function ifOver(thenSock: SolenoidSocket, elseSock: SolenoidSocket) {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const a = new ClassicPreset.Node("A") as unknown as Schemes["Node"];
    a.addOutput("v", new ClassicPreset.Output(thenSock));
    const b = new ClassicPreset.Node("B") as unknown as Schemes["Node"];
    b.addOutput("v", new ClassicPreset.Output(elseSock));
    const iff = new IfNode() as unknown as Schemes["Node"];
    const disp = new DisplayNode() as unknown as Schemes["Node"];
    for (const n of [a, b, iff, disp]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(a, "v", iff, "then") as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(b, "v", iff, "else") as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(iff, "result", disp, "in") as Schemes["Connection"]);
    // Production runs this on every connection change (reconcileFcTypes → here), and
    // it is what WRITES the resolved type onto each adoptive socket. A display test
    // that skips it isn't testing what ships — the same smell as a node test that
    // skips wrapNodeData (List Input audit, 2026-07-25c).
    settleWildcardTypes(editor);
    return { iff, disp };
  }

  it("DISAGREEING branches are unknown — a number no longer renders as a date", async () => {
    // The bug: `then` is a date and `else` a number, so the socket stays `trueany`;
    // the old first-connection walk answered "date" and dateFormatDisplay turned the
    // else-branch's 46000 into "20-Mar-2026".
    const { iff, disp } = await ifOver(dateSocket, numberSocket);
    expect(nodeOutputIsDate(iff.id)).toBe(false);
    expect(nodeOutputIsDate(disp.id)).toBe(false); // and it doesn't leak downstream
    expect(dateFormatDisplay(46000, nodeOutputIsDate(iff.id), false)).toBe(46000);
  });

  it("AGREEING branches still resolve, through the selector and past it", async () => {
    const { iff, disp } = await ifOver(dateSocket, dateSocket);
    expect(nodeOutputIsDate(iff.id)).toBe(true);
    expect(nodeOutputIsDate(disp.id)).toBe(true);
  });

  it("an UNWIRED branch doesn't vote against the wired one", async () => {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const a = new ClassicPreset.Node("A") as unknown as Schemes["Node"];
    a.addOutput("v", new ClassicPreset.Output(dateSocket));
    const iff = new IfNode() as unknown as Schemes["Node"];
    for (const n of [a, iff]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(a, "v", iff, "then") as Schemes["Connection"]);
    settleWildcardTypes(editor);
    expect(nodeOutputIsDate(iff.id)).toBe(true);
  });

  it("a SIDE input can't supply the display type (only the spec's value branches)", async () => {
    // Expect forwards `in` only; its min/max/pattern are checks. The old loop scanned
    // every incoming connection, so a wired `min` could decide the display type.
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const dsrc = new ClassicPreset.Node("D") as unknown as Schemes["Node"];
    dsrc.addOutput("v", new ClassicPreset.Output(dateSocket));
    const exp = new ExpectNode() as unknown as Schemes["Node"];
    for (const n of [dsrc, exp]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(dsrc, "v", exp, "min") as Schemes["Connection"]);
    settleWildcardTypes(editor);
    expect(nodeOutputIsDate(exp.id)).toBe(false); // `in` is unwired — nothing to display
  });
});

// ─── A type-NEUTRAL source must not vote in a selector's `agree` ──────────────
// The motivating case for "what should a disagreeing selector display?" turned out
// not to be about selectors at all. `IFERROR(aDate, NA())` lost its date formatting
// because NA() declared a `number` OUTPUT while emitting a tagged #N/A SolError — so
// the branches were date + number, they disagreed, and the result resolved to unknown.
// NA is type-neutral (`trueany`), which `agreeTypes` correctly ignores as non-voting.
describe("NA() is type-neutral, so it doesn't out-vote a typed branch", () => {
  afterEach(() => setEditorRefs(null as never, null as never, null as never));

  it("IFERROR(date, NA()) still reads as a date", async () => {
    const editor = new NodeEditor<Schemes>();
    setEditorRefs(editor, null as never, null as never);
    const dsrc = new ClassicPreset.Node("D") as unknown as Schemes["Node"];
    dsrc.addOutput("v", new ClassicPreset.Output(dateSocket));
    const na = new NaNode() as unknown as Schemes["Node"];
    const ife = new IFErrorNode() as unknown as Schemes["Node"];
    for (const n of [dsrc, na, ife]) await editor.addNode(n);
    await editor.addConnection(new ClassicPreset.Connection(dsrc, "v", ife, "value") as Schemes["Connection"]);
    await editor.addConnection(new ClassicPreset.Connection(na, "result", ife, "fallback") as Schemes["Connection"]);
    settleWildcardTypes(editor);
    expect(nodeOutputIsDate(ife.id)).toBe(true);
  });

  it("and #N/A connects anywhere, because an error is legal in any cell", () => {
    const out = (new NaNode().outputs.result!.socket as SolenoidSocket).dataType;
    expect(out).toBe("trueany");
    for (const t of ["number", "string", "date", "strlist", "frame", "cube"] as const) {
      expect(canConnect(out, t)).toBe(true);
    }
  });
});

// InlineOutputRows resolves an FC annotation per SOCKET and formats through
// these helpers — the backlog bug was multi-row cards (Equation, Quadratic
// Roots, Regression) ignoring a docked FC entirely.
describe("formatRowValue — annotated inline-output rows", () => {
  const ann2dp = { format: "decimal", unit: "none", decimalDigits: 2, decimalMode: "places" } as never;

  it("unannotated cells keep the plain forms", () => {
    expect(formatRowValue(1.5)).toBe("1.5000");
    expect(formatRowValue(null)).toBe("—");
    expect(formatRowValue(true)).toBe("TRUE");
    expect(formatRowValue("abc")).toBe("abc");
  });

  it("a numeric annotation reaches every cell, including list heads", () => {
    expect(formatRowValue(1.5, ann2dp)).toBe("1.50");
    expect(formatRowValue([1, 2.25, 3, 4], ann2dp)).toBe("1.00, 2.25, 3.00, …");
  });

  it("errors and null stay untouched under an annotation", () => {
    expect(formatRowValue(solError("#DIV/0!", "x"), ann2dp)).toBe("#DIV/0!");
    expect(formatRowValue(null, ann2dp)).toBe("—");
  });

  it("logical style and text case apply", () => {
    expect(formatRowValue(true, { logicalStyle: "yesno" } as never)).toBe("Yes");
    expect(formatRowValue("abc", { textCase: "upper" } as never)).toBe("ABC");
  });
});

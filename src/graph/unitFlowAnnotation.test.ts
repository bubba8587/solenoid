import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { makeAnnotationResolver, resolveValueOrigin } from "./unitFlow";
import { applyFcUnit } from "./unitBridge";
import { isUnitCell, magnitudeOf, dimOf, fromUnit, matrixUnitOf, type UnitCell } from "./unitValue";
import { UNITS } from "./dimension";
import { isSolError } from "./errorValue";
import type { FormatAnnotation } from "./formatAnnotationStore";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
const sock = new (class extends ClassicPreset.Socket {})("any");
const usd: FormatAnnotation = {
  format: "decimal", customPattern: "0.00", decimalDigits: 2, decimalMode: "places",
  unit: "usd", customUnit: "", textCase: "none", bold: false, italic: false, textScale: 14,
};
const eur: FormatAnnotation = { ...usd, unit: "eur" };
const km: FormatAnnotation = { ...usd, unit: "km" };
const mi: FormatAnnotation = { ...usd, unit: "mi" };

function node(label: string, extra: Record<string, unknown> = {}) {
  const n = new ClassicPreset.Node(label) as ClassicPreset.Node & Record<string, unknown>;
  n.addInput("in", new ClassicPreset.Input(sock, "In"));
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  Object.assign(n, extra);
  // A pure-passthrough mock (Display) now declares it via passthrough() — the ONE
  // source unitFlow reads (see passthrough.ts). Translate the old test flag.
  if (extra.passesUnitThrough) {
    delete n.passesUnitThrough;
    n.passthrough = () => [{ output: "out", inputs: ["in"], combine: "single", pure: true }];
  }
  return n;
}
/** An FC-like source publishing a fixed unit + annotation on its output. */
function fcSource(label: string, unit: string, ann?: FormatAnnotation) {
  const n = new ClassicPreset.Node(label) as ClassicPreset.Node & Record<string, unknown>;
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  n.unit = unit; n.format = "decimal";
  if (ann) n.annotation = () => ann;
  return n;
}
/** A selector (IF-like) with cond/then/else inputs; only then/else are value branches.
 *  `selected` mimics the node's computed branch ("then"/"else"); null = indeterminate
 *  (a list condition), so the resolver falls back to combining the branches. */
function ifNode(label: string, selected: string | null | undefined) {
  const n = new ClassicPreset.Node(label) as ClassicPreset.Node & Record<string, unknown>;
  for (const k of ["cond", "then", "else"]) n.addInput(k, new ClassicPreset.Input(sock, k));
  n.addOutput("out", new ClassicPreset.Output(sock, "Out"));
  // A selector: `agree` over the value branches, following `selected` when it tracks a
  // branch. `selected === undefined` = no branch tracking at all (spec omits `selected`).
  n.passthrough = () => [{
    output: "out", inputs: ["then", "else"], combine: "agree" as const,
    ...(selected !== undefined ? { selected: () => selected } : {}),
  }];
  return n;
}
const connect = async (e: AnyEditor, s: ClassicPreset.Node, t: ClassicPreset.Node, tIn = "in") =>
  e.addConnection(new ClassicPreset.Connection(s as never, "out", t as never, tIn) as never);

describe("makeAnnotationResolver — FC locks a format that rides through passthroughs", () => {
  it("a downstream Display resolves the upstream FC's annotation (no trailing FC)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const fc = node("FC", { annotation: () => usd });           // FC locks usd
    const disp = node("Display", { passesUnitThrough: true });  // passthrough
    for (const n of [fc, disp]) await editor.addNode(n as never);
    await connect(editor, fc, disp);
    const r = makeAnnotationResolver(editor);
    expect(r.inAnnotation(disp.id, "in")?.unit).toBe("usd");
  });

  it("the lock survives a chain of passthroughs but BREAKS at a transform", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const fc = node("FC", { annotation: () => usd });
    const d1 = node("Display1", { passesUnitThrough: true });
    const xform = node("Add");                 // not FC, not passthrough → transform
    const d2 = node("Display2", { passesUnitThrough: true });
    for (const n of [fc, d1, xform, d2]) await editor.addNode(n as never);
    await connect(editor, fc, d1);     // fc → d1 (locked)
    await connect(editor, d1, xform);  // d1 → transform
    await connect(editor, xform, d2);  // transform → d2 (unlocked)
    const r = makeAnnotationResolver(editor);
    expect(r.inAnnotation(d1.id, "in")?.unit).toBe("usd"); // carried across the passthrough
    expect(r.inAnnotation(d2.id, "in")).toBeUndefined();   // dropped at the transform
  });

  it("the lock crosses a Conduit lane (in_i → out_i), each lane independent", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const fcA = node("FC$", { annotation: () => usd });
    const fcB = node("FC€", { annotation: () => eur });
    // Conduit mock: paired in_i/out_i lanes + the cachedLane array the resolver's
    // conduit-lane branch ducks on (the real ConduitNode has no passthrough()).
    const cd = new ClassicPreset.Node("Conduit") as ClassicPreset.Node & Record<string, unknown>;
    for (let i = 0; i < 2; i++) {
      cd.addInput(`in_${i}`, new ClassicPreset.Input(sock, `in_${i}`));
      cd.addOutput(`out_${i}`, new ClassicPreset.Output(sock, `out_${i}`));
    }
    cd.cachedLane = [null, null];
    const dA = node("DispA", { passesUnitThrough: true });
    const dB = node("DispB", { passesUnitThrough: true });
    for (const n of [fcA, fcB, cd, dA, dB]) await editor.addNode(n as never);
    await editor.addConnection(new ClassicPreset.Connection(fcA as never, "out", cd as never, "in_0") as never);
    await editor.addConnection(new ClassicPreset.Connection(fcB as never, "out", cd as never, "in_1") as never);
    await editor.addConnection(new ClassicPreset.Connection(cd as never, "out_0", dA as never, "in") as never);
    await editor.addConnection(new ClassicPreset.Connection(cd as never, "out_1", dB as never, "in") as never);
    const r = makeAnnotationResolver(editor);
    expect(r.inAnnotation(dA.id, "in")?.unit).toBe("usd");
    expect(r.inAnnotation(dB.id, "in")?.unit).toBe("eur");
  });
});

describe("downstreamAnnotation — an FC's lock reaches Displays AHEAD of it (upstream segment)", () => {
  it("a Display two hops ABOVE the FC carries the lock (Number→Disp1→Disp2→FC)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const num = node("Number");                              // source (not passthrough)
    const d1 = node("Disp1", { passesUnitThrough: true });
    const d2 = node("Disp2", { passesUnitThrough: true });
    const fc = node("FC", { annotation: () => usd });        // FC at the end of the chain
    for (const n of [num, d1, d2, fc]) await editor.addNode(n as never);
    await connect(editor, num, d1);
    await connect(editor, d1, d2);
    await connect(editor, d2, fc);
    const r = makeAnnotationResolver(editor);
    expect(r.downstreamAnnotation(d2.id, "out")?.unit).toBe("usd"); // immediate box behind
    expect(r.downstreamAnnotation(d1.id, "out")?.unit).toBe("usd"); // TWO hops above — the fix
  });

  it("the lock STOPS at a transform between the Display and the FC", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const d1 = node("Disp1", { passesUnitThrough: true });
    const xform = node("Add");                               // transform — segment boundary
    const fc = node("FC", { annotation: () => usd });
    for (const n of [d1, xform, fc]) await editor.addNode(n as never);
    await connect(editor, d1, xform);
    await connect(editor, xform, fc);
    const r = makeAnnotationResolver(editor);
    expect(r.downstreamAnnotation(d1.id, "out")).toBeUndefined(); // value changes at the transform
  });

  it("no FC downstream → no annotation", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const d1 = node("Disp1", { passesUnitThrough: true });
    const d2 = node("Disp2", { passesUnitThrough: true });
    for (const n of [d1, d2]) await editor.addNode(n as never);
    await connect(editor, d1, d2);
    expect(makeAnnotationResolver(editor).downstreamAnnotation(d1.id, "out")).toBeUndefined();
  });
});

describe("input-aware passthrough — IF/CHOOSE/SWITCH/IFS pass the value branch's annotation", () => {
  it("IF passes the annotation from then/else, ignoring the condition", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = fcSource("A", "usd", usd);   // $ value
    const b = fcSource("B", "usd", usd);   // $ value
    const condFc = fcSource("CondFc", "km", km); // a unit on the condition (shouldn't matter)
    const iff = ifNode("IF", "then");
    for (const n of [a, b, condFc, iff]) await editor.addNode(n as never);
    await connect(editor, condFc, iff, "cond");
    await connect(editor, a, iff, "then");
    await connect(editor, b, iff, "else");
    const ann = makeAnnotationResolver(editor);
    expect(ann.outAnnotation(iff.id, "out")?.unit).toBe("usd"); // both branches $ → $
  });

  it("DATA-AWARE: IF(c, km, mi) follows the actually-selected branch", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const kmS = fcSource("KM", "km", km);
    const miS = fcSource("MI", "mi", mi);
    const iffTrue = ifNode("IFtrue", "then");   // condition computed true → km
    const iffFalse = ifNode("IFfalse", "else"); // condition computed false → mi
    for (const n of [kmS, miS, iffTrue, iffFalse]) await editor.addNode(n as never);
    await connect(editor, kmS, iffTrue, "then");
    await connect(editor, miS, iffTrue, "else");
    await connect(editor, kmS, iffFalse, "then");
    await connect(editor, miS, iffFalse, "else");
    const ann = makeAnnotationResolver(editor);
    expect(ann.outAnnotation(iffTrue.id, "out")?.unit).toBe("km");  // selected then
    expect(ann.outAnnotation(iffFalse.id, "out")?.unit).toBe("mi"); // selected else
  });

  it("only ONE branch with a unit still passes it (the other is unitless)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = fcSource("A", "usd", usd);
    const iff = ifNode("IF", null);                          // indeterminate → combine
    for (const n of [a, iff]) await editor.addNode(n as never);
    await connect(editor, a, iff, "then");                   // else left unwired (unitless)
    expect(makeAnnotationResolver(editor).outAnnotation(iff.id, "out")?.unit).toBe("usd");
  });

  it("INDETERMINATE selection (e.g. a list condition) + conflicting branches → no annotation", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = fcSource("A", "usd", usd);
    const b = fcSource("B", "eur", eur);
    const iff = ifNode("IF", null);                          // null = picks per-element
    for (const n of [a, b, iff]) await editor.addNode(n as never);
    await connect(editor, a, iff, "then");
    await connect(editor, b, iff, "else");
    expect(makeAnnotationResolver(editor).outAnnotation(iff.id, "out")).toBeUndefined();
  });
});

describe("applyFcUnit — the FC is value-mutating (FC A4: the unit rides the VALUE)", () => {
  it("authors a base-SI UnitCell on a dimensionless number (interprets it AS the unit)", () => {
    const r = applyFcUnit(5, "km") as UnitCell;
    expect(isUnitCell(r)).toBe(true);
    expect(r.dim).toEqual({ length: 1 });
    expect(r.value).toBeCloseTo(5000, 9); // 5 read as 5 km → 5000 m base
    expect(r.display).toBe("km");
  });

  it("RE-DISPLAYS a commensurable already-dimensioned value (base kept, display swapped)", () => {
    const fiveKm = fromUnit(5, UNITS.m, "km"); // 5 m tagged, display km (contrived)
    const asMi = applyFcUnit(fromUnit(5000, UNITS.m, "km"), "mi") as UnitCell;
    expect(asMi.value).toBeCloseTo(5000, 6);   // base meters unchanged
    expect(asMi.display).toBe("mi");           // re-displayed in miles
    expect(isUnitCell(fiveKm)).toBe(true);
  });

  it("#UNIT! on a true dimension clash (a length can't be re-labeled a mass)", () => {
    const lengthCell = fromUnit(3, UNITS.m, "m");
    const clash = applyFcUnit(lengthCell, "kg");
    expect(isSolError(clash) && clash.code).toBe("#UNIT!");
  });

  it("`none` / text pass through; a list tags per cell; a NUMERIC matrix takes ONE whole-grid unit (D20)", () => {
    expect(applyFcUnit(5, "none")).toBe(5);
    expect(applyFcUnit("hello", "km")).toBe("hello");
    // A numeric matrix keeps its cells bare but carries one unit on the array (D20).
    // The tag lands on a COPY, never the input — the DataflowEngine shares a node's
    // cached array with every consumer, so mutating the source would leak this FC's
    // unit onto the upstream value and race a second consumer.
    const matrix = [[1, 2], [3, 4]];
    const tagged = applyFcUnit(matrix, "km");
    expect(tagged).not.toBe(matrix);                      // fresh outer array (no source mutation)
    expect(matrixUnitOf(matrix)).toBeUndefined();         // the shared source stays untagged
    expect(matrixUnitOf(tagged)).toMatchObject({ display: "km" });
    expect((tagged as number[][])[0][0]).toBe(1);         // cells untouched (shared, immutable)
    expect((tagged as number[][])[0]).toBe(matrix[0]);    // rows shared, only outer array is new
    // A text matrix can't take a physical unit — unchanged, no tag.
    const textMat = [["a", "b"], ["c", "d"]];
    expect(applyFcUnit(textMat, "km")).toBe(textMat);
    expect(matrixUnitOf(textMat)).toBeUndefined();
    const list = applyFcUnit([1, 2], "m") as UnitCell[];
    expect(list.map((c) => magnitudeOf(c))).toEqual([1, 2]);
    expect(list.every((c) => dimOf(c).length === 1 && c.display === "m")).toBe(true);
  });
});

describe("resolveValueOrigin — the popup 'Go to source' upstream walk", () => {
  it("a Display chain resolves to the producer at the top", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const num = node("Number");                              // producer
    const d1 = node("Disp1", { passesUnitThrough: true });
    const d2 = node("Disp2", { passesUnitThrough: true });
    for (const n of [num, d1, d2]) await editor.addNode(n as never);
    await connect(editor, num, d1);
    await connect(editor, d1, d2);
    expect(resolveValueOrigin(editor, d2.id)).toBe(num.id);
    expect(resolveValueOrigin(editor, d1.id)).toBe(num.id);
  });

  it("walks through an FC (format lock, value unchanged)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const num = node("Number");
    const fc = node("FC", { unit: "usd", format: "decimal" });
    const disp = node("Display", { passesUnitThrough: true });
    for (const n of [num, fc, disp]) await editor.addNode(n as never);
    await connect(editor, num, fc);
    await connect(editor, fc, disp);
    expect(resolveValueOrigin(editor, disp.id)).toBe(num.id);
  });

  it("a selector follows its actually-chosen branch", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = node("A");
    const b = node("B");
    const iff = ifNode("IF", "else");                        // condition computed false
    for (const n of [a, b, iff]) await editor.addNode(n as never);
    await connect(editor, a, iff, "then");
    await connect(editor, b, iff, "else");
    expect(resolveValueOrigin(editor, iff.id)).toBe(b.id);
  });

  it("stops AT an indeterminate selector (list condition — no single branch)", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = node("A");
    const b = node("B");
    const iff = ifNode("IF", null);
    for (const n of [a, b, iff]) await editor.addNode(n as never);
    await connect(editor, a, iff, "then");
    await connect(editor, b, iff, "else");
    expect(resolveValueOrigin(editor, iff.id)).toBe(iff.id);
  });

  it("a selector without branch tracking still walks its ONE wired branch", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const a = node("A");
    const iff = ifNode("IF", undefined); // no data-awareness at all → combine fallback
    for (const n of [a, iff]) await editor.addNode(n as never);
    await connect(editor, a, iff, "then");                   // else left unwired
    expect(resolveValueOrigin(editor, iff.id)).toBe(a.id);
  });

  it("a transform and an unwired Display are their own origin", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const num = node("Number");
    const add = node("Add");                                 // transform — origin of a NEW value
    const disp = node("Display", { passesUnitThrough: true });
    const lone = node("Lonely", { passesUnitThrough: true });
    for (const n of [num, add, disp, lone]) await editor.addNode(n as never);
    await connect(editor, num, add);
    await connect(editor, add, disp);
    expect(resolveValueOrigin(editor, disp.id)).toBe(add.id);
    expect(resolveValueOrigin(editor, add.id)).toBe(add.id);
    expect(resolveValueOrigin(editor, lone.id)).toBe(lone.id);
  });

  it("Convert is a transform — the walk stops there", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const num = node("Number");
    const conv = node("Convert", { fromUnit: "km", toUnit: "mi" });
    const disp = node("Display", { passesUnitThrough: true });
    for (const n of [num, conv, disp]) await editor.addNode(n as never);
    await connect(editor, num, conv);
    await connect(editor, conv, disp);
    expect(resolveValueOrigin(editor, disp.id)).toBe(conv.id);
  });
});

describe("per-output producer annotations (annotationFor) — Triangle degrees, Element g/mol", () => {
  const DEG: FormatAnnotation = { format: "auto", unit: "custom", customUnit: "\u00b0" } as FormatAnnotation;

  /** A Triangle-Solver-like producer: several outputs, only SOME carry a lock. */
  function triangleish(label: string) {
    const n = new ClassicPreset.Node(label) as ClassicPreset.Node & Record<string, unknown>;
    for (const k of ["a", "A"]) n.addOutput(k, new ClassicPreset.Output(sock, k));
    n.annotationFor = (outKey: string) => (outKey === "A" ? DEG : undefined);
    return n;
  }

  it("the lock rides ONLY the annotated output, and through a Display", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const tri = triangleish("Tri");
    const disp = node("Display", { passesUnitThrough: true });
    await editor.addNode(tri as never);
    await editor.addNode(disp as never);
    await editor.addConnection(new ClassicPreset.Connection(tri as never, "A", disp as never, "in") as never);
    const r = makeAnnotationResolver(editor);
    expect(r.outAnnotation(tri.id, "A")).toEqual(DEG);      // the angle carries °
    expect(r.outAnnotation(tri.id, "a")).toBeUndefined();   // the side carries nothing
    expect(r.outAnnotation(disp.id, "out")).toEqual(DEG);   // ° rides the passthrough
  });

  it("the real nodes: Triangle angles carry °, Element mass carries g/mol, their siblings nothing", async () => {
    const { TriangleSolverNode } = await import("./nodes/triangle");
    const { ElementNode } = await import("./nodes/chemistry");
    const tri = new TriangleSolverNode();
    expect(tri.annotationFor("A")?.unit).toBe("deg");
    expect(tri.annotationFor("B")?.unit).toBe("deg");
    expect(tri.annotationFor("a")).toBeUndefined();
    expect(tri.annotationFor("area")).toBeUndefined();
    const el = new ElementNode();
    expect(el.annotationFor("mass")?.customUnit).toBe(" g/mol");
    expect(el.annotationFor("number")).toBeUndefined();
  });
});

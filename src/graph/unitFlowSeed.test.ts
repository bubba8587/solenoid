import { describe, it, expect, beforeAll } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import * as Nodes from "./rete-nodes";
import { FormatControllerNode, IfNode, ArithmeticNode, ConvertNode, EquationNode } from "./rete-nodes";
import { makeAnnotationResolver } from "./unitFlow";
import { formatAnnotationStore } from "./formatAnnotationStore";
import { isUnitCell, isRatio, unitLabelOf, type UnitCell } from "./unitValue";
import { applyFcUnit } from "./unitBridge";
import { isSolError } from "./errorValue";
import seed from "./seedGraphs/unit-flow.json";

// The Unit Flow seed is a teaching graph: each lane's caption claims a specific
// behavior. This test builds the seed with the REAL node classes and asserts those
// claims hold (downstream carry, upstream multi-hop, transform-break, Convert
// forward, selector keeps unit), so a future change to unitFlow / the FC can't
// quietly turn a captioned demo into a lie.

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;

const editor = new NodeEditor() as unknown as AnyEditor;
const real = new Map<string, ClassicPreset.Node>(); // seed id → real node

beforeAll(async () => {
  for (const sn of seed.nodes) {
    const Ctor = (Nodes as unknown as Record<string, new (init?: Record<string, unknown>) => ClassicPreset.Node>)[sn.type];
    const node = new Ctor({ ...(sn.init as Record<string, unknown>) });
    const anyNode = node as unknown as Record<string, unknown>;
    if ("literals" in sn && sn.literals) anyNode.literals = { ...(sn.literals as unknown as Record<string, number>) };
    if ("stringLiterals" in sn && sn.stringLiterals) anyNode.stringLiterals = { ...(sn.stringLiterals as unknown as Record<string, string>) };
    real.set(sn.id, node);
    await editor.addNode(node as never);
  }
  for (const c of seed.connections) {
    const s = real.get(c.source), t = real.get(c.target);
    if (!s || !t) continue;
    await editor.addConnection(new ClassicPreset.Connection(s as never, c.sourceOutput, t as never, c.targetInput) as never);
  }
  // The IF's branch is data-derived (cond TRUE → "then"); mimic a recompute so the
  // selector resolves its actually-chosen branch, exactly as processGraph would.
  (real.get("E_if") as IfNode).data({ cond: [true], then: [80], else: [100] });
  // FC annotations are projected from the wiring (Canvas/persistence call this on
  // every connection event; do it once here now that the graph is wired).
  for (const n of editor.getNodes()) if (n instanceof FormatControllerNode) n.refreshAnnotation(editor);
});

const id = (seedId: string) => real.get(seedId)!.id;
const ann = () => makeAnnotationResolver(editor);

describe("Unit Flow seed — the captioned behaviors actually hold (FC A4 value-mutating)", () => {
  it("A · lock carries DOWNSTREAM through passthroughs (no trailing FC)", () => {
    // The inline FC locks usd onto Revenue; both Displays after it inherit the
    // number FORMAT annotation, and the value itself carries the $ dimension.
    expect(ann().inAnnotation(id("A_d1"), "in")?.unit).toBe("usd");
    expect(ann().inAnnotation(id("A_d2"), "in")?.unit).toBe("usd"); // two hops, still usd
    // …and the FC formats its host box (Revenue) in place.
    expect(formatAnnotationStore.get(id("A_num"), "value")?.unit).toBe("usd");
    expect(formatAnnotationStore.get(id("A_num"), "value")?.decimalDigits).toBe(2);
    // The FC AUTHORS the value's unit: its output is a base-SI currency UnitCell.
    const tagged = (real.get("A_fc") as FormatControllerNode).data({ in: [1234.5] }).out;
    expect(isUnitCell(tagged) && (tagged as UnitCell).dim).toEqual({ currency: 1 });
    expect(isUnitCell(tagged) && (tagged as UnitCell).display).toBe("usd");
  });

  it("B · lock reaches UPSTREAM past a passthrough (the format annotation multi-hop)", () => {
    // FC at the end writes its immediate predecessor (Logged)…
    expect(formatAnnotationStore.get(id("B_d2"), "out")?.unit).toBe("km");
    // …and the Display TWO hops above (Live feed) resolves it forward.
    expect(ann().downstreamAnnotation(id("B_d1"), "out")?.unit).toBe("km");
    // The raw input box stays unformatted — its box only reads a DIRECT write,
    // and the FC never wrote it (the lock lives in the passthrough run downstream).
    expect(formatAnnotationStore.get(id("B_num"), "value")).toBeUndefined();
  });

  it("C · a transform drops the number FORMAT, but the unit ($ dimension + display) rides", () => {
    // The FC tags the price ($10) → a base-SI currency UnitCell.
    const priced = (real.get("C_fc") as FormatControllerNode).data({ in: [10] }).out as number;
    expect(isUnitCell(priced) && (priced as UnitCell).dim).toEqual({ currency: 1 });
    expect(isUnitCell(priced) && (priced as UnitCell).display).toBe("usd");
    expect(ann().inAnnotation(id("C_d1"), "in")?.unit).toBe("usd");        // before the ×100
    // ×100 by a bare number keeps the result IN the currency dimension, so the $
    // DISPLAY unit rides the value ($10 × 100 = $1000, still shown as money). What a
    // transform DOES break is the FORMAT ANNOTATION (precision / style) — that's a
    // graph-walk display lock, not part of the value.
    const lot = (real.get("C_mul") as ArithmeticNode).data({ a: [priced], b: [100] }).result;
    expect(isUnitCell(lot) && (lot as UnitCell).dim).toEqual({ currency: 1 });
    expect(isUnitCell(lot) && (lot as UnitCell).display).toBe("usd");      // $ label rides through
    expect(ann().inAnnotation(id("C_d2"), "in")).toBeUndefined();          // number FORMAT dropped
    expect(ann().downstreamAnnotation(id("C_d2"), "out")).toBeUndefined();
  });

  it("D · Convert AUTHORS the new unit onto the value; the FC agrees", () => {
    // Convert emits a base-SI length UnitCell tagged display km (26.22 mi → 42.20 km).
    const out = (real.get("D_conv") as ConvertNode).data({ in: [26.21875] }).out;
    expect(isUnitCell(out) && (out as UnitCell).dim).toEqual({ length: 1 });
    expect(isUnitCell(out) && (out as UnitCell).display).toBe("km");
    expect((out as UnitCell).value / 1000).toBeCloseTo(42.195, 2);
    // The FC downstream keeps its km pick (they agree on the value's unit), and the
    // box before it carries the km format annotation.
    expect((real.get("D_fc") as FormatControllerNode).unit).toBe("km");
    expect(formatAnnotationStore.get(id("D_d1"), "out")?.unit).toBe("km");
  });

  it("E · a selector KEEPS the chosen branch's unit", () => {
    // cond TRUE → IF passes the Sale branch; its $ format annotation rides through…
    expect(ann().inAnnotation(id("E_disp"), "in")?.unit).toBe("usd");
    // …and the IF's OWN result box carries it (a selector shows it in place).
    expect(ann().outAnnotation(id("E_if"), "result")?.unit).toBe("usd");
    expect(ann().outAnnotation(id("E_if"), "result")?.decimalDigits).toBe(2);
    // The VALUE the IF passes carries the branch's currency tag, too.
    const sale = (real.get("E_saleFc") as FormatControllerNode).data({ in: [80] }).out as number;
    const chosen = (real.get("E_if") as IfNode).data({ cond: [true], then: [sale], else: [100] }).result;
    expect(isUnitCell(chosen) && (chosen as UnitCell).dim).toEqual({ currency: 1 });
  });

  it("F · units COMPUTE: 5 m ÷ 1 s = 5 m/s; m ÷ m cancels to a PURE RATIO", () => {
    const dist = (real.get("F_distFc") as FormatControllerNode).data({ in: [5] }).out;
    const time = (real.get("F_timeFc") as FormatControllerNode).data({ in: [1] }).out;
    const speed = (real.get("F_div") as ArithmeticNode).data({ a: [dist] as never, b: [time] as never }).result;
    expect(isUnitCell(speed)).toBe(true);
    expect((speed as UnitCell).value).toBe(5);
    expect(unitLabelOf(speed)).toBe("m/s");
    // cancellation: 10 m ÷ 2 m → a PURE RATIO (5:1), known-dimensionless
    const rise = (real.get("F_lenFc") as FormatControllerNode).data({ in: [10] }).out;
    const run = (real.get("F_runFc") as FormatControllerNode).data({ in: [2] }).out;
    const slope = (real.get("F_div2") as ArithmeticNode).data({ a: [rise] as never, b: [run] as never }).result;
    expect(isRatio(slope)).toBe(true);
    expect((slope as UnitCell).value).toBe(5);
    // an FC can't re-baptize the ratio with a physical unit…
    expect(isSolError(applyFcUnit(slope, "usd"))).toBe(true);
    // …but the percent FC on the Slope box is just a number FORMAT — it applies.
    expect((real.get("F_pctFc") as FormatControllerNode).unit).toBe("none");
  });

  it("G · a bare number ADOPTS: $5 + 2 = $7; a $ list SUMs to $60", () => {
    const price = (real.get("G_priceFc") as FormatControllerNode).data({ in: [5] }).out;
    const total = (real.get("G_add") as ArithmeticNode).data({ a: [price] as never, b: [2] as never }).result as UnitCell;
    expect(isUnitCell(total)).toBe(true);
    expect(total.value).toBe(7);
    expect(total.display).toBe("usd");
    // the $ list: ListInput's typed rows → FC tags per cell → SUM keeps $
    const items = (real.get("G_list") as unknown as { data: (i: Record<string, unknown[]>) => { list: unknown } }).data({}).list;
    const tagged = (real.get("G_listFc") as FormatControllerNode).data({ in: [items] }).out;
    const sum = (real.get("G_sum") as unknown as { data: (i: Record<string, unknown[]>) => { result: unknown } }).data({ list: [tagged] }).result as UnitCell;
    expect(isUnitCell(sum)).toBe(true);
    expect(sum.value).toBe(60);
    expect(sum.display).toBe("usd");
  });

  it("H · Convert PRIMACY: dictates the FC in front (← ← m), toUnit rides out as yd", () => {
    // refreshAnnotation (beforeAll) ran the downstream walk: the FC feeding the
    // Convert is dictated its fromUnit.
    const hfc = real.get("H_fc") as FormatControllerNode;
    expect(hfc.dictatedFromUnit).toBe("m");
    const tagged = hfc.data({ in: [5] }).out;
    expect(hfc.lockedByConvert).toBe(true);
    expect(hfc.unitLocked).toBe(true);
    expect(hfc.unit).toBe("m"); // dropdown locked + mirrored to the Convert's read unit
    // …and the Convert's toUnit rides the value out (a non-FC-registry id works too).
    const out = (real.get("H_conv") as ConvertNode).data({ in: [tagged] }).out as UnitCell;
    expect(isUnitCell(out)).toBe(true);
    expect(out.display).toBe("yd");
  });

  it("H · …or it ERRORS: a $ into an m→km Convert is #UNIT!, never a silent pass", () => {
    const bad = (real.get("H_badFc") as FormatControllerNode).data({ in: [5] }).out;
    const out = (real.get("H_conv2") as ConvertNode).data({ in: [bad] }).out as { __solError?: boolean; code?: string };
    expect(out && out.__solError).toBe(true);
    expect(out.code).toBe("#UNIT!");
  });

  it("J · the Equation node derives the unknown's unit (d = v·t → meters)", () => {
    const v = (real.get("J_vFc") as FormatControllerNode).data({ in: [5] }).out;
    const t = (real.get("J_tFc") as FormatControllerNode).data({ in: [10] }).out;
    const out = (real.get("J_eq") as EquationNode).data({ v: [v], t: [t] });
    const dist = out.d as UnitCell;
    expect(isUnitCell(dist)).toBe(true);
    expect(dist.value).toBe(50);
    expect(unitLabelOf(dist)).toBe("m");
  });

  it("I · a CUSTOM unit is a real dimension: widgets ÷ s = widgets/s", () => {
    const batch = (real.get("I_fc") as FormatControllerNode).data({ in: [5] }).out;
    expect(unitLabelOf(batch)).toBe("widgets");
    const every = (real.get("I_timeFc") as FormatControllerNode).data({ in: [1] }).out;
    const rate = (real.get("I_div") as ArithmeticNode).data({ a: [batch] as never, b: [every] as never }).result;
    expect(isUnitCell(rate)).toBe(true);
    expect(unitLabelOf(rate)).toBe("widgets/s");
  });
});

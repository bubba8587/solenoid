import { describe, it, expect, beforeAll } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import * as Nodes from "./rete-nodes";
import { FormatControllerNode, IfNode, ArithmeticNode, ConvertNode } from "./rete-nodes";
import { makeAnnotationResolver } from "./unitFlow";
import { formatAnnotationStore } from "./formatAnnotationStore";
import { isUnitCell, type UnitCell } from "./unitValue";
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

  it("C · a transform breaks the DISPLAY lock; the DIMENSION rides the value", () => {
    // The FC tags the price ($10) → a base-SI currency UnitCell.
    const priced = (real.get("C_fc") as FormatControllerNode).data({ in: [10] }).out as number;
    expect(isUnitCell(priced) && (priced as UnitCell).dim).toEqual({ currency: 1 });
    expect(isUnitCell(priced) && (priced as UnitCell).display).toBe("usd");
    expect(ann().inAnnotation(id("C_d1"), "in")?.unit).toBe("usd");        // before the ×100
    // ×100 is a transform: the number FORMAT + the $ DISPLAY unit DROP, but the
    // currency DIMENSION rides the value ($10 × 100 is still money).
    const lot = (real.get("C_mul") as ArithmeticNode).data({ a: [priced], b: [100] }).result;
    expect(isUnitCell(lot) && (lot as UnitCell).dim).toEqual({ currency: 1 });
    expect(isUnitCell(lot) && (lot as UnitCell).display).toBeUndefined(); // clean $ label gone
    expect(ann().inAnnotation(id("C_d2"), "in")).toBeUndefined();          // format dropped
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
});

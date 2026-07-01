import { describe, it, expect, beforeAll } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import * as Nodes from "./rete-nodes";
import { FormatControllerNode, IfNode } from "./rete-nodes";
import { makeAnnotationResolver, makeUnitResolver } from "./unitFlow";
import { formatAnnotationStore } from "./formatAnnotationStore";
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
const unit = () => makeUnitResolver(editor);

describe("Unit Flow seed — the captioned behaviors actually hold", () => {
  it("A · lock carries DOWNSTREAM through passthroughs (no trailing FC)", () => {
    // The inline FC locks usd onto Revenue; both Displays after it inherit it.
    expect(ann().inAnnotation(id("A_d1"), "in")?.unit).toBe("usd");
    expect(ann().inAnnotation(id("A_d2"), "in")?.unit).toBe("usd"); // two hops, still usd
    // …and the FC formats its host box (Revenue) in place.
    expect(formatAnnotationStore.get(id("A_num"), "value")?.unit).toBe("usd");
    expect(formatAnnotationStore.get(id("A_num"), "value")?.decimalDigits).toBe(2);
  });

  it("B · lock reaches UPSTREAM past a passthrough (the multi-hop fix)", () => {
    // FC at the end writes its immediate predecessor (Logged)…
    expect(formatAnnotationStore.get(id("B_d2"), "out")?.unit).toBe("km");
    // …and the Display TWO hops above (Live feed) resolves it forward.
    expect(ann().downstreamAnnotation(id("B_d1"), "out")?.unit).toBe("km");
    // The raw input box stays unformatted — its box only reads a DIRECT write,
    // and the FC never wrote it (the lock lives in the passthrough run downstream).
    expect(formatAnnotationStore.get(id("B_num"), "value")).toBeUndefined();
  });

  it("C · a transform BREAKS the unit", () => {
    expect(ann().inAnnotation(id("C_d1"), "in")?.unit).toBe("usd");      // before the ×100
    expect(ann().inAnnotation(id("C_d2"), "in")).toBeUndefined();         // after — gone
    expect(ann().downstreamAnnotation(id("C_d2"), "out")).toBeUndefined();
    expect(unit().outUnit(id("C_mul"), "result")).toBe("none");           // unit dropped at the transform
  });

  it("D · Convert FORWARDS its toUnit into the FC", () => {
    // The FC didn't author km — it locked to what Convert emits.
    expect(unit().outUnit(id("D_conv"), "out")).toBe("km");
    expect((real.get("D_fc") as FormatControllerNode).unit).toBe("km");
    expect((real.get("D_fc") as FormatControllerNode).unitLocked).toBe(true);
    expect(formatAnnotationStore.get(id("D_d1"), "out")?.unit).toBe("km");
  });

  it("E · a selector KEEPS the chosen branch's unit", () => {
    // cond TRUE → IF passes the Sale branch, which carries usd.
    expect(unit().outUnit(id("E_if"), "result")).toBe("usd");
    expect(ann().inAnnotation(id("E_disp"), "in")?.unit).toBe("usd");
    // The IF's OWN result box also carries it (outAnnotation on its output) — so a
    // selector that keeps the unit SHOWS it in place, not just on a downstream box.
    expect(ann().outAnnotation(id("E_if"), "result")?.unit).toBe("usd");
    expect(ann().outAnnotation(id("E_if"), "result")?.decimalDigits).toBe(2);
  });
});

// [[B16]] oneFormulaSurface, [[C25]]
import { describe, it, expect } from "vitest";
import { GraphEditor } from "../../src/graph/graphEditor";
import { GraphConnection, GraphNode, GraphOutput, GraphSocket } from "../../src/graph/graphModel";
import { resolveTrigModes } from "../../src/graph/trigMode";
import { MathFXNode } from "../../src/graph/nodes/scalar";

// A dimensioned angle cell: base-SI RADIANS carrying a display unit (deg or rad).

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;
const sock = new (class extends GraphSocket {})("any");

/** A source publishing a per-output unit via `annotationFor` — the Triangle
 *  Solver / MathFn-inverse-trig shape the resolver now reads. */
function degSource() {
  const n = new GraphNode("Angle") as GraphNode & Record<string, unknown>;
  n.addOutput("A", new GraphOutput(sock, "A"));
  n.annotationFor = (k: string) => (k === "A" ? { format: "auto", unit: "deg" } : undefined);
  return n;
}
function plainSource() {
  const n = new GraphNode("Num") as GraphNode & Record<string, unknown>;
  n.addOutput("out", new GraphOutput(sock, "out"));
  return n;
}
const connect = async (e: AnyEditor, s: GraphNode, sOut: string, t: GraphNode) =>
  e.addConnection(new GraphConnection(s as never, sOut, t as never, "in") as never);

describe("resolveTrigModes — Auto trig reads its incoming unit", () => {
  it("a degree-tagged value flips an Auto SIN to degrees; a plain value stays radians", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const deg = degSource();
    const sin = new MathFXNode({ op: "sin" }); // auto
    await editor.addNode(deg as never);
    await editor.addNode(sin as never);
    await connect(editor, deg, "A", sin);
    resolveTrigModes(editor);
    expect(sin.effectiveAngleMode()).toBe("deg");
    // SIN(90°) computes to 1 now.
    expect(sin.data({ in: [90] }).result as number).toBeCloseTo(1, 9);

    // A plain (unitless) source → radians.
    const editor2 = new GraphEditor() as unknown as AnyEditor;
    const num = plainSource();
    const sin2 = new MathFXNode({ op: "sin" });
    await editor2.addNode(num as never);
    await editor2.addNode(sin2 as never);
    await connect(editor2, num, "out", sin2);
    resolveTrigModes(editor2);
    expect(sin2.effectiveAngleMode()).toBe("rad");
  });

  it("a manual Rad/Deg pin is never touched; a non-trig auto node is ignored", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    const deg = degSource();
    const pinned = new MathFXNode({ op: "sin", angleMode: "rad" }); // explicit
    const sqrtAuto = new MathFXNode({ op: "sqrt" });                // auto but not trig
    await editor.addNode(deg as never);
    await editor.addNode(pinned as never);
    await editor.addNode(sqrtAuto as never);
    await connect(editor, deg, "A", pinned);
    const changed = resolveTrigModes(editor);
    expect(pinned.effectiveAngleMode()).toBe("rad"); // pin wins
    expect(changed).not.toContain(sqrtAuto);         // non-trig never enters
  });

  it("no auto trig nodes → early-out returns nothing", async () => {
    const editor = new GraphEditor() as unknown as AnyEditor;
    await editor.addNode(new MathFXNode({ op: "abs" }) as never);
    expect(resolveTrigModes(editor)).toEqual([]);
  });
});



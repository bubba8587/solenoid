import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { resolveTrigModes } from "./trigMode";
import { MathFnNode } from "./nodes/scalar";

type AnyEditor = NodeEditor<{ Node: ClassicPreset.Node; Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> }>;
const sock = new (class extends ClassicPreset.Socket {})("any");

/** A source publishing a per-output unit via `annotationFor` — the Triangle
 *  Solver / MathFn-inverse-trig shape the resolver now reads. */
function degSource() {
  const n = new ClassicPreset.Node("Angle") as ClassicPreset.Node & Record<string, unknown>;
  n.addOutput("A", new ClassicPreset.Output(sock, "A"));
  n.annotationFor = (k: string) => (k === "A" ? { format: "auto", unit: "deg" } : undefined);
  return n;
}
function plainSource() {
  const n = new ClassicPreset.Node("Num") as ClassicPreset.Node & Record<string, unknown>;
  n.addOutput("out", new ClassicPreset.Output(sock, "out"));
  return n;
}
const connect = async (e: AnyEditor, s: ClassicPreset.Node, sOut: string, t: ClassicPreset.Node) =>
  e.addConnection(new ClassicPreset.Connection(s as never, sOut, t as never, "in") as never);

describe("resolveTrigModes — Auto trig reads its incoming unit", () => {
  it("a degree-tagged value flips an Auto SIN to degrees; a plain value stays radians", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const deg = degSource();
    const sin = new MathFnNode({ op: "sin" }); // auto
    await editor.addNode(deg as never);
    await editor.addNode(sin as never);
    await connect(editor, deg, "A", sin);
    resolveTrigModes(editor);
    expect(sin.effectiveAngleMode()).toBe("deg");
    // SIN(90°) computes to 1 now.
    expect(sin.data({ in: [90] }).result as number).toBeCloseTo(1, 9);

    // A plain (unitless) source → radians.
    const editor2 = new NodeEditor() as unknown as AnyEditor;
    const num = plainSource();
    const sin2 = new MathFnNode({ op: "sin" });
    await editor2.addNode(num as never);
    await editor2.addNode(sin2 as never);
    await connect(editor2, num, "out", sin2);
    resolveTrigModes(editor2);
    expect(sin2.effectiveAngleMode()).toBe("rad");
  });

  it("a manual Rad/Deg pin is never touched; a non-trig auto node is ignored", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    const deg = degSource();
    const pinned = new MathFnNode({ op: "sin", angleMode: "rad" }); // explicit
    const sqrtAuto = new MathFnNode({ op: "sqrt" });                // auto but not trig
    await editor.addNode(deg as never);
    await editor.addNode(pinned as never);
    await editor.addNode(sqrtAuto as never);
    await connect(editor, deg, "A", pinned);
    const changed = resolveTrigModes(editor);
    expect(pinned.effectiveAngleMode()).toBe("rad"); // pin wins
    expect(changed).not.toContain(sqrtAuto);         // non-trig never enters
  });

  it("no auto trig nodes → early-out returns nothing", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
    await editor.addNode(new MathFnNode({ op: "abs" }) as never);
    expect(resolveTrigModes(editor)).toEqual([]);
  });
});

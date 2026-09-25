// [[B16]], [[C25]]
import { describe, it, expect } from "vitest";
import { NodeEditor, ClassicPreset } from "rete";
import { resolveTrigModes } from "../../src/graph/trigMode";
import { MathFXNode } from "../../src/graph/nodes/scalar";
import { tagDim, magnitudeOf } from "../../src/graph/unitValue";

// A dimensioned angle cell: base-SI RADIANS carrying a display unit (deg or rad).
const angle = (rad: number, display: "deg" | "rad") => tagDim(rad, { angle: 1 }, display);
const mags = (r: unknown) => (r as unknown[]).map((c) => magnitudeOf(c));

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
    const sin = new MathFXNode({ op: "sin" }); // auto
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
    const sin2 = new MathFXNode({ op: "sin" });
    await editor2.addNode(num as never);
    await editor2.addNode(sin2 as never);
    await connect(editor2, num, "out", sin2);
    resolveTrigModes(editor2);
    expect(sin2.effectiveAngleMode()).toBe("rad");
  });

  it("a manual Rad/Deg pin is never touched; a non-trig auto node is ignored", async () => {
    const editor = new NodeEditor() as unknown as AnyEditor;
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
    const editor = new NodeEditor() as unknown as AnyEditor;
    await editor.addNode(new MathFXNode({ op: "abs" }) as never);
    expect(resolveTrigModes(editor)).toEqual([]);
  });
});

describe("MathFn trig — per-cell mixed-unit interpretation", () => {
  it("in deg mode a mixed list reads each cell in its own unit", () => {
    // A radian-tagged angle and a degree-tagged angle carry their OWN unit (base
    // radians, so the node mode is ignored); a BARE number has no unit and follows the
    // node's deg mode. One list, three interpretations.
    const sin = new MathFXNode({ op: "sin", angleMode: "deg" });
    const res = sin.data({ in: [[angle(Math.PI / 2, "rad"), angle(Math.PI / 3, "deg"), 30]] as never });
    const [a, b, c] = mags(res.result);
    expect(a).toBeCloseTo(1, 9);              // sin(π/2 rad) — own unit
    expect(b).toBeCloseTo(Math.sin(Math.PI / 3), 9); // sin(60° = π/3 rad) — own unit
    expect(c).toBeCloseTo(0.5, 9);            // sin(30°) — bare, follows deg mode
  });

  it("a dimensioned-only list ignores the node's deg mode (each cell is base radians)", () => {
    const sin = new MathFXNode({ op: "sin", angleMode: "deg" });
    const res = sin.data({ in: [[angle(Math.PI / 6, "deg"), angle(Math.PI / 2, "rad")]] as never });
    expect(mags(res.result)).toEqual([Math.sin(Math.PI / 6), Math.sin(Math.PI / 2)]);
  });

  it("an untagged (all-bare) list is unchanged — deg mode converts the whole list", () => {
    const sinDeg = new MathFXNode({ op: "sin", angleMode: "deg" });
    const deg = sinDeg.data({ in: [[0, 30, 90]] as never }).result as number[];
    expect(deg[0]).toBeCloseTo(0, 9);
    expect(deg[1]).toBeCloseTo(0.5, 9);
    expect(deg[2]).toBeCloseTo(1, 9);

    const sinRad = new MathFXNode({ op: "sin", angleMode: "rad" });
    const rad = sinRad.data({ in: [[0, Math.PI / 6]] as never }).result as number[];
    expect(rad[0]).toBeCloseTo(0, 9);
    expect(rad[1]).toBeCloseTo(0.5, 9);
  });
});

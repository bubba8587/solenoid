import type { NodeEditor, ClassicPreset } from "rete";
import { MathFnNode, isTrigOp } from "./nodes/scalar";
import { makeUnitResolver } from "./unitFlow";

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

// ─── Auto angle-mode resolution ────────────────────────────────────────────────
// A MathFn trig node in `auto` mode computes in degrees when the value feeding it
// carries the `deg`/`grad` angle unit, else radians (Excel parity). Units live in
// the unitFlow resolver over the editor graph, NOT in the compute plane, so this
// pass reads the incoming unit ONCE per recompute and stamps a transient
// `_resolvedAngleMode` the node's data() then reads — the first (and only) place
// compute consults units. A manual Rad/Deg pin never enters here (effectiveMode
// ignores `_resolvedAngleMode` unless the mode is auto).
//
// Runs from processGraph before the engine fetch (so data() sees a fresh mode),
// and early-outs when no auto-mode trig node exists — the overwhelming common
// case pays only one getNodes() scan.

/** True when this unit id denotes degrees (so trig should interpret in degrees).
 *  `grad` (gradians) is also non-radian, but degrees is the only mode the toggle
 *  offers, so grad falls through to rad — a Convert bridges it. */
function isDegreeUnit(unit: string): boolean {
  return unit === "deg";
}

/** Stamp every auto-mode trig MathFn's `_resolvedAngleMode` from its input's
 *  resolved unit. Returns the nodes whose resolved mode CHANGED (so a caller can
 *  re-render them if it wants; processGraph recomputes the whole cone anyway). */
export function resolveTrigModes(editor: AnyEditor): MathFnNode[] {
  const autos: MathFnNode[] = [];
  for (const n of editor.getNodes()) {
    if (n instanceof MathFnNode && n.angleMode === "auto" && isTrigOp(n.op)) autos.push(n);
  }
  if (autos.length === 0) return []; // no work → skip building the resolver

  const resolver = makeUnitResolver(editor);
  const changed: MathFnNode[] = [];
  for (const n of autos) {
    const unit = resolver.inUnit(n.id, "in");
    const mode = isDegreeUnit(unit) ? "deg" : "rad";
    if (n._resolvedAngleMode !== mode) { n._resolvedAngleMode = mode; changed.push(n); }
  }
  return changed;
}

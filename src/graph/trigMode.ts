import type { NodeEditor, ClassicPreset } from "rete";
import { MathFnNode, isTrigOp } from "./nodes/scalar";
import { makeAnnotationResolver } from "./unitFlow";

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

// Resolves ONLY the annotation-tagged bare-degree case — a dimensioned angle is
// already base RADIANS and takes data()'s unit-aware path. Must run BEFORE the
// engine fetch so data() sees a fresh `_resolvedAngleMode`.

/** True when this unit id denotes degrees; `grad` falls through to rad, since the
 *  toggle offers no gradian mode — a Convert bridges it. */
function isDegreeUnit(unit: string): boolean {
  return unit === "deg";
}

/** Stamp every auto-mode trig MathFn's `_resolvedAngleMode` from its input's
 *  resolved unit. Returns only the nodes whose resolved mode CHANGED. */
export function resolveTrigModes(editor: AnyEditor): MathFnNode[] {
  const autos: MathFnNode[] = [];
  for (const n of editor.getNodes()) {
    if (n instanceof MathFnNode && n.angleMode === "auto" && isTrigOp(n.op)) autos.push(n);
  }
  if (autos.length === 0) return [];

  const resolver = makeAnnotationResolver(editor);
  const changed: MathFnNode[] = [];
  for (const n of autos) {
    const unit = resolver.inAnnotation(n.id, "in")?.unit ?? "none";
    const mode = isDegreeUnit(unit) ? "deg" : "rad";
    if (n._resolvedAngleMode !== mode) { n._resolvedAngleMode = mode; changed.push(n); }
  }
  return changed;
}

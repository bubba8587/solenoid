// [[D41]] formatFlowsDownstream: the one compute-time unit read. Mechanics: tree/specs/values/unit-flow.md.
import type { NodeEditor, ClassicPreset } from "rete";
import { MathFXNode, isTrigOp } from "./nodes/scalar";
import { makeAnnotationResolver } from "./unitFlow";

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

function isDegreeUnit(unit: string): boolean {
  return unit === "deg";
}

/** Returns only the nodes whose resolved mode changed. */
export function resolveTrigModes(editor: AnyEditor): MathFXNode[] {
  const autos: MathFXNode[] = [];
  for (const n of editor.getNodes()) {
    if (n instanceof MathFXNode && n.angleMode === "auto" && isTrigOp(n.op)) autos.push(n);
  }
  if (autos.length === 0) return [];

  const resolver = makeAnnotationResolver(editor);
  const changed: MathFXNode[] = [];
  for (const n of autos) {
    const unit = resolver.inAnnotation(n.id, "in")?.unit ?? "none";
    const mode = isDegreeUnit(unit) ? "deg" : "rad";
    if (n._resolvedAngleMode !== mode) { n._resolvedAngleMode = mode; changed.push(n); }
  }
  return changed;
}

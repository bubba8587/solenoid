// [[C130]] rustCore, [[C25]] firstClassUnits, [[C118]] formatTravelsWithValue
// What the annotation walk reads from each node's JavaScript object (graph-core.md § Phase D): a Convert ends a walk; a
// node may produce an annotation per output, hold its own (a Format Controller, a constant), or inherit one; a
// passthrough forwards its selected or agreeing inputs; a Conduit forwards lane by lane; and a format carry hands an
// input's format to an output of the same element family. The core holds the cables.
import type { GraphEditor } from "./graphEditor";
import type { GraphConnection, GraphNode } from "./graphModel";
import type { FormatAnnotation } from "./formatAnnotationStore";
import { elementFamilyOf, SolenoidSocket } from "./sockets";
import { getPassthrough, passInputKeys, selectedPassInput } from "./nodes/passthrough";
import { formatCarryForOutput } from "./nodes/formatCarry";

export interface AnnotationFacts {
  id: string;
  convert?: true;
  /** The annotation the node makes for each output it annotates itself. */
  produced?: Record<string, FormatAnnotation>;
  /** Its own annotation; a resolving node (an FC) answers its own, or, inheriting, the one upstream with its own unit. */
  own?: FormatAnnotation;
  resolves?: true;
  inherit?: true;
  /** A passthrough: its picked input (null: none picks, unknown), else its value inputs, which must agree. */
  pass?: { selected?: string | null; keys: string[] | null; pure: boolean };
  lanes?: true;
  carry?: Record<string, { inputs: string[]; notDate?: true }>;
  /** Each port's element family, where it has one. */
  families: { ins: Record<string, string>; outs: Record<string, string> };
  /** Its input and output keys, in order. */
  ins: string[];
  outs: string[];
  /** Whether the node is a value forwarder a value's origin walks through: an FC, or a passthrough. */
  fc?: true;
}

type AnyEditor = GraphEditor<{ Node: GraphNode; Connection: GraphConnection<GraphNode, GraphNode> }>;

const fn = (n: unknown, name: string): ((...a: unknown[]) => unknown) | undefined => {
  const f = (n as Record<string, unknown> | null)?.[name];
  return typeof f === "function" ? (f as (...a: unknown[]) => unknown).bind(n) : undefined;
};

function family(port: { socket?: unknown } | undefined): string | undefined {
  const s = port?.socket;
  return s instanceof SolenoidSocket ? elementFamilyOf(s.dataType) ?? undefined : undefined;
}

export function annotationFacts(editor: AnyEditor): AnnotationFacts[] {
  return editor.getNodes().map((n) => {
    const o = n as unknown as Record<string, unknown>;
    const f: AnnotationFacts = { id: n.id, families: { ins: {}, outs: {} }, ins: Object.keys(n.inputs), outs: Object.keys(n.outputs) };
    for (const k in n.inputs) { const fam = family(n.inputs[k]); if (fam) f.families.ins[k] = fam; }
    for (const k in n.outputs) { const fam = family(n.outputs[k]); if (fam) f.families.outs[k] = fam; }
    if (typeof o.fromUnit === "string" && typeof o.toUnit === "string") f.convert = true;
    if (typeof o.unit === "string" && typeof o.format === "string") f.fc = true;
    const annotationFor = fn(n, "annotationFor");
    if (annotationFor) {
      const produced: Record<string, FormatAnnotation> = {};
      for (const k in n.outputs) { const a = annotationFor(k) as FormatAnnotation | undefined; if (a) produced[k] = a; }
      f.produced = produced;
    }
    const annotation = fn(n, "annotation");
    if (annotation) f.own = annotation() as FormatAnnotation;
    if (fn(n, "resolveAnnotation")) f.resolves = true;
    if (o.inheritFormat === true) f.inherit = true;
    const specs = getPassthrough(n);
    if (specs.length) {
      const sel = selectedPassInput(n);
      f.pass = { ...(sel !== undefined ? { selected: sel } : {}), keys: passInputKeys(n), pure: specs.some((s) => s.pure) };
    }
    if (Array.isArray(o.cachedLane)) f.lanes = true;
    for (const k in n.outputs) {
      const c = formatCarryForOutput(n, k);
      if (c) (f.carry ??= {})[k] = { inputs: c.inputs, ...(c.notDate ? { notDate: true as const } : {}) };
    }
    return f;
  });
}

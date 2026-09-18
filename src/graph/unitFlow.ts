// [[C25]], [[D41]], [[D43]]
import type { ClassicPreset } from "rete";
import type { NodeEditor } from "rete";
import { type FormatAnnotation, isDateStyle } from "./formatAnnotationStore";
import { elementFamilyOf, type SocketDataType } from "./sockets";
import { isPassthroughNode, isPurePassthroughNode, passInputKeys, selectedPassInput } from "./nodes/passthrough";
import { formatCarryForOutput } from "./nodes/formatCarry";

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

type ConvertLike = { fromUnit: string; toUnit: string };
type FcLike = { unit: string; format: string };

function isConvert(n: unknown): n is ConvertLike {
  const o = n as Record<string, unknown> | null;
  return !!o && typeof o.fromUnit === "string" && typeof o.toUnit === "string";
}
function isFc(n: unknown): n is FcLike {
  const o = n as Record<string, unknown> | null;
  return !!o && typeof o.unit === "string" && typeof o.format === "string";
}
const isPassthrough = isPassthroughNode;
const isPurePassthrough = isPurePassthroughNode;
/** The explicit value-branch input keys (the selector's value rows, Display's `in`). */
function valuePassKeys(n: unknown): string[] | null {
  return passInputKeys(n);
}
/** The ONE input key being passed RIGHT NOW (data-aware): a string = that branch,
 *  `null` = indeterminate (fall back to combine), `undefined` = no runtime pick. */
const selectedKey = selectedPassInput;
type FcAnnLike = { annotation: () => FormatAnnotation };
function hasAnnotation(n: unknown): n is FcAnnLike {
  return typeof (n as Record<string, unknown> | null)?.annotation === "function";
}
/** An FC whose style dropdown may be set to `—` (inherit): it merges the format
 *  arriving at `in` with its own unit rather than publishing a fixed annotation. */
type FcResolveLike = { resolveAnnotation: (inherited: FormatAnnotation | undefined) => FormatAnnotation };
function hasResolveAnnotation(n: unknown): n is FcResolveLike {
  return typeof (n as Record<string, unknown> | null)?.resolveAnnotation === "function";
}
/** Per-OUTPUT producer annotation; undefined for a key means that output carries
 *  nothing, while node-level `annotation()` is the single-output form. */
type FcAnnForLike = { annotationFor: (outKey: string) => FormatAnnotation | undefined };
function hasAnnotationFor(n: unknown): n is FcAnnForLike {
  return typeof (n as Record<string, unknown> | null)?.annotationFor === "function";
}

type AnyPort = { socket?: { dataType?: SocketDataType } } | undefined;
/** The element family a port DECLARES; null for a wildcard or a structural type
 *  (`frame`, `lambda`, …), which carries no format. Dates are their own family. */
function portFamily(port: AnyPort): string | null {
  const dt = port?.socket?.dataType;
  return dt ? elementFamilyOf(dt) : null;
}

/** Branches must carry the SAME lock (unit + format) to pass it. */
function combineAnnotations(anns: (FormatAnnotation | undefined)[]): FormatAnnotation | undefined {
  const real = anns.filter((a): a is FormatAnnotation => !!a);
  if (real.length === 0) return undefined;
  const key = (a: FormatAnnotation) => `${a.unit}|${a.format}|${a.customUnit}`;
  const k0 = key(real[0]);
  return real.every((a) => key(a) === k0) ? real[0] : undefined;
}

export type AnnotationResolver = {
  /** The format+unit LOCKED on the value carried by this output socket, or undefined. */
  outAnnotation: (nodeId: string, outKey: string) => FormatAnnotation | undefined;
  /** The locked annotation arriving on this input socket (its source's output). */
  inAnnotation: (nodeId: string, inKey: string) => FormatAnnotation | undefined;
  /** The annotation of an FC DOWNSTREAM through pure passthroughs — an in-segment
   *  FC locks the boxes behind it too; stops at the first transform/selector. */
  downstreamAnnotation: (nodeId: string, outKey: string) => FormatAnnotation | undefined;
};

/** An FC LOCKS its format+unit onto the value, a passthrough carries it across
 *  UNCHANGED, a transform carries the FORMAT alone and ONLY where it DECLARES a
 *  meaning-preserving op (formatCarry / [[D41]] formatFlowsDownstream), and Convert DROPS it. */
export function makeAnnotationResolver(editor: AnyEditor): AnnotationResolver {
  const memo = new Map<string, FormatAnnotation | null>();
  const visiting = new Set<string>();

  // Index the connections ONCE: a per-hop getConnections() scan is O(boxes × cables).
  type AnyConn = ReturnType<AnyEditor["getConnections"]>[number];
  const byTarget = new Map<string, AnyConn[]>();
  const bySource = new Map<string, AnyConn[]>();
  for (const c of editor.getConnections()) {
    const t = byTarget.get(c.target);
    if (t) t.push(c); else byTarget.set(c.target, [c]);
    const s = bySource.get(c.source);
    if (s) s.push(c); else bySource.set(c.source, [c]);
  }

  function inAnnotation(nodeId: string, inKey: string): FormatAnnotation | undefined {
    for (const c of byTarget.get(nodeId) ?? []) {
      if (c.targetInput === inKey) return outAnnotation(c.source, c.sourceOutput);
    }
    return undefined;
  }
  function firstInputAnnotation(nodeId: string): FormatAnnotation | undefined {
    const c = byTarget.get(nodeId)?.[0];
    return c ? outAnnotation(c.source, c.sourceOutput) : undefined;
  }
  function compute(nodeId: string, outKey: string): FormatAnnotation | undefined {
    const n = editor.getNode(nodeId);
    if (isConvert(n)) return undefined;
    // A produced lock (a Triangle angle's °, an inverse-trig deg result) wins; when the
    // op produces no lock for THIS output, fall through so a meaning-preserving op can
    // still carry an input's format (abs / round of a percent).
    if (hasAnnotationFor(n)) { const produced = n.annotationFor(outKey); if (produced) return produced; }
    // An FC that may inherit reads the format arriving at its `in`; a plain FC just
    // publishes its own. `resolveAnnotation` covers both, so it wins where present.
    if (hasResolveAnnotation(n)) return n.resolveAnnotation(inAnnotation(nodeId, "in"));
    if (hasAnnotation(n)) return n.annotation();
    if (isPassthrough(n)) {
      const sel = selectedKey(n);
      if (sel) return inAnnotation(nodeId, sel);
      const keys = valuePassKeys(n);
      return keys ? combineAnnotations(keys.map((k) => inAnnotation(nodeId, k))) : firstInputAnnotation(nodeId);
    }
    // A Conduit lane forwards in_i → out_i, handled here because the Conduit
    // deliberately carries no passthrough() declaration.
    const lane = /^out_(\d+)$/.exec(outKey);
    if (lane && n && typeof n === "object" && Array.isArray((n as { cachedLane?: unknown }).cachedLane)) {
      return inAnnotation(nodeId, `in_${lane[1]}`);
    }
    return carriedFormat(n, nodeId, outKey);
  }
  /** A TRANSFORM passes the display FORMAT on and NOTHING else ([[D41]] formatFlowsDownstream),
   *  but ONLY where the node DECLARES it (formatCarry) — a transform with no declaration
   *  for this output carries nothing, so the op that MEANS a new kind of value (mul, div,
   *  count, a rate, a z-score) shows plain. Among the declared inputs the first wired,
   *  annotated, same-element-family one wins; the unit is stripped — it is value-level
   *  ([[D40]] unitOnValue), riding the `UnitCell` or breaking at the transform on its own. Two or
   *  more date-styled operands are a SPAN, not a date (date − date), so they carry nothing. */
  function carriedFormat(
    n: ClassicPreset.Node | undefined,
    nodeId: string,
    outKey: string,
  ): FormatAnnotation | undefined {
    const spec = formatCarryForOutput(n, outKey);
    if (!spec) return undefined;
    const outFamily = portFamily(n?.outputs?.[outKey] as AnyPort);
    if (!outFamily) return undefined;
    const eligible: FormatAnnotation[] = [];
    for (const inKey of spec.inputs) {
      const ann = inAnnotation(nodeId, inKey);
      if (!ann) continue;
      if (portFamily(n?.inputs?.[inKey] as AnyPort) !== outFamily) continue;
      eligible.push(ann);
    }
    if (eligible.length === 0) return undefined;
    if (eligible.filter((a) => isDateStyle(a.format)).length >= 2) return undefined;
    return { ...eligible[0], unit: "none", customUnit: "" };
  }
  function outAnnotation(nodeId: string, outKey: string): FormatAnnotation | undefined {
    const key = `${nodeId}::${outKey}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (visiting.has(key)) return undefined;
    visiting.add(key);
    const a = compute(nodeId, outKey);
    visiting.delete(key);
    memo.set(key, a ?? null);
    return a;
  }

  // An FC anywhere ahead in a pure-passthrough run locks every box in the run,
  // including the ones BEHIND it; a transform or selector ends the segment.
  const dsMemo = new Map<string, FormatAnnotation | null>();
  const dsVisiting = new Set<string>();
  function downstreamAnnotation(nodeId: string, outKey: string): FormatAnnotation | undefined {
    const key = `${nodeId}::${outKey}`;
    const cached = dsMemo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (dsVisiting.has(key)) return undefined;
    dsVisiting.add(key);
    let found: FormatAnnotation | undefined;
    for (const c of bySource.get(nodeId) ?? []) {
      if (c.sourceOutput !== outKey) continue;
      const consumer = editor.getNode(c.target);
      if (hasResolveAnnotation(consumer)) { found = consumer.resolveAnnotation(inAnnotation(c.target, "in")); break; }
      if (hasAnnotation(consumer)) { found = consumer.annotation(); break; }
      if (isPurePassthrough(consumer)) {
        for (const ok of Object.keys(consumer?.outputs ?? {})) {
          const a = downstreamAnnotation(c.target, ok);
          if (a) { found = a; break; }
        }
        if (found) break;
      }
    }
    dsVisiting.delete(key);
    dsMemo.set(key, found ?? null);
    return found;
  }

  return { outAnnotation, inAnnotation, downstreamAnnotation };
}

/** Walk UPSTREAM to the node that PRODUCED the value shown (through FCs, pure
 *  passthroughs and data-aware selectors), stopping at any transform, an
 *  indeterminate selector, or an ambiguous multi-branch one. */
export function resolveValueOrigin(editor: AnyEditor, nodeId: string): string {
  const seen = new Set<string>();
  let id = nodeId;
  while (!seen.has(id)) {
    seen.add(id);
    const n = editor.getNode(id);
    if (!n) break;
    let inKey: string | null = null; // null = "first connected input" (Display)
    if (isConvert(n)) break;
    if (isFc(n)) {
      inKey = "in";
    } else if (isPassthrough(n)) {
      const sel = selectedKey(n);
      if (sel === null) break;
      if (typeof sel === "string") {
        inKey = sel;
      } else {
        const keys = valuePassKeys(n);
        if (keys) {
          const connected = keys.filter((k) =>
            editor.getConnections().some((c) => c.target === id && c.targetInput === k));
          if (connected.length !== 1) break; // ambiguous → the selector is the stop
          inKey = connected[0];
        }
      }
    } else {
      break; // transform / source — this IS the origin
    }
    const conn = editor.getConnections().find((c) =>
      c.target === id && (inKey === null || c.targetInput === inKey));
    if (!conn) break;
    id = conn.source;
  }
  return id;
}

// Annotations can change on ANY pass, so the resolver can't be cached on the
// connection version; within ONE commit the graph is fixed, so it's shared for the
// current microtask and rebuilt on the next tick.
let _sharedResolver: AnnotationResolver | null = null;
let _sharedResolverEditor: AnyEditor | null = null;

export function sharedAnnotationResolver(editor: AnyEditor): AnnotationResolver {
  if (_sharedResolver && _sharedResolverEditor === editor) return _sharedResolver;
  _sharedResolver = makeAnnotationResolver(editor);
  _sharedResolverEditor = editor;
  queueMicrotask(() => {
    _sharedResolver = null;
    _sharedResolverEditor = null;
  });
  return _sharedResolver;
}

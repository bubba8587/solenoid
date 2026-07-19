import type { ClassicPreset } from "rete";
import type { NodeEditor } from "rete";
import { type FormatAnnotation } from "./formatAnnotationStore";
import { isPassthroughNode, isPurePassthroughNode, passInputKeys, selectedPassInput } from "./nodes/passthrough";

// ─── Unit flow ─────────────────────────────────────────────────────────────────
// The UNIT of a value is a property of the *value* itself — a base-SI `UnitCell`
// with a `display` id (unitValue.ts), authored by a Format Controller / Convert /
// unit source (FC A4, value-mutating). It rides the value through passthroughs &
// selectors and DROPS at a transform on its OWN, so there is NO graph unit-walk
// here anymore. What remains is the FORMAT (number style / precision / negatives /
// K-M-B) — a DISPLAY annotation an FC locks, which a passthrough box shows without
// its own trailing FC. This module resolves THAT annotation forward/back, plus the
// popup "Go to source" origin walk.
//
// Per-node rule (all duck-typed so this file imports no node classes):
//   • Convert     (has fromUnit + toUnit) → transform: DROPS the inherited format.
//   • FC / producer (has annotation / annotationFor) → LOCKS its own format.
//   • passthrough — a node whose `passthrough()` declaration (passthrough.ts, the ONE
//     source type adoption ALSO reads) says it forwards a value unchanged:
//       · data-aware `selected()` names the ONE branch it's passing right now (IF from
//         its condition, CHOOSE from its index) → carry THAT branch's annotation;
//         `null` = indeterminate (a LIST condition picks per-element), so fall back to:
//       · the spec's value-branch inputs COMBINED — the annotations must AGREE (else none).
//   • anything else                       → clear: nothing locked (the value is transformed).

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
// The passthrough facts (which node passes a value through, which inputs are its value
// branches, which branch is live) now come from the node's ONE `passthrough()`
// declaration (passthrough.ts) — the same source trueany TYPE adoption reads, so a node
// can't pass type-but-not-unit (the Expect / Cable Switch / IFERROR drift this closes).
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
/** Per-OUTPUT producer annotation — for a node whose outputs carry DIFFERENT
 *  locks (Triangle Solver: degrees on the angles, nothing on the sides; Element:
 *  g/mol on the mass, nothing on Z). Returning undefined for a key means that
 *  output carries nothing; the node-level annotation() stays the single-output
 *  form (Physics Constant). */
type FcAnnForLike = { annotationFor: (outKey: string) => FormatAnnotation | undefined };
function hasAnnotationFor(n: unknown): n is FcAnnForLike {
  return typeof (n as Record<string, unknown> | null)?.annotationFor === "function";
}

/** Branches must carry the SAME lock (unit + format)
 *  to pass it; otherwise none. */
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
  /** The annotation of an FC sitting DOWNSTREAM of this output, reachable through a
   *  chain of pure passthroughs (Displays). This is the upstream half of segment
   *  resolution: a Display two hops ABOVE an FC (`…→Disp1→Disp2→FC`) carries the
   *  FC's lock even though the FC is in front of it, because the value reaches the
   *  FC unchanged. Stops at the first transform / selector — the value is no longer
   *  the same there. Undefined if no in-segment FC is found forward. */
  downstreamAnnotation: (nodeId: string, outKey: string) => FormatAnnotation | undefined;
};

/**
 * Resolve the FORMAT ANNOTATION (not just the unit) locked onto a value, by the same
 * walk as the unit resolver: an FC LOCKS its own format+unit onto the value; a
 * passthrough node (Display, …) carries it across UNCHANGED; a transformative node
 * (anything not FC / passthrough) DROPS it — the value is now something new. So a
 * downstream Display shows the upstream FC's `$` format with no trailing FC of its
 * own, and the lock only breaks once the value enters a real transform. (Convert is a
 * unit transform → it drops the inherited format; it imposes its own unit, not format.)
 */
export function makeAnnotationResolver(editor: AnyEditor): AnnotationResolver {
  const memo = new Map<string, FormatAnnotation | null>();
  const visiting = new Set<string>();

  // Index the connections ONCE per resolver — each hop was a full scan of
  // editor.getConnections(), which multiplied out to O(boxes × cables) per
  // render pass on a big graph (audit finding 41).
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
    if (isConvert(n)) return undefined;                  // unit transform → format drops
    if (hasAnnotationFor(n)) return n.annotationFor(outKey); // per-output producer lock
    if (hasAnnotation(n)) return n.annotation();         // FC locks its own format+unit
    if (isPassthrough(n)) {                              // carry across unchanged
      const sel = selectedKey(n);
      if (sel) return inAnnotation(nodeId, sel);         // the actually-selected branch
      const keys = valuePassKeys(n);
      return keys ? combineAnnotations(keys.map((k) => inAnnotation(nodeId, k))) : firstInputAnnotation(nodeId);
    }
    // A Conduit lane forwards in_i → out_i unchanged, so the annotation crosses
    // it like any passthrough — mapped HERE because the Conduit deliberately has
    // no passthrough() declaration (its lane TYPE adoption runs its own reconcile,
    // and hanging the declaration on it would double up that machinery). Duck-typed
    // on the lane cache so this module keeps importing no node classes.
    const lane = /^out_(\d+)$/.exec(outKey);
    if (lane && n && typeof n === "object" && Array.isArray((n as { cachedLane?: unknown }).cachedLane)) {
      return inAnnotation(nodeId, `in_${lane[1]}`);
    }
    return undefined;                                    // transform / source → nothing locked
  }
  function outAnnotation(nodeId: string, outKey: string): FormatAnnotation | undefined {
    const key = `${nodeId}::${outKey}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (visiting.has(key)) return undefined; // cycle guard
    visiting.add(key);
    const a = compute(nodeId, outKey);
    visiting.delete(key);
    memo.set(key, a ?? null);
    return a;
  }

  // ── Forward (downstream) segment walk ──────────────────────────────────────
  // Look ahead from an output for an FC reachable through pure passthroughs. The
  // value travels unchanged across Displays, so an FC anywhere ahead in that
  // passthrough run locks every box in the run — including ones BEHIND it. A
  // transform (or a selector, or Convert) ends the segment: the value changes there.
  const dsMemo = new Map<string, FormatAnnotation | null>();
  const dsVisiting = new Set<string>();
  function downstreamAnnotation(nodeId: string, outKey: string): FormatAnnotation | undefined {
    const key = `${nodeId}::${outKey}`;
    const cached = dsMemo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (dsVisiting.has(key)) return undefined; // cycle guard
    dsVisiting.add(key);
    let found: FormatAnnotation | undefined;
    for (const c of bySource.get(nodeId) ?? []) {
      if (c.sourceOutput !== outKey) continue;
      const consumer = editor.getNode(c.target);
      if (hasAnnotation(consumer)) { found = consumer.annotation(); break; } // an FC ahead
      if (isPurePassthrough(consumer)) {
        // Recurse through the Display on each of its value outputs.
        for (const ok of Object.keys(consumer?.outputs ?? {})) {
          const a = downstreamAnnotation(c.target, ok);
          if (a) { found = a; break; }
        }
        if (found) break;
      }
      // else: a transform / selector / Convert — segment ends, this branch yields nothing.
    }
    dsVisiting.delete(key);
    dsMemo.set(key, found ?? null);
    return found;
  }

  return { outAnnotation, inAnnotation, downstreamAnnotation };
}

// ── Value origin (popup "Go to source") ──────────────────────────────────────

/**
 * Walk UPSTREAM from a node to the node that actually PRODUCED the value it
 * shows — through FCs (format lock, value unchanged), pure passthroughs
 * (Display), and data-aware selectors following their actually-chosen branch.
 * Stops at any transform (Convert included — the converted number is a NEW
 * value), at an indeterminate selector (a list condition picks per-element, so
 * no single branch is "the" origin), and at an ambiguous multi-branch selector.
 * Used by the popup "Go to source" action: from a Display's popup the camera
 * should fly to the producer, not the Display you just clicked. A node that is
 * itself a producer (Aggregate, Join, Number…) resolves to itself.
 */
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
      if (sel === null) break; // selector, branch indeterminate
      if (typeof sel === "string") {
        inKey = sel;
      } else {
        const keys = valuePassKeys(n); // selector without branch tracking
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
    if (!conn) break; // chosen branch not wired → stop here
    id = conn.source;
  }
  return id;
}

// ── Per-commit resolver sharing (audit finding 41) ───────────────────────────
// Every value box built its OWN resolver in its component body, every render —
// so one React commit over a 300-node graph re-walked the connection list per
// box per hop. Annotations can change on ANY pass (an FC edit, a selector
// picking its other branch), so the resolver can't be cached on the connection
// version — but within ONE commit the graph is fixed. Share a single resolver
// (and its memos) for the current microtask; the next tick rebuilds fresh.
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

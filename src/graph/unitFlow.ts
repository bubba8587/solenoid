import type { ClassicPreset } from "rete";
import type { NodeEditor } from "rete";
import { isFcUnit, type FormatAnnotation } from "./formatAnnotationStore";

// ─── Unit flow ─────────────────────────────────────────────────────────────────
// A unit is a property of the *value*, not of a particular cable. It survives
// any node that passes the value through unchanged, changes at a transform, and
// is dropped by everything else. This module computes, for any output socket,
// the unit the value carries there — by walking back through the graph. FCs and
// Convert read it to decide what to lock to and whether to forward.
//
// Per-node rule (all duck-typed so this file imports no node classes):
//   • Convert     (has fromUnit + toUnit) → transform: output carries toUnit.
//   • FC          (has unit + format)     → author if its input is unitless
//                                           (publishes its own unit forward),
//                                           else forward the input's unit.
//   • passthrough — a node that SELECTS/PASSES a value unchanged keeps its unit:
//       · `passesUnitThrough: true`  → all connected inputs are value inputs (Display).
//       · `selectedUnitInput(): string | null` → the node has COMPUTED which one branch
//         it's passing right now (IF knows its condition, CHOOSE its index, …). When a key
//         is returned, the output simply carries THAT branch's unit — IF(true, km, mi) is
//         km, IF(false, km, mi) is mi. `null` = indeterminate (e.g. a LIST condition picks
//         per-element), so fall back to:
//       · `unitPassInputs(): string[]` → the value branches COMBINED: a unitless branch is
//         ignored; the rest must AGREE (else ambiguous → no unit). So IF(c, $a, $b) → `$`,
//         IF(c, $a, b) → `$`, and IF(c, km, mi) over a LIST condition → none.
//   • anything else                       → clear: no unit (the value is transformed).
//
// "none" is the absence of a unit.

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
/** A passthrough node either marks ALL inputs as value inputs (`passesUnitThrough`)
 *  or names the value-branch inputs via `unitPassInputs()` (the selectors). */
function isPassthrough(n: unknown): boolean {
  const o = n as Record<string, unknown> | null;
  return !!o && (o.passesUnitThrough === true || typeof o.unitPassInputs === "function");
}
/** A PURE passthrough (Display): every input is the same value forwarded unchanged
 *  on its single output. Unlike a selector, the value flows straight through, so a
 *  segment of these between a value's origin and an FC all show the FC's lock. */
function isPurePassthrough(n: unknown): boolean {
  return (n as Record<string, unknown> | null)?.passesUnitThrough === true;
}
/** The explicit value-branch input keys, or null = "all connected inputs". */
function valuePassKeys(n: unknown): string[] | null {
  const f = (n as Record<string, unknown> | null)?.unitPassInputs;
  return typeof f === "function" ? (f as () => string[]).call(n) : null;
}
/** The ONE input key the node has computed it's currently passing through (data-aware):
 *  a string = that branch, `null` = indeterminate (fall back to combine), `undefined` =
 *  the node doesn't track a selection (Display). */
function selectedKey(n: unknown): string | null | undefined {
  const f = (n as Record<string, unknown> | null)?.selectedUnitInput;
  return typeof f === "function" ? (f as () => string | null).call(n) : undefined;
}
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

/** Combine value-branch units: ignore unitless branches; the rest must agree, else the
 *  result is ambiguous (a runtime branch we can't predict) → no unit. */
function combineUnits(units: string[]): string {
  const real = units.filter((u) => u && u !== "none");
  if (real.length === 0) return "none";
  return real.every((u) => u === real[0]) ? real[0] : "none";
}
/** Same idea for the full annotation: branches must carry the SAME lock (unit + format)
 *  to pass it; otherwise none. */
function combineAnnotations(anns: (FormatAnnotation | undefined)[]): FormatAnnotation | undefined {
  const real = anns.filter((a): a is FormatAnnotation => !!a);
  if (real.length === 0) return undefined;
  const key = (a: FormatAnnotation) => `${a.unit}|${a.format}|${a.customUnit}`;
  const k0 = key(real[0]);
  return real.every((a) => key(a) === k0) ? real[0] : undefined;
}

export type UnitResolver = {
  /** The unit the value carries on this output socket. */
  outUnit: (nodeId: string, outKey: string) => string;
  /** The unit established on this input socket (its source's output unit). */
  inUnit: (nodeId: string, inKey: string) => string;
};

/**
 * Build a resolver over the editor's current graph. Memoized and cycle-guarded,
 * so it's cheap to query repeatedly within one refresh. Reads live node fields
 * (it recomputes a forwarded unit from the chain root, so it doesn't depend on
 * any FC's locked-unit cache being up to date — order-independent).
 */
export function makeUnitResolver(editor: AnyEditor): UnitResolver {
  const memo = new Map<string, string>();
  const visiting = new Set<string>();

  function inUnit(nodeId: string, inKey: string): string {
    for (const c of editor.getConnections()) {
      if (c.target === nodeId && c.targetInput === inKey) {
        return outUnit(c.source, c.sourceOutput);
      }
    }
    return "none";
  }

  // The unit feeding a node's first connected input — for single-input
  // passthrough nodes whose input key we don't want to hardcode.
  function firstInputUnit(nodeId: string): string {
    for (const c of editor.getConnections()) {
      if (c.target === nodeId) return outUnit(c.source, c.sourceOutput);
    }
    return "none";
  }

  function compute(nodeId: string): string {
    const n = editor.getNode(nodeId);
    if (isConvert(n)) return isFcUnit(n.toUnit) ? n.toUnit : "none";
    if (isFc(n)) {
      const iu = inUnit(nodeId, "in");
      if (iu !== "none") return iu;                       // forward
      return n.unit && n.unit !== "none" ? n.unit : "none"; // author
    }
    if (isPassthrough(n)) {
      const sel = selectedKey(n);
      if (sel) return inUnit(nodeId, sel);           // follow the actually-selected branch
      const keys = valuePassKeys(n);                 // sel null/undefined → combine / all
      return keys ? combineUnits(keys.map((k) => inUnit(nodeId, k))) : firstInputUnit(nodeId);
    }
    return "none";
  }

  function outUnit(nodeId: string, outKey: string): string {
    const key = `${nodeId}::${outKey}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return "none"; // cycle guard (shouldn't happen in a DAG)
    visiting.add(key);
    const u = compute(nodeId);
    visiting.delete(key);
    memo.set(key, u);
    return u;
  }

  return { outUnit, inUnit };
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

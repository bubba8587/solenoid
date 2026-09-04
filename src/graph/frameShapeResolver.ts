import type { NodeEditor, ClassicPreset } from "rete";
import type { Shape } from "./frameShape";
import { ConduitNode, conduitLaneOf, conduitInKey } from "./nodes/conduit";
import { passthroughForOutput, type PassthroughSpec } from "./nodes/passthrough";
import { frameShapeOf } from "./nodes/frameShapeHook";

// The graph walk over the per-node `frameShape()` declarations (nodes/frameShapeHook.ts) —
// node-agnostic, pure, no engine call, no IPC; `null` = unknown.

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

export type FrameShapeResolver = {
  /** The static shape on this OUTPUT socket, or null when it's unknown. */
  outShape: (nodeId: string, outKey: string) => Shape | null;
};

export function makeFrameShapeResolver(editor: AnyEditor): FrameShapeResolver {
  const memo = new Map<string, Shape | null>();
  const visiting = new Set<string>();

  const byTarget = new Map<string, { source: string; sourceOutput: string; targetInput: string }[]>();
  for (const c of editor.getConnections()) {
    const list = byTarget.get(c.target);
    const entry = { source: c.source, sourceOutput: c.sourceOutput as string, targetInput: c.targetInput as string };
    if (list) list.push(entry); else byTarget.set(c.target, [entry]);
  }

  function inputShape(nodeId: string, inKey: string): Shape | null {
    for (const c of byTarget.get(nodeId) ?? []) {
      if (c.targetInput === inKey) return outShape(c.source, c.sourceOutput);
    }
    return null;
  }

  function isWired(nodeId: string, inKey: string): boolean {
    return (byTarget.get(nodeId) ?? []).some((c) => c.targetInput === inKey);
  }

  /** A misconfigured verb throws the same error a real run would; swallow it to "unknown",
   *  mirroring how a bad config shows an error VALUE at runtime rather than crashing. */
  function safe(fn: () => Shape | null): Shape | null {
    try { return fn(); } catch { return null; }
  }

  /** Column names + types, in order — the structural analogue of `agreeTypes`. */
  function sameShape(a: Shape, b: Shape): boolean {
    return a.columns.length === b.columns.length &&
      a.columns.every((c, i) => c.name === b.columns[i].name && c.type === b.columns[i].type);
  }

  /** Resolved from the ONE `passthrough()` declaration rather than a second instanceof
   *  list, so a new type-agnostic node needs no edit here; every WIRED branch must agree. */
  function passthroughShape(nodeId: string, spec: PassthroughSpec): Shape | null {
    if (spec.combine === "single") return inputShape(nodeId, spec.inputs[0]);
    if (spec.combine === "active") {
      const i = spec.activeIndex ? Math.max(0, Math.min(spec.activeIndex(), spec.inputs.length - 1)) : 0;
      return spec.inputs.length ? inputShape(nodeId, spec.inputs[i]) : null;
    }
    const wired = spec.inputs.map((k) => inputShape(nodeId, k)).filter((x): x is Shape => x != null);
    if (wired.length === 0) return null;
    return wired.every((x) => sameShape(x, wired[0])) ? wired[0] : null;
  }

  function compute(nodeId: string, outKey: string): Shape | null {
    const n = editor.getNode(nodeId) as unknown;
    return safe(() => {
      // A Conduit lane forwards verbatim but declares no `passthrough()` — conduitTrace
      // owns lane routing — so it is named here.
      if (n instanceof ConduitNode) {
        const lane = conduitLaneOf(outKey, "out");
        return lane < 0 ? null : inputShape(nodeId, conduitInKey(lane));
      }
      // Everything else declares its forwarding; skip this and a frame routed through a
      // Display / IF / Expect loses its static shape and every verb downstream goes unknown.
      const pass = passthroughForOutput(n, outKey);
      if (pass) return passthroughShape(nodeId, pass);

      // Every producer declares its own columns; a node with neither declaration is unknown.
      const hook = frameShapeOf(n);
      return hook
        ? hook(outKey, { inputShape: (k) => inputShape(nodeId, k), wired: (k) => isWired(nodeId, k) })
        : null;
    });
  }

  function outShape(nodeId: string, outKey: string): Shape | null {
    const key = `${nodeId}::${outKey}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return null; // cycle guard
    visiting.add(key);
    const s = compute(nodeId, outKey);
    visiting.delete(key);
    memo.set(key, s);
    return s;
  }

  return { outShape };
}

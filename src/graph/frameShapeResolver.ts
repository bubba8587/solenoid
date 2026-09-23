// [[C8]] declareOnce, [[D17]] relaysTransparent
import type { NodeEditor, ClassicPreset } from "rete";
import type { Shape } from "./frameShape";
import { ConduitNode, conduitLaneOf, conduitInKey } from "./nodes/conduit";
import { passthroughForOutput, type PassthroughSpec } from "./nodes/passthrough";
import { frameShapeOf } from "./nodes/frameShapeHook";

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

export type FrameShapeResolver = {
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

  function safe(fn: () => Shape | null): Shape | null {
    try { return fn(); } catch { return null; }
  }

  function sameShape(a: Shape, b: Shape): boolean {
    return a.columns.length === b.columns.length &&
      a.columns.every((c, i) => c.name === b.columns[i].name && c.type === b.columns[i].type);
  }

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
      if (n instanceof ConduitNode) {
        const lane = conduitLaneOf(outKey, "out");
        return lane < 0 ? null : inputShape(nodeId, conduitInKey(lane));
      }
      const hook = frameShapeOf(n);
      const pass = passthroughForOutput(n, outKey);
      const runHook = () => hook!(outKey, { inputShape: (k) => inputShape(nodeId, k), wired: (k) => isWired(nodeId, k) });
      if (hook && pass) return runHook();
      if (pass) return passthroughShape(nodeId, pass);
      return hook ? runHook() : null;
    });
  }

  function outShape(nodeId: string, outKey: string): Shape | null {
    const key = `${nodeId}::${outKey}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return null;
    visiting.add(key);
    const s = compute(nodeId, outKey);
    visiting.delete(key);
    memo.set(key, s);
    return s;
  }

  return { outShape };
}

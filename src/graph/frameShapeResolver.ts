import type { NodeEditor, ClassicPreset } from "rete";
import { parseListLiteral } from "./coerceInputs";
import { frameFromInputText } from "./frame";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  type Shape,
} from "./frameShape";
import {
  FrameInputNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode,
  ColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode,
  AppendNode, RenameNode, SplitColumnNode, AddIndexNode, GetRowNode,
} from "./nodes/frame";
import { ConduitNode, conduitLaneOf, conduitInKey } from "./nodes/conduit";
import { passthroughForOutput, type PassthroughSpec } from "./nodes/passthrough";

// Propagates `shapeOf` forward from literal frame sources — pure, no engine call, no IPC.
// A wired-in dynamic config can't be resolved without running the graph, so it reads as
// unconfigured here; `null` = unknown.

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

/** The `stringLiterals` bag is created lazily on first edit and most classes don't declare
 *  it as a field, so read it duck-typed the way coerceInputs.ts does. */
function lit(n: unknown, key: string): string {
  return (n as { stringLiterals?: Record<string, string> }).stringLiterals?.[key] ?? "";
}
function csvList(n: unknown, key: string): string[] {
  const raw = lit(n, key);
  return raw ? (parseListLiteral(raw, "strlist") as string[]) : [];
}

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

      if (n instanceof FrameInputNode) return shapeOfFrameValue(frameFromInputText(n.frameText));
      if (n instanceof GetRowNode) return inputShape(nodeId, "frame");
      if (n instanceof DistinctNode) return inputShape(nodeId, "frame");
      if (n instanceof HeadNode) return inputShape(nodeId, "frame");
      if (n instanceof SortFrameNode) return inputShape(nodeId, "frame");
      if (n instanceof FilterFrameNode) return inputShape(nodeId, "frame");

      if (n instanceof ColumnsNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const cols = csvList(n, "columns");
        if (n.op === "keep") return cols.length ? shapeOf({ kind: "select", columns: cols }, input) : input;
        return shapeOf({ kind: "drop", columns: cols }, input);
      }
      if (n instanceof RenameNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const from = csvList(n, "from");
        const to = csvList(n, "to");
        const map: Record<string, string> = {};
        for (let i = 0; i < Math.min(from.length, to.length); i++) if (from[i] && to[i]) map[from[i]] = to[i];
        return Object.keys(map).length ? shapeOf({ kind: "rename", map }, input) : input;
      }
      if (n instanceof GroupByFrameNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const keys = csvList(n, "keys");
        const col = lit(n, "column").trim();
        if (!keys.length || !col) return input;
        return shapeOf({ kind: "groupBy", keys, aggs: [{ column: col, op: n.agg, as: col }] }, input);
      }
      if (n instanceof UnpivotNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const vals = csvList(n, "valueColumns");
        if (!vals.length) return input;
        return shapeOf({ kind: "unpivot", idColumns: csvList(n, "idColumns"), valueColumns: vals }, input);
      }
      if (n instanceof PivotNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const valid = new Set(input.columns.map((c) => c.name));
        const rowFields = csvList(n, "rowFields").filter((f) => valid.has(f));
        const colFields = csvList(n, "colFields").filter((f) => valid.has(f));
        const values = csvList(n, "values").filter((f) => valid.has(f));
        if (!values.length) return input;
        const funcs = values.map((name) => n.funcs[name] ?? n.agg);
        return shapeOf({ kind: "pivot", rowFields, colFields, values, funcs }, input);
      }
      if (n instanceof JoinNode) {
        const left = inputShape(nodeId, "left");
        const right = inputShape(nodeId, "right");
        const lk = lit(n, "leftKey").trim();
        const rk = lit(n, "rightKey").trim() || lk;
        if (!left || !right || lk === "") return null;
        return shapeOfJoin(left, right, { leftKey: lk, rightKey: rk, how: n.how });
      }
      if (n instanceof AppendNode) {
        const shapes = [inputShape(nodeId, "top"), inputShape(nodeId, "bottom")]
          .filter((s): s is Shape => s != null);
        if (shapes.length === 0) return null;
        return shapes.length === 1 ? shapes[0] : shapeOfAppend(shapes);
      }
      if (n instanceof SplitColumnNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const column = lit(n, "column").trim();
        if (!column) return input;
        return shapeOfSplitColumn(input, column, lit(n, "delimiter") || ",");
      }
      if (n instanceof AddIndexNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        return shapeOfAddIndex(input, lit(n, "name") || "Index");
      }

      // A runtime-loaded source, or a node outside this walk's scope.
      return null;
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

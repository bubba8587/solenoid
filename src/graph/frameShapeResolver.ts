import type { NodeEditor, ClassicPreset } from "rete";
import { parseListLiteral } from "./coerceInputs";
import { frameFromInputText } from "./frame";
import {
  shapeOf, shapeOfJoin, shapeOfAppend, shapeOfAddIndex, shapeOfSplitColumn, shapeOfFrameValue,
  type Shape,
} from "./frameShape";
import {
  FrameInputNode, DistinctNode, HeadNode, SortFrameNode, FilterFrameNode, JoinNode,
  SelectColumnsNode, DropColumnsNode, GroupByFrameNode, PivotNode, UnpivotNode,
  AppendNode, RenameNode, SplitColumnNode, AddIndexNode, GetRowNode,
} from "./nodes/frame";

// ─── Static shape graph walk ────────────────────────────────────────────────────
// Propagates `shapeOf` forward from every literal frame source across the graph —
// pure, no engine call, no IPC (static shape, ahead of data).
// Per-node config is read from the SAME literal storage the node's own data()
// falls back to when its socket is unwired (`stringLiterals` CSV/text, the public
// op/how/funcs fields) — a wired-in dynamic column name can't be resolved without
// actually running the graph, so those inputs are treated as "unconfigured" here,
// same as the node itself treats them when disconnected. `null` = unknown (a
// runtime-loaded source like CSV/Web Source, Build Frame's data-dependent matrix
// width, a misconfigured verb, or a node this walk doesn't cover).

type AnyEditor = NodeEditor<{
  Node: ClassicPreset.Node;
  Connection: ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;
}>;

/** Every frame verb node's literal config lives in a dynamically-added
 *  `stringLiterals` bag (InlineInputs creates it lazily on first edit — see
 *  coerceInputs.ts), which most of these classes don't declare as a field. Read it
 *  duck-typed, the same way coerceInputs.ts does. */
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

  /** A misconfigured verb (e.g. a column name that doesn't exist yet) throws the
   *  same #REF!/#TYPE!/#VALUE! a real run would — swallow it here to "unknown",
   *  mirroring how a bad config just shows an error VALUE at runtime, not a crash. */
  function safe(fn: () => Shape | null): Shape | null {
    try { return fn(); } catch { return null; }
  }

  function compute(nodeId: string): Shape | null {
    const n = editor.getNode(nodeId) as unknown;
    return safe(() => {
      if (n instanceof FrameInputNode) return shapeOfFrameValue(frameFromInputText(n.frameText));
      if (n instanceof GetRowNode) return inputShape(nodeId, "frame");
      if (n instanceof DistinctNode) return inputShape(nodeId, "frame");
      if (n instanceof HeadNode) return inputShape(nodeId, "frame");
      if (n instanceof SortFrameNode) return inputShape(nodeId, "frame");
      if (n instanceof FilterFrameNode) return inputShape(nodeId, "frame");

      if (n instanceof SelectColumnsNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        const cols = csvList(n, "columns");
        return cols.length ? shapeOf({ kind: "select", columns: cols }, input) : input;
      }
      if (n instanceof DropColumnsNode) {
        const input = inputShape(nodeId, "frame");
        if (!input) return null;
        return shapeOf({ kind: "drop", columns: csvList(n, "columns") }, input);
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
        return shapeOf({ kind: "groupBy", keys, aggs: [{ column: col, op: n.op, as: col }] }, input);
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
        const funcs = values.map((name) => n.funcs[name] ?? n.op);
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

      // Unknown source (CSV/Web Source, Build Frame's data-dependent matrix width)
      // or a node outside this walk's scope (Nest/Unnest cross into Cube, Frame
      // Lookup returns a scalar, Decision Matrix/Sensitivity are terminal reports).
      return null;
    });
  }

  function outShape(nodeId: string, outKey: string): Shape | null {
    const key = `${nodeId}::${outKey}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) return null; // cycle guard
    visiting.add(key);
    const s = compute(nodeId);
    visiting.delete(key);
    memo.set(key, s);
    return s;
  }

  return { outShape };
}

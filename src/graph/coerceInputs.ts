// [[C25]], [[D43]], [[D36]] nullSkippedNotZero, [[D37]] errorBeatsMissing
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { SolenoidSocket, AdoptiveSocket, elementFamilyOf, type SocketDataType } from "./sockets";
import { toMatrix, toList, toScalar, toAnyMatrix, ShapeError } from "./nodes/coerce";
import { isPassthroughNode, getPassthrough } from "./nodes/passthrough";
import { isFrameValue, frameFromRows, toCube } from "./frame";
import { parseDate } from "./nodes/dateSerial";
import { coerceLogical } from "./valueKinds";
import { parseCsvLine } from "./csv";
import { isFrameRef, readFrame } from "./frameBackend";
import { isSolError, SEES_ERRORS } from "./errorValue";
import { stripUnitCells } from "./unitBridge";
import { isUnitCell, carryMatrixUnit } from "./unitValue";
import { frameFormatStore } from "./frameFormatStore";
import type { FrameValue } from "./frame";

export const LAZY_FRAME_NODES: ReadonlySet<string> = new Set([
  "DistinctNode", "HeadNode", "SortFrameNode", "FilterFrameNode", "JoinNode",
  "ColumnsNode", "GroupByFrameNode", "UnpivotNode",
  "AppendNode", "BindColumnsNode", "RenameNode",
  "FillBlanksNode", "ReplaceValuesNode", "WindowNode",
  "GetColumnNode", "SumIfsNode", "TableInfoNode", "WriteFileNode", "PivotNode",
  "SlicerNode",
]);

export const TYPEABLE_LIST: ReadonlySet<string> = new Set(["strlist", "datelist", "logicallist"]);

function coercionType(socket: unknown): SocketDataType | undefined {
  if (socket instanceof AdoptiveSocket) return socket.base;
  return socket instanceof SolenoidSocket ? socket.dataType : undefined;
}

function parseBoolText(p: string): boolean | null {
  const t = p.trim().toLowerCase();
  if (t === "yes" || t === "y" || t === "t") return true;
  if (t === "no"  || t === "n" || t === "f") return false;
  return coerceLogical(p);
}

export function parseListLiteral(csv: string, dt: SocketDataType): unknown[] {
  const parts = parseCsvLine(csv).map((s) => s.trim()).filter((s) => s !== "");
  if (dt === "numlist" || dt === "list") return parts.map((p) => (p !== "" && Number.isFinite(Number(p)) ? Number(p) : null));
  if (dt === "datelist") return parts.map((p) => {
    const d = parseDate(p);
    if (isSolError(d)) return d;
    return Number.isFinite(d) ? d : null;
  });
  if (dt === "logicallist") return parts.map(parseBoolText);
  return parts;
}

type Numeric = number | number[] | number[][];

function boolsToNums(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.map(boolsToNums);
  return v;
}
function numsToBools(v: unknown): unknown {
  if (typeof v === "number") return Number.isNaN(v) ? null : v !== 0;
  if (Array.isArray(v)) return v.map(numsToBools);
  return v;
}

function hasUnitCell(v: unknown): boolean {
  return isUnitCell(v) || (Array.isArray(v) && v.some(isUnitCell));
}

function coerceUnitCellValue(dataType: SocketDataType, v: unknown): unknown {
  switch (dataType) {
    case "number": {
      if (isUnitCell(v)) return v;
      if (Array.isArray(v) && v.length === 1 && isUnitCell(v[0])) return v[0];
      throw new ShapeError(`Expected a single value, got ${Array.isArray(v) ? v.length : "a table"}`);
    }
    case "list":
    case "anylist":
      return isUnitCell(v) ? [v] : v;
    case "numlist":
      return v;
    case "table":
      return toAnyMatrix(v);
    case "frame":
      if (isFrameValue(v)) return v;
      return Array.isArray(v) ? frameFromRows([v as unknown[]]) : frameFromRows([[v]]);
    case "cube":
      return toCube(v);
    default:
      return v;
  }
}

function collapseSingleton(v: unknown): unknown {
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
}

function coerceValue(dataType: SocketDataType, v: unknown): unknown {
  if (isFrameRef(v) || isSolError(v)) return v;
  if (hasUnitCell(v)) return coerceUnitCellValue(dataType, v);
  switch (dataType) {
    case "table":
      // toMatrix rebuilds the outer array, which drops the non-enumerable matrix unit tag.
      return carryMatrixUnit(toMatrix(boolsToNums(v) as Numeric), v);
    case "list":
      return toList(boolsToNums(v) as Numeric);
    case "number":
      return toScalar(boolsToNums(v) as Numeric);
    case "numlist": {
      const n = boolsToNums(v);
      const flat = Array.isArray(n) && Array.isArray((n as unknown[])[0]) ? toList(n as Numeric) : n;
      return collapseSingleton(flat);
    }
    case "logicalcombo":
      return collapseSingleton(numsToBools(v));
    case "logical":
      return collapseSingleton(numsToBools(v));
    case "logicaltable":
      return numsToBools(v);
    case "string":
    case "date":
    case "complex":
    case "strcombo":
    case "datecombo":
    case "complexcombo":
    case "anydata":
    case "anycombo":
      return collapseSingleton(v);
    case "logicallist": {
      if (v == null) return v;
      const b = numsToBools(v);
      return Array.isArray(b) ? b : [b];
    }
    case "strlist":
    case "datelist":
    case "complexlist":
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "anylist":
      if (v == null) return v;
      return Array.isArray(v) ? v : [v];
    case "frame":
      if (isFrameValue(v)) return v;
      if (v == null) return v;
      if (Array.isArray(v)) return Array.isArray((v as unknown[])[0]) ? frameFromRows(v as unknown[][]) : frameFromRows([v as unknown[]]);
      return frameFromRows([[v]]);
    case "cube":
      if (v == null) return v;
      return toCube(v);
    default:
      return v;
  }
}

function coerceValueNoWiden(dataType: SocketDataType, v: unknown): unknown {
  if (isFrameRef(v) || isSolError(v) || hasUnitCell(v)) return v;
  const fam = elementFamilyOf(dataType);
  if (fam === "number") return boolsToNums(v);
  if (fam === "logical") return numsToBools(v);
  return v;
}

/** Shallow-copies: the input frame is a cached value shared with every other consumer. */
function stampFrameFormats(nodeId: string, f: FrameValue): FrameValue {
  let changed = false;
  const columns = f.columns.map((c) => {
    const ann = frameFormatStore.get(nodeId, c.name);
    if (ann === undefined || ann === c.format) return c;
    changed = true;
    return { ...c, format: ann };
  });
  return changed ? { ...f, columns } : f;
}

type NodeLike = {
  id?: string;
  data: (inputs: Record<string, unknown[]>) => unknown;
  inputs?: Record<string, { socket?: unknown } | undefined>;
  stringLiterals?: Record<string, string>;
  rawInputs?: ReadonlySet<string>;
  noWidenInputs?: ReadonlySet<string>;
  unitAware?: boolean;
  __coerced?: boolean;
};

export function wrapNodeData(node: NodeLike) {
  if (node.__coerced || typeof node.data !== "function") return;
  node.__coerced = true;
  const orig = node.data.bind(node);
  const className = (node as { constructor: { name: string } }).constructor.name;
  const lazy = LAZY_FRAME_NODES.has(className);
  const rawInputs = node.rawInputs;
  // Captured once: Expression mutates this same Set in place, so never copy it.
  const noWiden = node.noWidenInputs;
  const keepAllUnits = node.unitAware === true;
  const isPass = !keepAllUnits && isPassthroughNode(node);

  const nodeId = typeof node.id === "string" ? node.id : null;
  const stampMemo = new WeakMap<FrameValue, { ver: number; out: FrameValue }>();
  const stampFrame = (f: FrameValue): FrameValue => {
    const ver = frameFormatStore.version();
    const hit = stampMemo.get(f);
    if (hit && hit.ver === ver) return hit.out;
    const out = stampFrameFormats(nodeId!, f);
    stampMemo.set(f, { ver, out });
    return out;
  };
  const stampOutputs = (out: unknown): unknown => {
    if (!nodeId || out === null || typeof out !== "object") return out;
    const rec = out as Record<string, unknown>;
    let next: Record<string, unknown> | null = null;
    for (const key of Object.keys(rec)) {
      const v = rec[key];
      if (!isFrameValue(v)) continue;
      const stamped = stampFrame(v);
      if (stamped !== v) (next ??= { ...rec })[key] = stamped;
    }
    return next ?? out;
  };

  const coerceAll = (inputs: Record<string, unknown[]>) => {
    // Re-read every call: the passthrough spec can depend on the current op.
    const passKeys = isPass ? new Set(getPassthrough(node).flatMap((s) => s.inputs)) : null;
    const coerced: Record<string, unknown[]> = {};
    for (const key of Object.keys(inputs)) {
      const raw = inputs[key];
      const keepUnits = keepAllUnits || (passKeys?.has(key) ?? false);
      const arr = keepUnits || !Array.isArray(raw) ? raw : (raw.map(stripUnitCells) as unknown[]);
      const socket = node.inputs?.[key]?.socket;
      const dt = coercionType(socket);
      if (!dt || !Array.isArray(arr)) { coerced[key] = arr; continue; }
      if (rawInputs?.has(key)) { coerced[key] = arr; continue; }
      if (noWiden?.has(key)) { coerced[key] = arr.map((v) => coerceValueNoWiden(dt, v)); continue; }
      coerced[key] = arr.map((v) => coerceValue(dt, v));
    }
    const lits = node.stringLiterals;
    if (lits && node.inputs) {
      for (const key of Object.keys(node.inputs)) {
        if ((coerced[key]?.length ?? 0) > 0) continue;
        const socket = node.inputs[key]?.socket;
        const dt = socket instanceof SolenoidSocket ? socket.dataType : undefined;
        if (!dt || !(TYPEABLE_LIST.has(dt) || (dt === "numlist" && key in lits))) continue;
        const csv = lits[key];
        if (csv != null && csv.trim() !== "") coerced[key] = [parseListLiteral(csv, dt)];
      }
    }
    const out = orig(coerced);
    return out instanceof Promise ? out.then(stampOutputs) : stampOutputs(out);
  };

  node.data = (inputs: Record<string, unknown[]>) => {
    if (!lazy) {
      let hasRef = false;
      for (const key of Object.keys(inputs)) {
        const arr = inputs[key];
        if (Array.isArray(arr) && arr.some(isFrameRef)) { hasRef = true; break; }
      }
      if (hasRef) {
        return (async () => {
          const mat: Record<string, unknown[]> = {};
          for (const key of Object.keys(inputs)) {
            const arr = inputs[key];
            mat[key] = Array.isArray(arr)
              ? await Promise.all(arr.map((v) => (isFrameRef(v) ? readFrame(v) : v)))
              : arr;
            // The guard ran on the ref and never saw this error, so throw it for the guard to send out.
            const failed = mat[key]?.find(isSolError);
            if (failed && !SEES_ERRORS.has(className)) throw failed;
          }
          return coerceAll(mat);
        })();
      }
    }
    return coerceAll(inputs);
  };
}

/** Install before the error guard's pipe and before any node is added. */
export function installInputCoercion(editor: NodeEditor<Schemes>) {
  editor.addPipe((context) => {
    if (context.type === "nodecreated") {
      wrapNodeData(context.data as unknown as NodeLike);
    }
    return context;
  });
}

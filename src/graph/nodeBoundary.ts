// [[D102]] graphOnCore, [[D41]] formatFlowsDownstream, [[C25]] firstClassUnits
// What the graph core's input boundary (`crates/solenoid-graph/src/boundary.rs`) asks the app for: only what the
// app's stores and frame code know (tree/specs/computation/compute-pass.md § The per-node wrappers). Installed each
// time the module loads, a trap's fresh instance included. A direct card (graph-core.md § Direct calls) asks only
// for its call (`coreHeader`), the card wire both ways (`toCore`, `fromCore`) and, once per pass, the clock and flags.
import { setBoundaryHost } from "./engineWasm/solenoid_graph.js";
import { flushPortEdits } from "./graphEditor";
import { whenWasmEngineLoads } from "./engineWasm";
import { frameFromRows, toCube, isFrameValue, type FrameValue } from "./frame";
import { isFrameRef, readFrame, refWithFormats, type FrameRef } from "./frameBackend";
import { displayMagnitudeOf } from "./unitBridge";
import { carryMatrixUnit, withMatrixUnit, type ColumnUnit, type UnitCell } from "./unitValue";
import { coreHeader, coreFieldsOf } from "./nodeOnCore";
import { nodeWire, readNodeReply, jsonDec, wireBinary, readBinary } from "./nodeWire";
import { engineClock } from "./coreValues";
import { parseListLiteral } from "./listLiterals";
import { frameFormatStore } from "./frameFormatStore";
import { carryFrameSidecars } from "./frameSidecar";
import { displayNameOf } from "./nodeNamer";
import { hasErrorSinks, reportToErrorSinks, type SolError } from "./errorValue";
import { perfEnabled, recordNode } from "./perfProbe";
import type { SocketDataType } from "./sockets";

/** Shallow-copies: the input frame is a cached value shared with every other consumer. */
function stampFrameFormats(nodeId: string, f: FrameValue): FrameValue {
  let changed = false;
  const columns = f.columns.map((c) => {
    const ann = frameFormatStore.get(nodeId, c.name);
    if (ann === undefined || ann === c.format) return c;
    changed = true;
    return { ...c, format: ann };
  });
  if (!changed) return f;
  const out = { ...f, columns };
  carryFrameSidecars(f, out);
  return out;
}

// Memoized on the arriving frame and the store's version, so a frame that did not change keeps its identity across
// passes (the backend's upload cache and every node's identity memo depend on it).
type Stamped<T> = Map<string, { ver: number; out: T }>;
const frameMemo = new WeakMap<FrameValue, Stamped<FrameValue>>();
const refMemo = new WeakMap<FrameRef, Stamped<FrameRef>>();

function memoOf<K extends object, T>(memos: WeakMap<K, Stamped<T>>, v: K): Stamped<T> {
  let m = memos.get(v);
  if (!m) memos.set(v, (m = new Map()));
  return m;
}

/** A node's own format picks on a frame it answers; on a lazy frame they ride as one more step of its plan. */
function stamp(nodeId: string, v: unknown): unknown {
  const ver = frameFormatStore.version();
  if (isFrameValue(v)) {
    const memo = memoOf(frameMemo, v);
    const hit = memo.get(nodeId);
    if (hit && hit.ver === ver) return hit.out;
    const out = stampFrameFormats(nodeId, v);
    memo.set(nodeId, { ver, out });
    return out;
  }
  if (isFrameRef(v)) {
    const memo = memoOf(refMemo, v);
    const hit = memo.get(nodeId);
    if (hit && hit.ver === ver) return hit.out;
    const own = frameFormatStore.forNode(nodeId);
    const out = own.size ? refWithFormats(v, Object.fromEntries(own)) : v;
    memo.set(nodeId, { ver, out });
    return out;
  }
  return v;
}

/** What each cell of an array is, as the boundary's walks read it in one call per array (`boundary.rs`, the kind
 *  constants): 0 number, 1 text, 2 logical, 3 null, 4 undefined, 5 array, 6 unit cell, 7 error, 8 complex, 9 lazy
 *  frame, 10 frame, 11 anything else, 12 NaN. */
function cellKinds(a: readonly unknown[]): Uint8Array {
  const k = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    switch (typeof v) {
      case "number": k[i] = v === v ? 0 : 12; break;
      case "string": k[i] = 1; break;
      case "boolean": k[i] = 2; break;
      case "undefined": k[i] = 4; break;
      case "object": {
        if (v === null) k[i] = 3;
        else if (Array.isArray(v)) k[i] = 5;
        else {
          const o = v as Record<string, unknown>;
          k[i] = o.__unitCell === true ? 6 : o.__solError === true ? 7 : o.__cx === true ? 8 : "__frameRef" in o ? 9 : o.__frame === true ? 10 : 11;
        }
        break;
      }
      default: k[i] = 11;
    }
  }
  return k;
}

whenWasmEngineLoads(() => setBoundaryHost({
  collect: (ref: FrameRef) => readFrame(ref),
  frameFromRows: (rows: unknown[][]) => frameFromRows(rows),
  toCube: (v: unknown) => toCube(v),
  displayMagnitude: (cell: UnitCell) => displayMagnitudeOf(cell),
  carryMatrixUnit: (dst: unknown, src: unknown) => carryMatrixUnit(dst, src),
  listLiteral: (text: string, rung: SocketDataType) => parseListLiteral(text, rung),
  stamp,
  carrySidecars: (from: FrameValue, to: FrameValue) => carryFrameSidecars(from, to),
  nodeName: (node: object) => displayNameOf(node),
  flags: () => (perfEnabled() ? 1 : 0) | (hasErrorSinks() ? 2 : 0),
  // `[id, error | null, …]`: every report a pass or a fetch queued, handed over when it ends.
  report: (reports: unknown[]) => {
    for (let i = 0; i < reports.length; i += 2) reportToErrorSinks(reports[i] as string, reports[i + 1] as SolError | null);
  },
  now: () => performance.now(),
  recordNode,
  flushPorts: flushPortEdits,
  cellKinds,
  header: coreHeader,
  fields: coreFieldsOf,
  toCore: (v: unknown) => {
    const b = wireBinary(v);
    if (b) return b;
    const w = nodeWire(v);
    return w === undefined ? undefined : JSON.stringify(w);
  },
  fromCore: (text: string, unit: string | undefined) => {
    const r = readNodeReply(JSON.parse(text));
    if (!r) return null;
    if (unit !== undefined) withMatrixUnit(r.value, jsonDec(JSON.parse(unit)) as ColumnUnit);
    return [r.value];
  },
  fromCoreBin: (kind: string, schema: string | undefined, tags: Uint8Array, nums: Float64Array, strs: string, lens: Uint32Array, unit: string | undefined) => {
    const value = readBinary(kind, schema, tags, nums, strs, lens);
    if (unit !== undefined) withMatrixUnit(value, jsonDec(JSON.parse(unit)) as ColumnUnit);
    return [value];
  },
  clock: () => engineClock().now,
}));

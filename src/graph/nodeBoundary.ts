// [[D102]] graphOnCore, [[D41]] formatFlowsDownstream, [[C25]] firstClassUnits
// What the graph core's input boundary (`crates/solenoid-graph/src/boundary.rs`) asks the app for: only what the
// app's stores and frame code know (tree/specs/computation/compute-pass.md § The per-node wrappers). Installed each
// time the module loads, a trap's fresh instance included.
import { setBoundaryHost } from "./graphWasm/solenoid_graph.js";
import { whenGraphEngineLoads } from "./graphEditor";
import { frameFromRows, toCube, isFrameValue, type FrameValue } from "./frame";
import { isFrameRef, readFrame, refWithFormats, type FrameRef } from "./frameBackend";
import { displayMagnitudeOf } from "./unitBridge";
import { carryMatrixUnit, type UnitCell } from "./unitValue";
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

whenGraphEngineLoads(() => setBoundaryHost({
  collect: (ref: FrameRef) => readFrame(ref),
  frameFromRows: (rows: unknown[][]) => frameFromRows(rows),
  toCube: (v: unknown) => toCube(v),
  displayMagnitude: (cell: UnitCell) => displayMagnitudeOf(cell),
  carryMatrixUnit: (dst: unknown, src: unknown) => carryMatrixUnit(dst, src),
  listLiteral: (text: string, rung: SocketDataType) => parseListLiteral(text, rung),
  stamp,
  nodeName: (node: object) => displayNameOf(node),
  flags: () => (perfEnabled() ? 1 : 0) | (hasErrorSinks() ? 2 : 0),
  report: (nodeId: string, err: SolError | null) => reportToErrorSinks(nodeId, err),
  now: () => performance.now(),
  recordNode,
}));

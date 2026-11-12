// [[A1]] visualGraphCalculator (the snapshot history), [[save-format#A save loses nothing quietly]]
import { serializeGraph, loadGraph, scheduleAutosave } from "../persistence";
import type { SavedGraph } from "../persistence";
import { getView, isGraphRebuilding, withGraphRebuild } from "../process";
import { describeGraphDelta, sameLanding } from "./flowHistoryDigest";
import { applyGraphDelta } from "../graphDelta";
import { perfEnabled } from "../perfProbe";

const MAX_DEPTH = 80;
const MAX_BYTES = 16 * 1024 * 1024;
const COALESCE_MS = 400;

/** A graph as its top-level fields plus one JSON string per node; an unchanged node reuses the previous step's string. */
type Snapshot = { head: string; nodes: string[] };
type Entry = { snap: Snapshot; ownBytes: number; time: number; label: string; baseline?: true };

let _stack: Entry[] = [];
let _index = -1;
let _restoring = false;
let _timer: ReturnType<typeof setTimeout> | null = null;
/** The parsed graph of the entry at `_index` when it was last recorded, so a record never re-parses it for its label. */
let _topGraph: SavedGraph | null = null;

function snapshotOf(g: SavedGraph, prev: Snapshot | undefined): { snap: Snapshot; ownBytes: number } {
  const { nodes, ...rest } = g;
  const head = JSON.stringify(rest);
  let ownBytes = head.length * 2;
  const reuse = new Map<string, string>();
  for (const json of prev?.nodes ?? []) reuse.set(json, json);
  const out = nodes.map((n) => {
    const json = JSON.stringify(n);
    const shared = reuse.get(json);
    if (shared !== undefined) return shared;
    ownBytes += json.length * 2;
    return json;
  });
  return { snap: { head, nodes: out }, ownBytes };
}

const fullBytes = (s: Snapshot): number => s.head.length * 2 + s.nodes.reduce((n, j) => n + j.length * 2, 0);

/** The bytes `s` holds beyond `prev`, as `snapshotOf` counts them for a new step. */
function bytesOver(s: Snapshot, prev: Snapshot | undefined): number {
  const held = new Set(prev?.nodes);
  return s.head.length * 2 + s.nodes.reduce((n, j) => (held.has(j) ? n : n + j.length * 2), 0);
}

const sameSnapshot = (a: Snapshot, b: Snapshot | undefined): boolean =>
  !!b && a.head === b.head && a.nodes.length === b.nodes.length && a.nodes.every((j, i) => j === b.nodes[i]);

const graphOf = (s: Snapshot): SavedGraph => ({ ...(JSON.parse(s.head) as Omit<SavedGraph, "nodes">), nodes: s.nodes.map((j) => JSON.parse(j)) });

function capture(prev?: Snapshot): { graph: SavedGraph; snap: Snapshot; ownBytes: number } | null {
  const g = serializeGraph();
  return g ? { graph: g, ...snapshotOf(g, prev) } : null;
}

async function restore(entry: Entry): Promise<void> {
  const snap = entry.snap;
  const t0 = perfEnabled() ? performance.now() : 0;
  _restoring = true;
  try {
    const graph = graphOf(snap);
    // Only what differs changes, so the canvas, the camera and every untouched card's value stay as they are.
    let landed: SavedGraph | null = null;
    try { landed = await applyGraphDelta(graph); } catch (err) { console.error("[solenoid] undo delta failed; loading the step whole", err); }
    const applied = landed !== null;
    if (!landed) {
      const view = getView();
      const t = view ? { ...view.transform } : null;
      // The load runs its own pass, so the cables it builds ask for no second whole one.
      await withGraphRebuild(() => loadGraph(graph, { curtain: false }), { settled: true });
      if (view && t) await view.setCamera(t);
      landed = serializeGraph();
    }
    // The step becomes the canvas as it landed (a measure re-stamped, a settled type, a dead reference a load drops),
    // so the next record compares with what is there and an untouched canvas records nothing, which would cut the redo tail.
    if (landed) {
      entry.snap = snapshotOf(landed, snap).snap;
      entry.ownBytes = bytesOver(entry.snap, _stack[_stack.indexOf(entry) - 1]?.snap);
      _topGraph = landed;
    } else _topGraph = null;
    if (perfEnabled()) console.log(`[perf] undo total=${(performance.now() - t0).toFixed(1)}ms${applied ? "" : " (whole load)"}`);
    scheduleAutosave();
  } finally {
    _restoring = false;
  }
}

export const flowHistory = {
  reset(): void {
    if (_restoring) return;
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    const c = capture();
    _stack = c ? [{ snap: c.snap, ownBytes: c.ownBytes, time: Date.now(), label: "Opened", baseline: true }] : [];
    _topGraph = c?.graph ?? null;
    _index = _stack.length - 1;
  },

  schedule(): void {
    if (_restoring || isGraphRebuilding()) return;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      _timer = null;
      flowHistory.recordNow();
    }, COALESCE_MS);
  },

  recordNow(): void {
    if (_restoring || isGraphRebuilding()) return;
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    const top = _stack[_index];
    const c = capture(top?.snap);
    if (!c || sameSnapshot(c.snap, top?.snap)) return;
    let label = "Edited document";
    if (top) {
      try {
        const prev = _topGraph ?? graphOf(top.snap);
        if (sameLanding(prev, c.graph)) return;
        label = describeGraphDelta(prev, c.graph);
      } catch { /* a label is cosmetic — never block the record */ }
    }
    _stack = _stack.slice(0, _index + 1);
    _stack.push({ snap: c.snap, ownBytes: c.ownBytes, time: Date.now(), label });
    _topGraph = c.graph;
    const dropOldest = () => {
      _stack.shift();
      _stack[0].ownBytes = fullBytes(_stack[0].snap);
    };
    if (_stack.length > MAX_DEPTH) dropOldest();
    const bytes = () => _stack.reduce((n, e) => n + e.ownBytes, 0);
    while (_stack.length > 2 && bytes() > MAX_BYTES) dropOldest();
    _index = _stack.length - 1;
  },

  canUndo: (): boolean => _index > 0,
  canRedo: (): boolean => _index < _stack.length - 1,

  async undo(): Promise<void> {
    if (_restoring) return;
    // Flushed before restore opens its rebuild scope, inside which recordNow stands down.
    if (_timer) flowHistory.recordNow();
    if (_index <= 0) return;
    _index--;
    await restore(_stack[_index]);
  },

  async redo(): Promise<void> {
    if (_restoring) return;
    if (_timer) flowHistory.recordNow();
    if (_index >= _stack.length - 1) return;
    _index++;
    await restore(_stack[_index]);
  },

  records: (): Array<{ time: number; label: string }> =>
    _stack.slice(0, _index + 1).filter((e) => !e.baseline).map(({ time, label }) => ({ time, label })),

  _state: () => ({ depth: _stack.length, index: _index }),
  _stack: () => _stack,
};

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __flowHistory?: typeof flowHistory }).__flowHistory = flowHistory;
}

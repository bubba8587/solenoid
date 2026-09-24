// [[B10]] reactFlowView (the snapshot history), [[B12]] losslessSaves
import { serializeGraph, loadGraph, scheduleAutosave } from "../persistence";
import type { SavedGraph } from "../persistence";
import { getView, isGraphRebuilding } from "../process";
import { describeGraphDelta, sameIgnoringDims } from "./flowHistoryDigest";

const MAX_DEPTH = 80;
const MAX_BYTES = 16 * 1024 * 1024;
const COALESCE_MS = 400;

type Entry = { json: string; time: number; label: string };

let _stack: Entry[] = [];
let _index = -1;
let _restoring = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

function capture(): string | null {
  const g = serializeGraph();
  return g ? JSON.stringify(g) : null;
}

async function restore(json: string): Promise<void> {
  _restoring = true;
  try {
    const view = getView();
    const t = view ? { ...view.transform } : null;
    await loadGraph(JSON.parse(json) as SavedGraph, { curtain: false });
    if (view && t) {
      await view.pan(t.x, t.y);
      await view.zoom(t.k);
    }
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
    const s = capture();
    _stack = s ? [{ json: s, time: Date.now(), label: "Opened" }] : [];
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
    const s = capture();
    const top = _stack[_index];
    if (!s || s === top?.json) return;
    let label = "Edited document";
    if (top) {
      try {
        const prev = JSON.parse(top.json) as SavedGraph;
        const next = JSON.parse(s) as SavedGraph;
        if (sameIgnoringDims(prev, next)) return;
        label = describeGraphDelta(prev, next);
      } catch { /* a label is cosmetic — never block the record */ }
    }
    _stack = _stack.slice(0, _index + 1);
    _stack.push({ json: s, time: Date.now(), label });
    if (_stack.length > MAX_DEPTH) _stack.shift();
    let bytes = _stack.reduce((n, e) => n + e.json.length * 2, 0);
    while (_stack.length > 1 && bytes > MAX_BYTES) bytes -= _stack.shift()!.json.length * 2;
    _index = _stack.length - 1;
  },

  canUndo: (): boolean => _index > 0,
  canRedo: (): boolean => _index < _stack.length - 1,

  async undo(): Promise<void> {
    if (_restoring) return;
    if (_timer) flowHistory.recordNow();
    if (_index <= 0) return;
    _index--;
    await restore(_stack[_index].json);
  },

  async redo(): Promise<void> {
    if (_restoring) return;
    if (_timer) flowHistory.recordNow();
    if (_index >= _stack.length - 1) return;
    _index++;
    await restore(_stack[_index].json);
  },

  records: (): Array<{ time: number; label: string }> =>
    _stack.slice(1, _index + 1).map(({ time, label }) => ({ time, label })),

  _state: () => ({ depth: _stack.length, index: _index }),
  _stack: () => _stack,
};

if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as { __flowHistory?: typeof flowHistory }).__flowHistory = flowHistory;
}

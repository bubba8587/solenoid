// React Flow port (C5) — snapshot undo/redo for the flow surface, replacing
// rete-history-plugin. Every settled mutation records the canonical document
// (serializeGraph — the textForm round-trip), so undo needs no per-action
// inverse: restore = loadGraph with the camera held. The stack clears on a
// document load (the setClearHistory slot), never on its own restores.
import { serializeGraph, loadGraph, scheduleAutosave } from "../persistence";
import type { SavedGraph } from "../persistence";
import { getArea, isGraphRebuilding } from "../process";

const MAX_DEPTH = 80;
const COALESCE_MS = 400;

let _stack: string[] = []; // JSON — also the cheap no-op-change comparison
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
    const area = getArea();
    const t = area ? { ...area.area.transform } : null;
    await loadGraph(JSON.parse(json) as SavedGraph);
    // loadGraph frames the graph (zoomAt); an undo must NOT move the camera.
    if (area && t) {
      await area.area.translate(t.x, t.y);
      await area.area.zoom(t.k);
    }
    // The restored state is the document now — persist it.
    scheduleAutosave();
  } finally {
    _restoring = false;
  }
}

export const flowHistory = {
  /** Baseline on document load — registered as the setClearHistory slot, so
   *  loadGraph's own end-of-load clear seeds the new document's baseline.
   *  Restores skip it (their loadGraph must not wipe the stack). */
  reset(): void {
    if (_restoring) return;
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    const s = capture();
    _stack = s ? [s] : [];
    _index = _stack.length - 1;
  },

  /** Debounced record after a mutation settles (graphChanged, drag stop…). */
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
    if (!s || s === _stack[_index]) return;
    _stack = _stack.slice(0, _index + 1);
    _stack.push(s);
    if (_stack.length > MAX_DEPTH) _stack.shift();
    _index = _stack.length - 1;
  },

  canUndo: (): boolean => _index > 0,
  canRedo: (): boolean => _index < _stack.length - 1,

  async undo(): Promise<void> {
    if (_restoring) return;
    if (_timer) flowHistory.recordNow(); // flush the pending edit first
    if (_index <= 0) return;
    _index--;
    await restore(_stack[_index]);
  },

  async redo(): Promise<void> {
    if (_restoring) return;
    if (_index >= _stack.length - 1) return;
    _index++;
    await restore(_stack[_index]);
  },

  /** Test hook. */
  _state: () => ({ depth: _stack.length, index: _index }),
};

// [[C77]] compositeIsSubgraph. Mechanics: tree/specs/canvas/composite-drill-in-mount-lifecycle.md.
import { createNotifier } from "./storeKit";
import type { CompositeNode } from "./nodes/composite";

// A stack of instances, not ids: a nested composite is not in the main editor, so an id could not resolve. Recompute retargets stack[0].

let _stack: CompositeNode[] = [];
const { notify, subscribe, version } = createNotifier();
// The open drill-in's port adder, for chrome outside it (the phone's bottom bar); set while a drill-in is mounted.
let _addPort: ((kind: "input" | "output") => void) | null = null;

export const compositeEditorStore = {
  version,
  subscribe,
  isOpen: (): boolean => _stack.length > 0,
  stack: (): readonly CompositeNode[] => _stack,
  current: (): CompositeNode | null => _stack[_stack.length - 1] ?? null,
  currentId: (): string | null => _stack[_stack.length - 1]?.id ?? null,
  open(node: CompositeNode) {
    if (_stack.length === 1 && _stack[0] === node) return;
    _stack = [node];
    notify();
  },
  drillInto(node: CompositeNode) {
    if (_stack[_stack.length - 1] === node) return;
    _stack = [..._stack, node];
    notify();
  },
  backTo(i: number) {
    if (i < 0) { this.close(); return; }
    if (i >= _stack.length - 1) return;
    _stack = _stack.slice(0, i + 1);
    notify();
  },
  close() {
    if (_stack.length === 0) return;
    _stack = [];
    notify();
  },
  /** Returns the unregister, which clears the slot only while it still holds this adder. */
  registerAddPort(fn: (kind: "input" | "output") => void): () => void {
    _addPort = fn;
    return () => { if (_addPort === fn) _addPort = null; };
  },
  addPort(kind: "input" | "output") { _addPort?.(kind); },
};

// process.ts ticks this after every pass: the drill-in overlay re-renders its inner views on it, and config-derived readouts (column pickers) re-resolve.
const pass = createNotifier();
export const compositePassStore = {
  version: pass.version,
  subscribe: pass.subscribe,
  notify: pass.notify,
};

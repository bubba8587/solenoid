// [[C77]] compositeIsSubgraph. Mechanics: tree/specs/canvas/composite-drill-in-mount-lifecycle.md.
import { createNotifier } from "./storeKit";
import type { CompositeNode } from "./nodes/composite";

// A stack of instances, not ids: a nested composite is not in the main editor, so an id could not resolve. Recompute retargets stack[0].

let _stack: CompositeNode[] = [];
const { notify, subscribe, version } = createNotifier();

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
};

// process.ts ticks this after every pass; only the overlay knows its own area plugin, so nothing else can update the internal views.
const pass = createNotifier();
export const compositePassStore = {
  version: pass.version,
  subscribe: pass.subscribe,
  notify: pass.notify,
};

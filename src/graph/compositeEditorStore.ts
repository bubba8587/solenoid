import { createNotifier } from "./storeKit";
import type { CompositeNode } from "./nodes/composite";

// A breadcrumb STACK of CompositeNode INSTANCES — a nested composite isn't in the main
// editor, so an id couldn't resolve; recompute always retargets stack[0].

let _stack: CompositeNode[] = [];
const { notify, subscribe, version } = createNotifier();

export const compositeEditorStore = {
  version,
  subscribe,
  isOpen: (): boolean => _stack.length > 0,
  /** The whole breadcrumb, root-first. */
  stack: (): readonly CompositeNode[] => _stack,
  /** The composite currently being edited (deepest level), or null. */
  current: (): CompositeNode | null => _stack[_stack.length - 1] ?? null,
  currentId: (): string | null => _stack[_stack.length - 1]?.id ?? null,
  /** Open from the MAIN canvas — resets to a single level. */
  open(node: CompositeNode) {
    if (_stack.length === 1 && _stack[0] === node) return;
    _stack = [node];
    notify();
  },
  /** Drill one level DEEPER, into a composite nested in the current one. */
  drillInto(node: CompositeNode) {
    if (_stack[_stack.length - 1] === node) return;
    _stack = [..._stack, node];
    notify();
  },
  /** Jump to breadcrumb level `i` (0-based), dropping everything below it. */
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

// process.ts ticks this after every pass: only the overlay knows its own area plugin,
// so nothing else can update the internal views.
const pass = createNotifier();
export const compositePassStore = {
  version: pass.version,
  subscribe: pass.subscribe,
  notify: pass.notify,
};

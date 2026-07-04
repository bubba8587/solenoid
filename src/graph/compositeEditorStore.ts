import { createNotifier } from "./storeKit";
import type { CompositeNode } from "./nodes/composite";

// Drill-in state for the Composite editor (components/CompositeEditorOverlay.tsx)
// — a module-level singleton (like reportStore) so the CompositeNode card (rete's
// separate React root), the node context menu, and the main app root can all
// drive it.
//
// It's a BREADCRUMB STACK, not a single id: entry 0 is a composite on the main
// canvas; each deeper entry is a composite found INSIDE the previous one's
// internal graph (nested composites). This is what makes multi-layer drill-in +
// quick drill-up work, and it hands the editor the whole ancestor chain for free:
//   • recompute always retargets stack[0] (the main-editor ancestor), so an edit
//     any levels deep still ripples out correctly;
//   • a level's PARENT editor is stack[i-1]'s internal editor (or the main editor
//     at level 0) — the surface a closed level reconciles its ports against.
// We hold the CompositeNode INSTANCES (a nested composite isn't in the main
// editor, so an id alone couldn't be resolved).

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

// Recompute ticker: process.ts notifies after every completed graph pass so
// an OPEN drill-in editor can re-render its internal nodes' value boxes (the
// outer pass recomputes the composite, which recomputes the internal graph —
// but only the overlay knows about its own area plugin, so process.ts can't
// area.update the internal views itself).
const pass = createNotifier();
export const compositePassStore = {
  version: pass.version,
  subscribe: pass.subscribe,
  notify: pass.notify,
};

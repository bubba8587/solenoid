import type { AreaPlugin } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import { canvasLockStore } from "./canvasLock";
import { resetPointerCensus } from "./pointerGesture";
import { touchSelectStore } from "./touchSelectStore";

// The other half of the node drag guard (installNodeDragGuard): a touch press on an
// UNSELECTED node is made drag-transparent so it falls through to a pan, which means the
// node can only be picked on pointerup, once the gesture is known to be one stationary
// finger and not the first half of a pinch. This census tracks what that pointerup
// decision needs. Both editing surfaces install it, or an unselected card is untouchable
// on touch. Full mechanics: docs/subsystem-invariants.md § Pointer gestures.

export type TapCensus = {
  // The node under a single touch press; null for a form-control target, whose owning node
  // is parked in tapControlNodeId instead (a control tap edits the control, not selection).
  tapNodeId: string | null;
  tapControlNodeId: string | null;
  tapMoved: boolean;
  // ≥2 contacts were seen this gesture — a pinch must never select.
  gestureMulti: boolean;
  // The first contact was a finger; a mouse/pen can't pinch and keeps select-and-drag.
  tapTouch: boolean;
  tapOnCanvas: boolean;
};

export function createTapCensus(): TapCensus {
  return {
    tapNodeId: null,
    tapControlNodeId: null,
    tapMoved: false,
    gestureMulti: false,
    tapTouch: false,
    tapOnCanvas: false,
  };
}

/** Install the shared touch tap-to-select for one editing surface: the window-capture
 *  pointer census plus the pointerup branch that selects a drag-transparent unselected
 *  node. The census object is mutated in place, so a surface's own area pipe can read it
 *  for sibling concerns (Canvas's off-canvas swallow and form-control tap). Returns a
 *  disposer that removes the window listeners; the area pipe dies with the area. */
export function installTapSelect(opts: {
  area: AreaPlugin<Schemes, AreaExtra>;
  editor: NodeEditor<Schemes>;
  container: HTMLElement;
  census: TapCensus;
  select: (id: string, accumulate: boolean) => void;
}): () => void {
  const { area, editor, container, census, select } = opts;
  const set = new Set<number>();
  let startX = 0, startY = 0;

  const isSelected = (id: string | null) =>
    !!(id && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected);

  const nodeAndControl = (t: EventTarget | null): { id: string | null; formControl: boolean } => {
    if (!(t instanceof Element)) return { id: null, formControl: false };
    const formControl = !!t.closest("input, select, textarea, button, [contenteditable]");
    for (const [id, v] of area.nodeViews) if (v.element.contains(t)) return { id, formControl };
    return { id: null, formControl };
  };

  const add = (e: PointerEvent) => {
    set.add(e.pointerId);
    if (set.size === 1) {
      census.gestureMulti = false;
      census.tapMoved = false;
      startX = e.clientX; startY = e.clientY;
      census.tapTouch = e.pointerType === "touch";
      const { id, formControl } = census.tapTouch
        ? nodeAndControl(e.target)
        : { id: null, formControl: false };
      census.tapNodeId = formControl ? null : id;
      census.tapControlNodeId = formControl ? id : null;
      census.tapOnCanvas = !!(e.target instanceof Node && container.contains(e.target));
    } else if (set.size >= 2) {
      census.gestureMulti = true;
    }
  };
  const move = (e: PointerEvent) => {
    if (set.size === 0) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) census.tapMoved = true;
  };
  const drop = (e: PointerEvent) => {
    set.delete(e.pointerId);
    if (set.size === 0) {
      // rete drops its window pointerup on the FIRST release, stranding later pinch
      // pointers in the zoom handler and breaking the next pinch.
      const zh = (area.area as unknown as
        { zoomHandler?: { pointers?: unknown[]; previous?: unknown } } | undefined)?.zoomHandler;
      if (zh && Array.isArray(zh.pointers)) { zh.pointers.length = 0; zh.previous = null; }
      // This set going empty is the authoritative "every contact is up", so anything the
      // census still holds was stranded and would read as multi-touch.
      resetPointerCensus();
    }
  };
  window.addEventListener("pointerdown", add, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", drop, true);
  window.addEventListener("pointercancel", drop, true);

  area.addPipe((ctx) => {
    if (ctx && typeof ctx === "object" && "type" in ctx &&
        (ctx as { type: string }).type === "pointerup") {
      // Tap-to-select for a drag-transparent unselected node, deferred to pointerup so the
      // gesture is classifiable — !gestureMulti is what stops a PINCH from ever selecting.
      if (
        census.tapTouch &&
        !canvasLockStore.get() &&
        census.tapNodeId &&
        !census.tapMoved &&
        !census.gestureMulti &&
        !isSelected(census.tapNodeId)
      ) {
        const id = census.tapNodeId;
        census.tapNodeId = null;
        select(id, touchSelectStore.get());
        return; // stop the background-tap deselect
      }
    }
    return ctx;
  });

  return () => {
    window.removeEventListener("pointerdown", add, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", drop, true);
    window.removeEventListener("pointercancel", drop, true);
    set.clear();
  };
}

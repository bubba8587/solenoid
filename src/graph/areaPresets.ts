import { Presets as ReactPresets } from "rete-react-plugin";
import { ClassicFlow, getSourceTarget } from "rete-connection-plugin";
import { Zoom, type AreaPlugin } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import { getGuardedSocketPosition } from "./guardedSocketPosition";
import { componentForNode } from "./nodeRegistry";
import { SocketComponent } from "./components/SocketComponent";
import { ConnectionComponent } from "./components/ConnectionComponent";
import { SolenoidSocket } from "./sockets";
import { canvasLockStore } from "./canvasLock";

// ─── Shared editing-area presets ────────────────────────────────────────────────
// The rete render + connection config that MUST be identical across every editing
// surface: the MAIN canvas (Canvas.tsx) and every surface that substitutes for it
// (the Composite drill-in in CompositeEditorOverlay's getDrillMount; future
// focus/scratch canvases). These were hand-copied into both before — and had
// already drifted (the drill-in's connection flow was missing the canvas-lock
// veto). One source so a socket-render or connection-rule change can't silently
// apply to the main canvas but not the subgraph. See activeGraph.ts for the
// behavioral half of the canvas-substitution seam.

// Zoom feel — proportional + clamped wheel (rete's stock Zoom applies a fixed
// ±intensity per wheel event, so a trackpad pinch races while a mouse notch crawls).
const ZOOM_SCALE = 0.0028;
const ZOOM_STEP_CAP = 0.24;
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px
const WHEEL_PAGE_PX = 400; // deltaMode 2 (pages) → px

/**
 * Custom zoom handler: proportional + clamped wheel, and a pinch that CANNOT be
 * vetoed. Shared by the main canvas and every canvas-substituting surface (the
 * composite drill-in).
 *
 * ── THE PINCH-PRIORITY RULE ────────────────────────────────────────────────────
 * Stock `Zoom` counts fingers from a BUBBLE-phase `pointerdown` on the container,
 * and `Zoom.move` is a `.map` over the pointers it already has — never an upsert.
 * So a finger whose pointerdown was swallowed anywhere below the container is
 * invisible to the zoom handler for the WHOLE gesture, with no recovery: two
 * fingers, one counted, `isTranslating()` false, no zoom. Every
 * `onPointerDown={(e) => e.stopPropagation()}` inside a node was therefore a
 * pinch-blocker, which is why a pinch died over most of the FC node, the
 * connection nodes and every inline field.
 *
 * The fix is positional, not a sweep: register the finger count in CAPTURE, which
 * runs before the target phase and so cannot be stopped. That splits the two
 * gestures by listener phase, permanently:
 *
 *   • PINCH  — capture phase. Unstoppable. A control cannot break a zoom.
 *   • PAN / node drag — bubble phase. Vetoable, and SHOULD be: a control that
 *     wants the pointer for itself keeps calling `stopPropagation()` and still
 *     gets to suppress the pan (rete's `Drag` stays bubble-phase, untouched).
 *
 * That's the invariant to preserve: never move the pan handler to capture, and
 * never move the zoom count back to bubble.
 */
export class CappedZoom extends Zoom {
  /**
   * Count only real FINGERS toward a pinch — not a mouse, not a stylus.
   *
   * Stock rete pushes every pointerdown regardless of type. That was harmless while
   * this ran in bubble phase behind a hundred `stopPropagation`s; in capture phase it
   * is not, because now every contact really does arrive. A stylus resting on the
   * glass plus one finger would otherwise read as two pointers and zoom. Mirrors
   * `isPinching()` (pointerGesture.ts), the single definition of the gesture.
   */
  protected down = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    this.pointers.push(e);
  };

  /** Re-seat the finger count from BUBBLE to CAPTURE. `super.initialize` binds every
   *  stock listener (wheel, dblclick, the window move/up pair) — we keep all of them
   *  and move only `down`, so nothing else about the handler's behavior changes. The
   *  listener reference is this subclass's `down`, so the remove matches. */
  initialize(
    container: HTMLElement,
    element: HTMLElement,
    onzoom: (delta: number, ox: number, oy: number, source?: "wheel" | "touch" | "dblclick") => void,
  ): void {
    super.initialize(container, element, onzoom);
    container.removeEventListener("pointerdown", this.down);
    container.addEventListener("pointerdown", this.down, true);
  }

  /** Stock `destroy` removes `pointerdown` WITHOUT the capture flag, which does not
   *  match a capture listener — so the base teardown would leave ours attached and
   *  every drill-in open/close would stack another. Remove the one we actually
   *  added; `super.destroy()` handles the rest (its own no-op remove is harmless). */
  destroy(): void {
    this.container.removeEventListener("pointerdown", this.down, true);
    super.destroy();
  }

  protected wheel = (e: WheelEvent) => {
    e.preventDefault();
    const px =
      e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX
      : e.deltaMode === 2 ? e.deltaY * WHEEL_PAGE_PX
      : e.deltaY;
    let delta = -px * ZOOM_SCALE; // scroll up / pinch out → zoom in
    if (delta > ZOOM_STEP_CAP) delta = ZOOM_STEP_CAP;
    else if (delta < -ZOOM_STEP_CAP) delta = -ZOOM_STEP_CAP;
    const el = (this as unknown as { element: HTMLElement }).element;
    const { left, top } = el.getBoundingClientRect();
    const ox = (left - e.clientX) * delta;
    const oy = (top - e.clientY) * delta;
    (this as unknown as { onzoom: (d: number, ox: number, oy: number, s: string) => void })
      .onzoom(delta, ox, oy, "wheel");
  };
}

/** Install the pointer/zoom behavior every editing surface needs, so a substituting
 *  surface (the drill-in) matches the main canvas: the capped proportional zoom + the
 *  double-click-to-zoom SUPPRESSION (rete's Zoom attaches its dblclick handler to the
 *  container in bubble phase; a capture-phase swallow stops it). Returns a cleanup fn. */
export function installSurfacePointer(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): () => void {
  area.area.setZoomHandler(new CappedZoom(0.1));
  const swallowDblClick = (e: Event) => { e.stopImmediatePropagation(); };
  container.addEventListener("dblclick", swallowDblClick, true);
  return () => container.removeEventListener("dblclick", swallowDblClick, true);
}

/** The classic React render preset: our node/socket/connection components + the
 *  identity socket-position offset (our sockets sit centered ON the node border,
 *  not pushed 12px outside it like rete's default). */
export function solenoidClassicRenderSetup() {
  return ReactPresets.classic.setup({
    socketPositionWatcher: getGuardedSocketPosition({ offset: (p) => p }),
    customize: {
      node({ payload }) {
        return componentForNode(payload);
      },
      socket() {
        return SocketComponent;
      },
      connection() {
        return ConnectionComponent;
      },
    },
  });
}

/** The connection flow with our compatibility gate: veto a drop BEFORE
 *  makeConnection runs (so an incompatible drop can't evict a valid cable),
 *  reject self-loops, and refuse all wiring while the canvas is locked. Checks the
 *  sockets of `editor` — pass the surface's own editor. */
export function makeSolenoidConnectionFlow(editor: NodeEditor<Schemes>) {
  return new ClassicFlow({
    canMakeConnection(initial, socket) {
      if (canvasLockStore.get()) return false; // view-only when locked
      const st = getSourceTarget(initial, socket);
      if (!st) return false;
      const [source, target] = st;
      if (source.nodeId === target.nodeId) return false; // no output → own input
      const srcSocket = editor.getNode(source.nodeId)?.outputs[source.key]?.socket;
      const tgtSocket = editor.getNode(target.nodeId)?.inputs[target.key]?.socket;
      if (srcSocket instanceof SolenoidSocket && tgtSocket instanceof SolenoidSocket) {
        return srcSocket.canConnectTo(tgtSocket);
      }
      return true;
    },
  });
}

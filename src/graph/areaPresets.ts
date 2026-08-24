import { Presets as ReactPresets } from "rete-react-plugin";
import { ClassicFlow, getSourceTarget } from "rete-connection-plugin";
import { Zoom, type AreaPlugin } from "rete-area-plugin";
import type { NodeEditor } from "rete";
import type { Schemes, AreaExtra } from "./schemes";
import { getGuardedSocketPosition } from "./guardedSocketPosition";
import { componentForNode } from "./nodeRegistry";
import { withNodeBoundary } from "./components/ErrorBoundary";
import { SocketComponent } from "./components/SocketComponent";
import { ConnectionComponent } from "./components/ConnectionComponent";
import { SolenoidSocket } from "./sockets";
import { canvasLockStore } from "./canvasLock";
import { DOT_SPACING } from "./gridSnapStore";
import { isPinching } from "./pointerGesture";
import { syncSemanticZoomFor } from "./semanticZoomStore";

// The rete render + connection config that MUST be identical across every editing surface,
// so a socket-render or connection-rule change can't apply to the canvas but not a subgraph.

// Proportional + clamped wheel: rete's stock fixed ±intensity races on a trackpad pinch and
// crawls on a mouse notch.
const ZOOM_SCALE = 0.0028;
const ZOOM_STEP_CAP = 0.24;
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px
const WHEEL_PAGE_PX = 400; // deltaMode 2 (pages) → px

// The scale floor/ceiling. Clamped in the area's `zoom` guard (below) so wheel, pinch,
// double-tap AND programmatic zoomAt all land inside the range — past the floor the dot
// grid is long gone and cards are specks; past the ceiling a card fills the viewport.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 2.5;
export const clampZoom = (k: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

/** THE PINCH-PRIORITY RULE: the finger count registers in CAPTURE phase so nothing below the
 * container can break a pinch, while pan and node-drag stay in BUBBLE so a control CAN veto
 * them — never move either. */
export class CappedZoom extends Zoom {
  /** Only real FINGERS count: in capture phase every contact arrives, so a resting stylus
  *  plus a finger would otherwise read as a pinch. Mirrors `isPinching()`. */
  protected down = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    this.pointers.push(e);
  };

  /** Re-seat the finger count from BUBBLE to CAPTURE, moving only `down` so every other
   *  stock listener `super.initialize` bound is untouched. */
  initialize(
    container: HTMLElement,
    element: HTMLElement,
    onzoom: (delta: number, ox: number, oy: number, source?: "wheel" | "touch" | "dblclick") => void,
  ): void {
    super.initialize(container, element, onzoom);
    container.removeEventListener("pointerdown", this.down);
    container.addEventListener("pointerdown", this.down, true);
  }

  /** Stock `destroy` removes `pointerdown` WITHOUT the capture flag, so it never matches
   *  ours and every drill-in open/close would stack another listener. */
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

/** `area.pointer` — where the connection plugin renders a picked pseudo-cable's free
 *  end — updates from the container's BUBBLE pointerdown, which a socket press
 *  stops (it must, or picking a socket would drag the node). Desktop hover
 *  mousemoves hide that; on touch there is no hover, so the ghost cable rendered
 *  from the origin socket to the PREVIOUS gesture's last position until the finger
 *  moved. Same disease as the pinch count, same cure: position bookkeeping is
 *  re-seated in CAPTURE, where stopPropagation can't starve it. */
export function seatAreaPointerInCapture(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): () => void {
  const seat = (e: PointerEvent) =>
    (area.area as unknown as { setPointerFrom(ev: PointerEvent): void }).setPointerFrom(e);
  container.addEventListener("pointerdown", seat, true);
  return () => container.removeEventListener("pointerdown", seat, true);
}

/** Install the pointer/zoom behavior every editing surface needs; the double-click-to-zoom
 *  suppression works by swallowing in capture, since rete binds its dblclick in bubble. */
export function installSurfacePointer(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): () => void {
  area.area.setZoomHandler(new CappedZoom(0.1));
  // Clamp the TARGET scale in the guard, before the area applies it: rete recomputes the
  // origin-pan factor from the (clamped) result, so pinning at a limit leaves no drift.
  area.addPipe((ctx) => {
    if (ctx?.type === "zoom") ctx.data.zoom = clampZoom(ctx.data.zoom);
    return ctx;
  });
  const swallowDblClick = (e: Event) => { e.stopImmediatePropagation(); };
  container.addEventListener("dblclick", swallowDblClick, true);
  const unseat = seatAreaPointerInCapture(area, container);
  return () => {
    container.removeEventListener("dblclick", swallowDblClick, true);
    unseat();
  };
}

// Last values written per surface. A PAN moves only the phase — re-writing the tile size
// and the fade every pointermove invalidates the background for nothing, and this runs
// synchronously with the holder transform (rAF-deferring it would shear the grid off the
// nodes it is supposed to be pinned to, so trimming the writes is the lever available).
const lastBackground = new WeakMap<HTMLElement, { size: string; pos: string; pct: string }>();

/** Track the dot grid to the camera: the tile scales with `k` and the phase follows the
 *  pan, so the dots stay pinned to world coordinates (which is what grid snap lands on).
 *  Below k≈0.55 they fade out rather than collapsing into noise. */
export function syncSurfaceBackground(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  const { x, y, k } = area.area.transform;
  const tile = DOT_SPACING * k;
  const size = `${tile}px ${tile}px`;
  const pos = `${x}px ${y}px`;
  const fade = Math.max(0, Math.min(1, (k - 0.18) / (0.55 - 0.18)));
  const pct = `${Math.round(fade * 100)}%`;
  const prev = lastBackground.get(container);
  if (prev?.size !== size) container.style.backgroundSize = size;
  if (prev?.pos !== pos) container.style.backgroundPosition = pos;
  if (prev?.pct !== pct) container.style.setProperty("--dot-pct", pct);
  lastBackground.set(container, { size, pos, pct });
}

/** Keep the grid synced for the life of the surface, and seed it once now. */
export function installSurfaceBackground(
  area: AreaPlugin<Schemes, AreaExtra>,
  container: HTMLElement,
): void {
  area.addPipe((ctx) => {
    if (ctx?.type === "translated" || ctx?.type === "zoomed") syncSurfaceBackground(area, container);
    return ctx;
  });
  syncSurfaceBackground(area, container);
}

/** Drive the far-zoom card simplification from THIS surface's camera. The class is
 *  global (one root-level toggle, so plain CSS does the swap), so whichever surface the
 *  user is actually zooming must own it — otherwise a subgraph pinch paints every card
 *  in full detail while the class still reflects the camera behind the overlay. */
export function installSurfaceSemanticZoom(area: AreaPlugin<Schemes, AreaExtra>): void {
  area.addPipe((ctx) => {
    if (ctx?.type === "zoomed") syncSemanticZoomFor(area.area.transform.k);
    return ctx;
  });
}

/** Never move a node while pinching — the same veto the main canvas applies, needed on
 *  every surface or two fingers landing on a card smear it instead of zooming.
 *  `isPinching()` counts FINGERS, so a stylus resting alongside one can't freeze a drag. */
export function installPinchTranslateVeto(area: AreaPlugin<Schemes, AreaExtra>): void {
  area.addPipe((ctx) => {
    if (ctx?.type === "nodetranslate" && isPinching()) return;
    return ctx;
  });
}

/** The node drag-handler guard, shared by every editing surface: rete picks a node on
 *  pointerdown because the drag depends on it, so a press that turns out to be the first
 *  half of a pinch would otherwise grab whatever it landed on. Making an unselected node
 *  drag-transparent to TOUCH resolves it structurally — the press falls through to a pan,
 *  and selection lands on pointerup instead (installTapSelect). A locked canvas never
 *  drags; a non-primary mouse/pen button never drags; a second finger mid-gesture is a
 *  pinch. rete stopPropagations only AFTER this guard, so a false guard lets the press
 *  bubble to the area = pan. `groupBand` is the caller's escape hatch for surface-specific
 *  geometry (Canvas's expanded-group edge band) — areaPresets must not import GroupNode.
 *  Returns the per-node patcher to call from a `nodecreated` pipe (next frame, once the
 *  view exists). Full rationale: docs/subsystem-invariants.md § Pointer gestures. */
export function installNodeDragGuard(
  area: AreaPlugin<Schemes, AreaExtra>,
  editor: NodeEditor<Schemes>,
  opts: {
    groupBand?: (
      id: string,
      e: PointerEvent,
      view: { element?: HTMLElement } | undefined,
    ) => boolean | undefined;
  } = {},
): (id: string) => void {
  const isSelected = (id: string | null) =>
    !!(id && (editor.getNode(id) as { selected?: boolean } | undefined)?.selected);
  return (id: string) => {
    const view = area.nodeViews.get(id) as unknown as
      { dragHandler?: { guards?: { down?: (e: PointerEvent) => boolean } }; element?: HTMLElement } | undefined;
    const guards = view?.dragHandler?.guards;
    if (!guards) return;
    guards.down = (e: PointerEvent) => {
      if (canvasLockStore.get()) return false;
      // Touch ONLY — a mouse or pen can't pinch and keeps select-and-drag in one motion.
      if (e.pointerType === "touch" && !isSelected(id)) return false;
      // A stylus reports its barrel button and eraser end as non-zero `button`; neither
      // should grab a node, same as a non-left mouse button.
      if ((e.pointerType === "mouse" || e.pointerType === "pen") && e.button !== 0) return false;
      // A second finger arriving mid-gesture is a pinch, which outranks a new drag.
      if (isPinching()) return false;
      const band = opts.groupBand?.(id, e, view);
      if (band !== undefined) return band;
      return true;
    };
  };
}

/** The classic React preset with an IDENTITY socket-position offset — our sockets sit
 *  centered ON the node border, not pushed 12px outside it like rete's default. */
export function solenoidClassicRenderSetup() {
  return ReactPresets.classic.setup({
    socketPositionWatcher: getGuardedSocketPosition({ offset: (p) => p }),
    customize: {
      node({ payload }) {
        // Boundaried per NODE: rete gives each node its own React root, so an unguarded
        // throw in one card's render blanks the whole canvas and names no culprit.
        return withNodeBoundary(componentForNode(payload));
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

/** Vetoes a drop BEFORE makeConnection runs, so an incompatible drop can't evict a valid
 *  cable; also rejects self-loops and all wiring while locked. Pass the surface's editor. */
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

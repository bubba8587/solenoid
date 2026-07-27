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

/** Custom zoom handler: proportional + clamped wheel, stock pinch/dblclick. Shared by
 *  the main canvas and every canvas-substituting surface (the composite drill-in). */
export class CappedZoom extends Zoom {
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

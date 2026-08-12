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

// The rete render + connection config that MUST be identical across every editing surface,
// so a socket-render or connection-rule change can't apply to the canvas but not a subgraph.

// Proportional + clamped wheel: rete's stock fixed ±intensity races on a trackpad pinch and
// crawls on a mouse notch.
const ZOOM_SCALE = 0.0028;
const ZOOM_STEP_CAP = 0.24;
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px
const WHEEL_PAGE_PX = 400; // deltaMode 2 (pages) → px

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
  const swallowDblClick = (e: Event) => { e.stopImmediatePropagation(); };
  container.addEventListener("dblclick", swallowDblClick, true);
  const unseat = seatAreaPointerInCapture(area, container);
  return () => {
    container.removeEventListener("dblclick", swallowDblClick, true);
    unseat();
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

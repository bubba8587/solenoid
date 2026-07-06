import { Presets as ReactPresets } from "rete-react-plugin";
import { ClassicFlow, getSourceTarget } from "rete-connection-plugin";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { getGuardedSocketPosition } from "./guardedSocketPosition";
import { NODE_COMPONENTS } from "./nodeRegistry";
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

/** The classic React render preset: our node/socket/connection components + the
 *  identity socket-position offset (our sockets sit centered ON the node border,
 *  not pushed 12px outside it like rete's default). */
export function solenoidClassicRenderSetup() {
  return ReactPresets.classic.setup({
    socketPositionWatcher: getGuardedSocketPosition({ offset: (p) => p }),
    customize: {
      node({ payload }) {
        const hit = NODE_COMPONENTS.find(([Ctor]) => payload instanceof Ctor);
        return hit ? hit[1] : null;
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

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { overlayBus } from "../overlayTransform";
import { useRenderMode, renderModeStore } from "../renderMode";
import { appThemeStore } from "../appTheme";
import { GpuNodeRenderer } from "../gpuNodeRenderer";
import { nodeGeomBus, collectNodeCards } from "../nodeScene";
import { createToggleStore } from "../storeKit";
import type { NodeCard } from "../nodeInstances";

// Semi-transparent so the real DOM node shows THROUGH the GPU card — that is how
// the alignment check works.
const DEBUG_ALPHA = 0.55;
function dim(cards: NodeCard[]): NodeCard[] {
  return cards.map((c) => ({
    ...c,
    body: { ...c.body, a: c.body.a * DEBUG_ALPHA },
    header: { ...c.header, a: c.header.a * DEBUG_ALPHA },
  }));
}

// WebGPU node-card ALIGNMENT-CHECK overlay, not a render path: off by default,
// toggled from the console via `__solenoidNodeCards()` with canvas render-mode on.

export const nodeCardsDebugStore = createToggleStore(false);
if (typeof window !== "undefined") {
  (window as unknown as { __solenoidNodeCards?: () => boolean }).__solenoidNodeCards =
    () => { nodeCardsDebugStore.toggle(); return nodeCardsDebugStore.get(); };
}

export function NodeCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GpuNodeRenderer | null>(null);
  const failedRef = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const mode = useRenderMode();
  const debug = useSyncExternalStore(nodeCardsDebugStore.subscribe, nodeCardsDebugStore.get);
  const state = useSyncExternalStore(overlayBus.subscribe, overlayBus.get);
  const geomV = useSyncExternalStore(nodeGeomBus.subscribe, nodeGeomBus.version);
  const themeV = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  const on = mode === "canvas" && debug;

  useEffect(() => { setHost(document.querySelector<HTMLElement>(".solenoid-canvas")); }, []);

  useEffect(() => {
    if (!on) return;
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current || failedRef.current) return;
    let canceled = false;
    const onLost = () => { failedRef.current = true; rendererRef.current = null; renderModeStore.set("dom"); };
    void GpuNodeRenderer.create(canvas, onLost).then((r) => {
      if (canceled) { r?.dispose(); return; }
      if (!r) { failedRef.current = true; return; }
      rendererRef.current = r;
      const { viewport, dpr, transform } = overlayBus.get();
      r.setNodes(dim(collectNodeCards()));
      r.resize(viewport.width, viewport.height, dpr);
      r.draw(transform, viewport.width, viewport.height);
    });
    return () => {
      canceled = true;
      const r = rendererRef.current;
      if (r) {
        const { viewport, transform } = overlayBus.get();
        r.clearAndDispose(transform, viewport.width, viewport.height);
        rendererRef.current = null;
      }
    };
  }, [on]);

  useEffect(() => {
    if (!on) return;
    const r = rendererRef.current;
    if (!r) return;
    r.setNodes(dim(collectNodeCards()));
    const { viewport, transform } = overlayBus.get();
    r.draw(transform, viewport.width, viewport.height);
  }, [geomV, themeV, on]);

  useEffect(() => {
    if (!on) return;
    const r = rendererRef.current;
    if (!r) return;
    const { viewport, dpr, transform } = state;
    r.resize(viewport.width, viewport.height, dpr);
    r.draw(transform, viewport.width, viewport.height);
  }, [state, on]);

  if (!host) return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      className="solenoid-node-canvas"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}
    />,
    host,
  );
}

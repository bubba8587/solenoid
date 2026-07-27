import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { overlayBus } from "../overlayTransform";
import { cableScene } from "../cableScene";
import { useRenderMode, renderModeStore } from "../renderMode";
import { appThemeStore } from "../appTheme";
import { GpuCableRenderer, makeColorResolver } from "../gpuCableRenderer";

// The WebGPU cable layer (desktop Tauri/WebView2). Cable geometry is tessellated +
// uploaded to a GPU buffer once per scene change; pan/zoom only rewrites a uniform
// and submits one draw, so the per-frame pan cost is ~zero. Active only in render-
// mode "canvas" (console __solenoidCanvasCables()); DOM is the default and untouched.
//
// The <canvas> is portaled INTO `.solenoid-canvas` at z-index:-1 (the CableFlourish
// trick) so cables draw behind nodes, above the dot grid. The invisible per-cable hit
// <svg> stays in the DOM, so hover/click/lasso are unchanged. WebGPU init is async;
// if it fails (no adapter / flag off) we fall back to DOM. Selected-above z-jump and
// ghost dashes are follow-ups (all cables draw behind, solid).

export function CableCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GpuCableRenderer | null>(null);
  // Lazy-init the resolver once (a bare useRef(makeColorResolver()) would allocate
  // one every render and discard all but the first).
  const resolverRef = useRef<ReturnType<typeof makeColorResolver> | null>(null);
  if (!resolverRef.current) resolverRef.current = makeColorResolver();
  const failedRef = useRef(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const mode = useRenderMode();
  const state = useSyncExternalStore(overlayBus.subscribe, overlayBus.get);
  const sceneV = useSyncExternalStore(cableScene.subscribe, cableScene.version);
  const themeV = useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);

  useEffect(() => { setHost(document.querySelector<HTMLElement>(".solenoid-canvas")); }, []);

  // Feed the container size + dpr to the bus (self-sufficient; overlayBus dedups).
  useEffect(() => {
    if (!host) return;
    const sync = () => overlayBus.setViewport(host.clientWidth, host.clientHeight, window.devicePixelRatio || 1);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);

  // Create the WebGPU renderer when canvas mode turns on (async); dispose on off /
  // unmount. WebGPU unavailable → fall back to DOM permanently.
  useEffect(() => {
    if (mode !== "canvas") return;
    const canvas = canvasRef.current;
    if (!canvas || rendererRef.current || failedRef.current) return;
    let canceled = false;
    // On device loss, drop the renderer and fall back to DOM so cables reappear.
    const onLost = () => {
      failedRef.current = true;
      rendererRef.current = null;
      // eslint-disable-next-line no-console
      console.warn("[solenoid] WebGPU device lost — falling back to DOM");
      renderModeStore.set("dom");
    };
    void GpuCableRenderer.create(canvas, onLost).then((r) => {
      if (canceled) { r?.dispose(); return; }
      if (!r) {
        failedRef.current = true;
        // eslint-disable-next-line no-console
        console.warn("[solenoid] WebGPU unavailable — staying on DOM (need --enable-unsafe-webgpu?)");
        renderModeStore.set("dom");
        return;
      }
      rendererRef.current = r;
      const { viewport, dpr, transform } = overlayBus.get();
      r.setGeometry(resolverRef.current!);
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
  }, [mode]);

  // Scene OR theme change → rebuild geometry (colors included) + redraw.
  useEffect(() => {
    if (mode !== "canvas") return;
    const r = rendererRef.current;
    if (!r) return;
    resolverRef.current!.clear();
    r.setGeometry(resolverRef.current!);
    const { viewport, transform } = overlayBus.get();
    r.draw(transform, viewport.width, viewport.height);
  }, [sceneV, themeV, mode]);

  // Transform / viewport change → resize + redraw only (the cheap pan/zoom path).
  useEffect(() => {
    if (mode !== "canvas") return;
    const r = rendererRef.current;
    if (!r) return;
    const { viewport, dpr, transform } = state;
    r.resize(viewport.width, viewport.height, dpr);
    r.draw(transform, viewport.width, viewport.height);
  }, [state, mode]);

  if (!host) return null;
  return createPortal(
    <canvas
      ref={canvasRef}
      className="solenoid-cable-canvas"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: -1 }}
    />,
    host,
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { rendererSpikeStore } from "../rendererSpikeStore";
import { Camera, pinchStep, panSweep } from "../pixi/pixiCamera";
import { buildSyntheticScene, buildLiveScene, LOD_SIMPLE_BELOW, FALLBACK_FONTS, type Fonts, type SpikeScene, type TextMode } from "../pixi/pixiScenes";
import { snapshotGraph, readThemeColors, type SnapSocket, type SnapImage } from "../pixi/pixiGraphSnapshot";
import { isLight } from "../pixi/pixiColors";
import { cablePolyline } from "../pixi/pixiCableGeom";
import { ClassicPreset } from "rete";
import { cableShapeStore } from "../cableShape";
import { getArea, getEditor, processGraph } from "../process";
import { APP_LOCALE } from "../locale";
import "./rendererSpike.css";

/**
 * Renderer spike (Pixi) — a proof-of-architecture for the GPU node renderer (see
 * docs/archive/renderer-decision.md). Synthetic and Live (the real rete graph)
 * modes. All interaction is hand-rolled on the canvas. Nothing of the real editor
 * is mutated except node positions on a live drag. pixi.js is dynamic-imported.
 */

const COUNTS = [500, 2000, 5000, 10000] as const;
type Mode = "synthetic" | "live";

const PREFS_KEY = "solenoid.pixiSpike";
function loadPrefs(): Partial<{ mode: Mode; count: number; textMode: TextMode; lodOn: boolean; cullOn: boolean; cablesOn: boolean }> {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; }
}

export function RendererSpike() {
  const open = useSyncExternalStore(rendererSpikeStore.subscribe, rendererSpikeStore.get);
  const hostRef = useRef<HTMLDivElement>(null);
  const prefs0 = useRef(loadPrefs()).current;
  const [mode, setMode] = useState<Mode>(prefs0.mode ?? "synthetic");
  const [count, setCount] = useState<number>(prefs0.count ?? 2000);
  const [textMode, setTextMode] = useState<TextMode>(prefs0.textMode ?? "bitmap");
  const [lodOn, setLodOn] = useState(prefs0.lodOn ?? true);
  const [cullOn, setCullOn] = useState(prefs0.cullOn ?? false);
  const [cablesOn, setCablesOn] = useState(prefs0.cablesOn ?? true);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string>("…");
  const [msdf, setMsdf] = useState<boolean | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [building, setBuilding] = useState(false);
  const [stats, setStats] = useState<{ nodes: number; cables: number; note?: string }>({ nodes: 0, cables: 0 });
  const [bench, setBench] = useState<{ avg: number; min: number } | null>(null);
  const [benching, setBenching] = useState(false);
  // Floating DOM editor (the hidden-input pattern) — rename a live card.
  const [editing, setEditing] = useState<{ id: string; left: number; top: number; width: number; value: string } | null>(null);

  // Refs the Fit button + handlers reach into (set inside the build effect).
  const camRef = useRef<Camera | null>(null);
  const sceneRef = useRef<SpikeScene | null>(null);
  const applyRef = useRef<() => void>(() => {});
  const lodRef = useRef(true);
  const cullRef = useRef(false);
  const cablesRef = useRef(true);
  const selectedRef = useRef<Set<string>>(new Set());
  const selectedCableRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    if (!host) return;

    let canceled = false;
    let app: import("pixi.js").Application | null = null;
    let cleanup: (() => void) | null = null;
    let fpsTimer: number | null = null;

    (async () => {
      try {
      setBuilding(true); setError(null);
      const PIXI = await import("pixi.js");
      if (canceled) return;

      // Theme-faithful colors (sampled from a real node behind the overlay) so the
      // cards + canvas match the live theme instead of a hardcoded dark.
      const theme = readThemeColors();
      const canvasBg = isLight(theme.body) ? 0xeef0f3 : 0x0e1014;

      const canvas = document.createElement("canvas");
      app = new PIXI.Application();
      await app.init({
        canvas, resizeTo: host, antialias: true, backgroundColor: canvasBg,
        preference: "webgpu", powerPreference: "high-performance",
      });
      if (canceled) { app.destroy(true); return; }
      host.appendChild(canvas);
      setBackend(app.renderer.type === PIXI.RendererType.WEBGPU ? "WebGPU" : "WebGL2");
      app.stage.eventMode = "none"; // all interaction is hand-rolled below

      // Load the MSDF atlases (Atkinson Hyperlegible Next + Mono) → crisp text at
      // any zoom. On any failure, keep FALLBACK_FONTS (Pixi's dynamic bitmap font),
      // so text never disappears if an atlas is missing/broken.
      let fonts: Fonts = FALLBACK_FONTS;
      try {
        await PIXI.Assets.load([
          "/fonts/atkinson-next.fnt", "/fonts/atkinson-mono.fnt",
          "/fonts/atkinson-next-bold.fnt", "/fonts/atkinson-mono-bold.fnt",
        ]);
        if (canceled) { app.destroy(true); return; }
        fonts = { sans: "atkinson-next", mono: "atkinson-mono", sansBold: "atkinson-next-bold", monoBold: "atkinson-mono-bold" };
        setMsdf(true);
      } catch { setMsdf(false); }

      const cam = new Camera();
      const W = host.clientWidth, H = host.clientHeight;
      let scene: SpikeScene;
      let chartImages: SnapImage[] = []; // charts render as crisp DOM (hybrid), not GPU textures
      if (mode === "live") {
        const snap = snapshotGraph();
        if (!snap || snap.nodes.length === 0) {
          setStats({ nodes: 0, cables: 0, note: "No nodes in the current graph. Switch to Synthetic, or add nodes first." });
          scene = buildSyntheticScene(PIXI, 0, textMode, theme, fonts);
          cam.fit(scene.bounds, W, H);
        } else {
          scene = buildLiveScene(PIXI, snap, cableShapeStore.get(), textMode, fonts);
          cam.setFromAreaTransform(snap.transform); // match what the user was viewing
          chartImages = snap.nodes.flatMap((n) => n.images);
          setStats({ nodes: scene.nodeCount, cables: scene.cableCount });
        }
      } else {
        scene = buildSyntheticScene(PIXI, count, textMode, theme, fonts);
        cam.fit(scene.bounds, W, H);
        setStats({ nodes: scene.nodeCount, cables: scene.cableCount });
      }
      app.stage.addChild(scene.world);

      // Dot-grid background (matches the canvas) — one GPU-tiled sprite, panned/
      // zoomed via tilePosition/tileScale (cheap, no per-dot redraw).
      const GRID = 24;
      const gridColor = isLight(theme.body) ? 0x000000 : 0xffffff;
      const dotG = new PIXI.Graphics();
      dotG.rect(0, 0, GRID, GRID).fill({ color: 0, alpha: 0 });
      dotG.circle(GRID / 2, GRID / 2, 1.1).fill({ color: gridColor, alpha: 0.35 });
      const dotTex = app.renderer.generateTexture(dotG);
      const grid = new PIXI.TilingSprite({ texture: dotTex, width: host.clientWidth, height: host.clientHeight });
      app.stage.addChildAt(grid, 0);

      const minimapG = new PIXI.Graphics();
      app.stage.addChild(minimapG);
      const MM_W = 180, MM_H = 120, MM_PAD = 12;
      const redrawMinimap = () => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const h of scene.cards.values()) {
          if (h.x < minX) minX = h.x; if (h.y < minY) minY = h.y;
          if (h.x + h.w > maxX) maxX = h.x + h.w; if (h.y + h.h > maxY) maxY = h.y + h.h;
        }
        minimapG.clear();
        const gw = maxX - minX, gh = maxY - minY;
        if (!(gw > 0) || !(gh > 0)) return;
        const sc = Math.min(MM_W / gw, MM_H / gh);
        const ox = host.clientWidth - MM_W - MM_PAD, oy = host.clientHeight - MM_H - MM_PAD;
        minimapG.rect(ox, oy, MM_W, MM_H).fill({ color: 0x000000, alpha: 0.35 }).stroke({ width: 1, color: 0xffffff, alpha: 0.15 });
        for (const h of scene.cards.values()) {
          minimapG.rect(ox + (h.x - minX) * sc, oy + (h.y - minY) * sc, Math.max(1, h.w * sc), Math.max(1, h.h * sc)).fill({ color: 0x9aa3b2, alpha: 0.7 });
        }
        const tl = cam.toWorld(0, 0), br = cam.toWorld(host.clientWidth, host.clientHeight);
        minimapG.rect(ox + (tl.wx - minX) * sc, oy + (tl.wy - minY) * sc, (br.wx - tl.wx) * sc, (br.wy - tl.wy) * sc).stroke({ width: 1.5, color: 0x4d8dff, alpha: 0.9 });
      };

      // Hybrid: charts stay real DOM (crisp recharts SVG, no blurry texture) in an
      // overlay above the canvas. One inner "world" div carries the camera transform,
      // so every chart rides the pan/zoom exactly like the Pixi world container.
      let chartOverlay: HTMLDivElement | null = null;
      let chartWorld: HTMLDivElement | null = null;
      if (chartImages.length > 0) {
        chartOverlay = document.createElement("div");
        chartOverlay.className = "renderer-spike__chart-overlay";
        chartWorld = document.createElement("div");
        chartWorld.className = "renderer-spike__chart-world";
        for (const im of chartImages) {
          const cell = document.createElement("div");
          cell.className = "renderer-spike__chart";
          cell.style.left = `${im.x}px`; cell.style.top = `${im.y}px`;
          cell.style.width = `${im.w}px`; cell.style.height = `${im.h}px`;
          cell.innerHTML = im.svg; // serialized recharts SVG, sized to world units
          chartWorld.appendChild(cell);
        }
        chartOverlay.appendChild(chartWorld);
        host.appendChild(chartOverlay);
      }

      const apply = () => {
        scene.world.scale.set(cam.scale);
        scene.world.position.set(cam.tx, cam.ty);
        if (chartWorld) chartWorld.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.scale})`;
        scene.setLod(lodRef.current ? cam.scale < LOD_SIMPLE_BELOW : false);
        if (cullRef.current) {
          const m = 120; // world-px margin so cards don't pop at the edge
          const tl = cam.toWorld(0, 0), br = cam.toWorld(host.clientWidth, host.clientHeight);
          scene.cull({ minX: tl.wx - m, minY: tl.wy - m, maxX: br.wx + m, maxY: br.wy + m });
        } else scene.cull(null);
        grid.tileScale.set(cam.scale);
        grid.tilePosition.set(cam.tx, cam.ty);
        redrawMinimap();
      };
      scene.setCablesVisible(cablesRef.current); // a rebuild respects the current toggle
      apply();
      camRef.current = cam; sceneRef.current = scene; applyRef.current = apply;
      selectedRef.current = new Set();

      const boxG = new PIXI.Graphics();
      boxG.visible = false;
      scene.world.addChild(boxG);
      const tempG = new PIXI.Graphics();
      tempG.visible = false;
      scene.world.addChild(tempG);
      const hoverG = new PIXI.Graphics();
      hoverG.visible = false;
      scene.world.addChild(hoverG);
      let lastHover: string | null = null;
      const drawHover = (id: string | null) => {
        if (id === lastHover) return;
        lastHover = id;
        const h = id ? scene.cards.get(id) : null;
        if (!h) { hoverG.visible = false; hoverG.clear(); return; }
        hoverG.clear();
        hoverG.roundRect(h.x - 1, h.y - 1, h.w + 2, h.h + 2, 9).stroke({ width: 1.5, color: 0xffffff, alpha: 0.25 });
        hoverG.visible = true;
      };

      // ── Pointer model (mouse / pen / multi-touch) ─────────────────────────
      const pointers = new Map<number, { x: number; y: number }>();
      let gmode: "none" | "pan" | "drag" | "pinch" | "box" | "cable" = "none";
      let dragMoved = false;
      let last = { x: 0, y: 0 };
      let prevDist = 1, prevMid = { x: 0, y: 0 };
      let downWorld = { wx: 0, wy: 0 };
      let dragOrigins: Map<string, { x: number; y: number }> | null = null;
      let boxStart = { wx: 0, wy: 0 };
      let cableSrc: { nodeId: string; sock: SnapSocket } | null = null;
      // Nearest socket to a world point within ~14 screen px, or null.
      const pickSocket = (wx: number, wy: number): { nodeId: string; sock: SnapSocket } | null => {
        const rad = 14 / cam.scale; let bestD = rad * rad, best: { nodeId: string; sock: SnapSocket } | null = null;
        for (const [id, h] of scene.cards) for (const sk of h.sockets) {
          const d = (sk.x - wx) ** 2 + (sk.y - wy) ** 2;
          if (d < bestD) { bestD = d; best = { nodeId: id, sock: sk }; }
        }
        return best;
      };
      const drawTempCable = (wx: number, wy: number) => {
        if (!cableSrc) return;
        const pts = cablePolyline("diagonal", { sx: cableSrc.sock.x, sy: cableSrc.sock.y, ex: wx, ey: wy });
        tempG.clear();
        if (pts.length < 2) return;
        tempG.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) tempG.lineTo(pts[i].x, pts[i].y);
        tempG.stroke({ width: 2, color: 0x4d8dff, alpha: 0.9 });
      };
      // Create the connection in the REAL editor (output→input), then mirror it
      // into the scene. Catches incompatible-type rejections.
      const tryConnect = (a: { nodeId: string; sock: SnapSocket }, b: { nodeId: string; sock: SnapSocket }) => {
        const out = a.sock.side === "output" ? a : b;
        const inp = a.sock.side === "output" ? b : a;
        const editor = getEditor(); if (!editor) return;
        const sNode = editor.getNode(out.nodeId), tNode = editor.getNode(inp.nodeId);
        if (!sNode || !tNode) return;
        const conn = new ClassicPreset.Connection(sNode, out.sock.key, tNode, inp.sock.key);
        const cid = (conn as { id: string }).id;
        Promise.resolve(editor.addConnection(conn as never))
          .then(() => { scene.addCable(out.sock, inp.sock, cid); void processGraph(); })
          .catch(() => { /* incompatible / duplicate — ignore */ });
      };
      const drawBox = (a: { wx: number; wy: number }, b: { wx: number; wy: number }) => {
        const minX = Math.min(a.wx, b.wx), minY = Math.min(a.wy, b.wy);
        const w = Math.abs(a.wx - b.wx), h = Math.abs(a.wy - b.wy);
        boxG.clear();
        boxG.rect(minX, minY, w, h).fill({ color: 0x4d8dff, alpha: 0.12 }).stroke({ width: 1, color: 0x4d8dff, alpha: 0.8 });
        return { minX, minY, maxX: minX + w, maxY: minY + h };
      };
      const screenOf = (e: { clientX: number; clientY: number }) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      const beginPinch = () => {
        const [a, b] = [...pointers.values()];
        prevDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        prevMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        gmode = "pinch"; dragOrigins = null;
      };
      const onDown = (e: PointerEvent) => {
        const s = screenOf(e); pointers.set(e.pointerId, s); canvas.setPointerCapture(e.pointerId);
        hoverG.visible = false; lastHover = null;
        if (pointers.size >= 2) { beginPinch(); return; }
        const { wx, wy } = cam.toWorld(s.x, s.y);
        // Socket drag (wire a cable) takes priority over card drag.
        const clearCableSel = () => { if (selectedCableRef.current) { selectedCableRef.current = null; scene.selectCable(null); } };
        if (mode === "live") {
          const sock = pickSocket(wx, wy);
          if (sock) { clearCableSel(); gmode = "cable"; cableSrc = sock; tempG.visible = true; drawTempCable(wx, wy); return; }
        }
        const hit = scene.picker.pick(wx, wy);
        const sel = selectedRef.current;
        if (hit) {
          clearCableSel();
          if (mode === "live") {
            if (e.shiftKey) { sel.has(hit) ? sel.delete(hit) : sel.add(hit); }
            else if (!sel.has(hit)) { sel.clear(); sel.add(hit); }
            scene.setSelected(sel);
          }
          const ids = mode === "live" && sel.has(hit) ? [...sel] : [hit];
          gmode = "drag"; dragMoved = false; downWorld = { wx, wy };
          dragOrigins = new Map();
          for (const id of ids) { const h = scene.cards.get(id); if (h) dragOrigins.set(id, { x: h.x, y: h.y }); }
          return;
        }
        if (mode === "live") {
          const cid = scene.pickCable(wx, wy, 6 / cam.scale);
          if (cid) { sel.clear(); scene.setSelected(sel); selectedCableRef.current = cid; scene.selectCable(cid); gmode = "pan"; last = { x: s.x, y: s.y }; return; }
          clearCableSel();
        }
        if (mode === "live" && e.shiftKey) {
          gmode = "box"; boxStart = { wx, wy }; boxG.visible = true; drawBox(boxStart, boxStart);
        } else {
          gmode = "pan"; last = { x: s.x, y: s.y };
          if (mode === "live" && !e.shiftKey) { sel.clear(); scene.setSelected(sel); }
        }
      };
      const onMove = (e: PointerEvent) => {
        const s = screenOf(e);
        if (gmode === "none") { // hover (no button down)
          if (mode === "live") { const { wx, wy } = cam.toWorld(s.x, s.y); drawHover(scene.picker.pick(wx, wy)); }
          return;
        }
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, s);
        if (gmode === "pinch" && pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const step = pinchStep(a, b, prevDist, prevMid);
          cam.zoomBy(step.factor, step.mid.x, step.mid.y);
          cam.panBy(step.panX, step.panY);
          prevDist = step.dist; prevMid = step.mid; apply();
          return;
        }
        if (gmode === "cable") { const { wx, wy } = cam.toWorld(s.x, s.y); drawTempCable(wx, wy); return; }
        if (gmode === "pan") { cam.panBy(s.x - last.x, s.y - last.y); last = { x: s.x, y: s.y }; apply(); }
        else if (gmode === "drag" && dragOrigins) {
          const { wx, wy } = cam.toWorld(s.x, s.y);
          const dx = wx - downWorld.wx, dy = wy - downWorld.wy;
          for (const [id, o] of dragOrigins) scene.moveCard(id, o.x + dx, o.y + dy);
          dragMoved = true; redrawMinimap();
        } else if (gmode === "box") {
          const cur = cam.toWorld(s.x, s.y);
          const r = drawBox(boxStart, { wx: cur.wx, wy: cur.wy });
          const sel = selectedRef.current; sel.clear();
          for (const [id, h] of scene.cards) {
            if (h.x < r.maxX && h.x + h.w > r.minX && h.y < r.maxY && h.y + h.h > r.minY) sel.add(id);
          }
          scene.setSelected(sel);
        }
      };
      const onUp = (e: PointerEvent) => {
        // Persist any live drag back to the real editor.
        if (gmode === "drag" && dragOrigins && dragMoved && mode === "live") {
          const area = getArea();
          if (area) for (const id of dragOrigins.keys()) {
            const h = scene.cards.get(id); if (h) void area.translate(id, { x: h.x, y: h.y });
          }
        }
        if (gmode === "cable" && cableSrc) {
          const { wx, wy } = cam.toWorld(screenOf(e).x, screenOf(e).y);
          const drop = pickSocket(wx, wy);
          if (drop && drop.nodeId !== cableSrc.nodeId && drop.sock.side !== cableSrc.sock.side) tryConnect(cableSrc, drop);
          tempG.visible = false; tempG.clear(); cableSrc = null;
        }
        if (gmode === "box") { boxG.visible = false; boxG.clear(); }
        pointers.delete(e.pointerId);
        try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        if (pointers.size >= 2) beginPinch();
        else if (pointers.size === 1) { const [p] = [...pointers.values()]; gmode = "pan"; last = { x: p.x, y: p.y }; dragOrigins = null; }
        else { gmode = "none"; dragOrigins = null; }
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault(); const s = screenOf(e);
        cam.zoomBy(Math.exp(-e.deltaY * 0.0015), s.x, s.y); apply();
      };
      const onDbl = (e: MouseEvent) => {
        if (mode !== "live") return;
        const s = screenOf(e);
        const { wx, wy } = cam.toWorld(s.x, s.y);
        const hit = scene.picker.pick(wx, wy);
        if (!hit) return;
        const h = scene.cards.get(hit); if (!h) return;
        const tl = cam.toScreen(h.x, h.y);
        const r = canvas.getBoundingClientRect();
        const node = getEditor()?.getNode(hit) as { label?: string } | undefined;
        setEditing({ id: hit, left: r.left + tl.sx, top: r.top + tl.sy, width: Math.max(120, h.w * cam.scale), value: node?.label ?? "" });
      };
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("pointercancel", onUp);
      canvas.addEventListener("wheel", onWheel, { passive: false });
      canvas.addEventListener("dblclick", onDbl);
      cleanup = () => {
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("wheel", onWheel);
        canvas.removeEventListener("dblclick", onDbl);
      };

      fpsTimer = window.setInterval(() => { if (app) setFps(Math.round(app.ticker.FPS)); }, 400);
      setBuilding(false);
      } catch (err) {
        if (!canceled) { setError((err as Error)?.message ?? String(err)); setBuilding(false); }
      }
    })();

    return () => {
      canceled = true;
      if (fpsTimer) clearInterval(fpsTimer);
      cleanup?.();
      camRef.current = null; sceneRef.current = null;
      if (app) { try { app.destroy(true, { children: true }); } catch { /* mid-init */ } }
      host.replaceChildren();
    };
  }, [open, mode, count, textMode]);

  // LOD / cull / cables toggles take effect without rebuilding the scene.
  useEffect(() => {
    lodRef.current = lodOn; cullRef.current = cullOn; cablesRef.current = cablesOn;
    sceneRef.current?.setCablesVisible(cablesOn);
    applyRef.current();
  }, [lodOn, cullOn, cablesOn]);

  // Persist the HUD prefs so reopening keeps the last setup.
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, count, textMode, lodOn, cullOn, cablesOn })); } catch { /* private mode */ }
  }, [mode, count, textMode, lodOn, cullOn, cablesOn]);

  // Escape closes; Delete/Backspace removes the live selection from the editor.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { rendererSpikeStore.close(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && mode === "live" && !editing) {
        const ids = selectedRef.current;
        if (!ids.size && selectedCableRef.current) {
          e.preventDefault();
          const cid = selectedCableRef.current;
          const editor = getEditor();
          if (editor) void editor.removeConnection(cid as never);
          sceneRef.current?.removeCable(cid);
          selectedCableRef.current = null;
          void processGraph();
          return;
        }
        if (!ids.size) return;
        e.preventDefault();
        const editor = getEditor();
        if (editor) {
          // Remove a node's connections before the node (rete requires it).
          for (const id of ids) {
            for (const c of editor.getConnections().filter((c) => c.source === id || c.target === id)) void editor.removeConnection(c.id);
          }
          for (const id of ids) void editor.removeNode(id);
        }
        sceneRef.current?.removeCards(new Set(ids));
        ids.clear();
        void processGraph();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mode, editing]);

  // Commit/cancel the floating rename — writes node.label back to the real editor
  // and updates the Pixi title in place.
  const commitEdit = (save: boolean) => {
    setEditing((cur) => {
      if (cur && save) {
        const node = getEditor()?.getNode(cur.id) as { label?: string } | undefined;
        const next = cur.value.trim();
        if (node && next) {
          node.label = next;
          const h = sceneRef.current?.cards.get(cur.id);
          if (h?.titleText) h.titleText.text = next.length > 22 ? next.slice(0, 21) + "…" : next;
          void processGraph(cur.id);
        }
      }
      return null;
    });
  };

  const fitView = () => {
    const cam = camRef.current, scene = sceneRef.current, host = hostRef.current;
    if (!cam || !scene || !host) return;
    cam.fit(scene.bounds, host.clientWidth, host.clientHeight);
    applyRef.current();
  };

  // A fixed-zoom PAN sweep across the scene bounds for ~3s, sampling real
  // rAF-to-rAF frame intervals, then reporting avg + worst-frame fps. Holding
  // zoom fixed isolates the pan cost.
  const runBench = () => {
    const cam = camRef.current, host = hostRef.current, scene = sceneRef.current;
    if (!cam || !host || !scene || benching) return;
    setBenching(true); setBench(null);
    const base = { scale: cam.scale, tx: cam.tx, ty: cam.ty };
    const bounds = scene.bounds;
    const W = host.clientWidth, H = host.clientHeight;
    const deltas: number[] = [];
    const total = 180;
    let frame = 0;
    let lastT = performance.now();
    const step = () => {
      const now = performance.now();
      if (frame > 0) deltas.push(now - lastT); // drop the first (warm-up) interval
      lastT = now;
      const t = frame / total;
      const { tx, ty } = panSweep(bounds, W, H, base.scale, t);
      cam.scale = base.scale; cam.tx = tx; cam.ty = ty;
      applyRef.current();
      frame++;
      if (frame <= total) requestAnimationFrame(step);
      else {
        const sorted = [...deltas].sort((a, b) => a - b);
        const avg = deltas.reduce((s, d) => s + d, 0) / Math.max(1, deltas.length);
        const worst = sorted[sorted.length - 1] || 16.7;
        setBench({ avg: Math.round(1000 / avg), min: Math.round(1000 / worst) });
        cam.scale = base.scale; cam.tx = base.tx; cam.ty = base.ty; applyRef.current();
        setBenching(false);
      }
    };
    requestAnimationFrame(step);
  };

  if (!open) return null;

  return (
    <div className="renderer-spike">
      <div className="renderer-spike__host" ref={hostRef} />
      {editing && (
        <input
          className="renderer-spike__edit"
          autoFocus
          style={{ left: editing.left, top: editing.top, width: editing.width }}
          value={editing.value}
          onChange={(e) => setEditing((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitEdit(true); }
            else if (e.key === "Escape") { e.preventDefault(); commitEdit(false); }
          }}
          onBlur={() => commitEdit(true)}
        />
      )}
      <div className="renderer-spike__hud">
        <div className="renderer-spike__row renderer-spike__title">
          Pixi renderer spike
          <button className="renderer-spike__close" onClick={() => rendererSpikeStore.close()} title="Close (Esc)">✕</button>
        </div>

        <div className="renderer-spike__seg">
          {(["synthetic", "live"] as const).map((m) => (
            <button key={m} className={m === mode ? "active" : ""} onClick={() => setMode(m)}>
              {m === "synthetic" ? "Synthetic" : "My graph"}
            </button>
          ))}
        </div>

        <div className="renderer-spike__row"><span>backend</span><b className={backend === "WebGPU" ? "ok" : ""}>{backend}</b></div>
        <div className="renderer-spike__row"><span>text atlas</span><b className={msdf ? "ok" : msdf === false ? "warn" : ""}>{msdf == null ? "…" : msdf ? "MSDF" : "fallback"}</b></div>
        <div className="renderer-spike__row"><span>fps</span><b className={fps >= 55 ? "ok" : fps >= 30 ? "warn" : "bad"}>{building ? "building…" : fps}</b></div>
        <div className="renderer-spike__row"><span>nodes</span><b>{stats.nodes.toLocaleString(APP_LOCALE)}</b></div>
        <div className="renderer-spike__row"><span>cables</span><b>{stats.cables.toLocaleString(APP_LOCALE)}</b></div>

        {mode === "synthetic" && (
          <div className="renderer-spike__counts">
            {COUNTS.map((n) => (
              <button key={n} className={n === count ? "active" : ""} onClick={() => setCount(n)}>{n >= 1000 ? `${n / 1000}k` : n}</button>
            ))}
          </div>
        )}

        <div className="renderer-spike__seg renderer-spike__seg--sub">
          <span className="renderer-spike__seg-label">text</span>
          {(["bitmap", "text"] as const).map((t) => (
            <button key={t} className={t === textMode ? "active" : ""} onClick={() => setTextMode(t)} title={t === "bitmap" ? "MSDF BitmapText: a shared batched atlas, crisp at any zoom" : "Text: a texture per label, the slow path"}>
              {t === "bitmap" ? "MSDF" : "Text"}
            </button>
          ))}
        </div>

        <div className="renderer-spike__seg renderer-spike__seg--sub">
          <span className="renderer-spike__seg-label">perf</span>
          <button className={lodOn ? "active" : ""} onClick={() => setLodOn((v) => !v)} title={`LOD: drop text below ${LOD_SIMPLE_BELOW}× zoom`}>LOD</button>
          <button className={cullOn ? "active" : ""} onClick={() => setCullOn((v) => !v)} title="Frustum cull: skip offscreen cards">Cull</button>
          <button className={cablesOn ? "active" : ""} onClick={() => setCablesOn((v) => !v)} title="Toggle cables: isolate node vs cable cost">Cables</button>
          <button onClick={fitView} title="Frame the whole scene">Fit</button>
        </div>

        <div className="renderer-spike__counts">
          <button onClick={runBench} disabled={benching} title="Pan-sweep the graph for ~3s and report real frame-time fps">
            {benching ? "benchmarking…" : "Benchmark"}
          </button>
        </div>
        {bench && (
          <div className="renderer-spike__row renderer-spike__bench">
            <span>avg <b className={bench.avg >= 55 ? "ok" : bench.avg >= 30 ? "warn" : "bad"}>{bench.avg}</b></span>
            <span>worst <b className={bench.min >= 50 ? "ok" : bench.min >= 24 ? "warn" : "bad"}>{bench.min}</b> fps</span>
          </div>
        )}

        {error && <div className="renderer-spike__note">Renderer error: {error}</div>}
        {stats.note && <div className="renderer-spike__note">{stats.note}</div>}
        <div className="renderer-spike__hint">drag a card · drag empty to pan · wheel / pinch to zoom{mode === "live" ? " · double-click to rename · drags + renames save to the graph" : ""}</div>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MinimapPlugin } from "rete-minimap-plugin";
import { getActiveArea, getActiveEditor } from "../activeGraph";
import type { Schemes } from "../schemes";
import { GroupNode, NoteNode, nodeAccent } from "../rete-nodes";
import { groupCollapseStore } from "../groupCollapse";
import { appThemeStore } from "../appTheme";
import { themeAccent, resolveColor } from "../palette";
import "./Minimap.css";

// A drop-in for rete-react-plugin's minimap preset: nodes draw in their real accent
// color, rects border-box so the 1px outline doesn't inflate the silhouette.

type Rect = { left: number; top: number; width: number; height: number };
type Transform = { x: number; y: number; k: number };

export interface MinimapProps {
  size: number;
  ratio: number;
  nodes: Rect[];
  viewport: Rect;
  start(): Transform;
  translate(dx: number, dy: number): void;
  point(x: number, y: number): void;
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

interface Fill { background: string; borderColor: string }

// ONE stable order shared by the geometry override and the color lookup, so the two
// stay index-aligned; members hidden inside a collapsed group are dropped.
function minimapNodes() {
  // getActive* follows the drill-in subgraph when one is open, else main.
  const editor = getActiveEditor();
  const area = getActiveArea();
  if (!editor || !area) return { area: null, nodes: [] as ReturnType<NonNullable<typeof editor>["getNodes"]> };
  const nodes = editor.getNodes().filter(
    (n) => area.nodeViews.get(n.id) && !groupCollapseStore.isNodeHidden(n.id),
  );
  return { area, nodes };
}

// The plugin's `getNodesRect` shape, but skipping hidden members and sizing a
// collapsed group to its real compact box, not its stored expanded one.
export function collapsedAwareNodesRect() {
  const { area, nodes } = minimapNodes();
  if (!area) return [];
  return nodes.map((n) => {
    const view = area.nodeViews.get(n.id)!;
    let width = n.width;
    let height = n.height;
    if (n instanceof GroupNode && n.collapsed) {
      const el = view.element;
      width = el.offsetWidth || width;
      height = el.offsetHeight || height;
    }
    return { width, height, left: view.position.x, top: view.position.y };
  });
}

// Index-aligned to the geometry array — same filtered list, same order.
function nodeFills(mode: "dark" | "light"): Fill[] {
  return minimapNodes().nodes.map((n) => {
    if (n instanceof GroupNode) {
      const c = themeAccent(resolveColor(n.color), mode);
      return { background: hexToRgba(c, 0.2), borderColor: hexToRgba(c, 0.75) };
    }
    if (n instanceof NoteNode) {
      // Notes read more solid than a group's wash on canvas.
      const c = themeAccent(resolveColor(n.color), mode);
      return { background: hexToRgba(c, 0.35), borderColor: hexToRgba(c, 0.9) };
    }
    const accent = nodeAccent(n, mode);
    return { background: hexToRgba(accent, 0.85), borderColor: hexToRgba(accent, 0.95) };
  });
}

// Node rects live in GRAPH coordinates, so a pan moves only the viewport box: the
// draw effect keys on a geometry+fill+width signature, letting pan/zoom frames skip
// the canvas redraw entirely.
function drawMinimapNodes(
  canvas: HTMLCanvasElement,
  nodes: Rect[],
  fills: Fill[],
  containerWidth: number,
) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const scale = (v: number) => (Number.isFinite(v) ? v * containerWidth : 0);
  ctx.lineWidth = 1;
  nodes.forEach((n, i) => {
    const x = scale(n.left);
    const y = scale(n.top);
    const rw = scale(n.width);
    const rh = scale(n.height);
    if (rw <= 0 || rh <= 0) return;
    // Fill the half-pixel-inset rounded rect, then stroke its edge (border-box look).
    const r = Math.min(1.5, rw / 2, rh / 2);
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, Math.max(rw - 1, 0.5), Math.max(rh - 1, 0.5), r);
    ctx.fillStyle = fills[i]?.background ?? "rgba(138, 143, 152, 0.85)";
    ctx.fill();
    ctx.strokeStyle = fills[i]?.borderColor ?? "rgba(138, 143, 152, 0.95)";
    ctx.stroke();
  });
}

export function SolenoidMinimap(props: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The very first paint has no measured width yet — a ResizeObserver fills it in.
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setMeasured(el.clientWidth));
    ro.observe(el);
    setMeasured(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const containerWidth = ref.current?.clientWidth || measured;
  // The plugin hands back a non-finite rect for a beat when the bounding box is
  // degenerate — coerce to 0 so React never sees `NaN` in a style.
  const scale = (v: number) => (Number.isFinite(v) ? v * containerWidth : 0);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const fills = nodeFills(appThemeStore.getMode());
  // Pan leaves node graph-coords (and the box they normalize against) unchanged, so
  // geomSig is identical frame to frame and only the viewport rect updates.
  const geomSig = props.nodes.map((n) => `${n.left},${n.top},${n.width},${n.height}`).join(";");
  const fillSig = fills.map((f) => f.background).join(";");

  const nodesCanvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef(props.nodes);
  nodesRef.current = props.nodes;
  const fillsRef = useRef(fills);
  fillsRef.current = fills;
  useEffect(() => {
    const canvas = nodesCanvasRef.current;
    if (!canvas || !containerWidth) return;
    drawMinimapNodes(canvas, nodesRef.current, fillsRef.current, containerWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomSig, fillSig, containerWidth]);

  const startDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    let prev = { x: e.pageX, y: e.pageY };
    const move = (m: PointerEvent) => {
      const dx = m.pageX - prev.x;
      const dy = m.pageY - prev.y;
      prev = { x: m.pageX, y: m.pageY };
      props.translate(-dx / containerWidth, -dy / containerWidth);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      ref={ref}
      className="solenoid-minimap"
      data-testid="minimap"
      style={{ width: props.size * props.ratio, height: props.size }}
      onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        props.point(
          (e.clientX - box.left) / (props.size * props.ratio),
          (e.clientY - box.top) / (props.size * props.ratio),
        );
      }}
    >
      <canvas ref={nodesCanvasRef} className="solenoid-minimap__canvas" data-testid="minimap-nodes" />
      <div
        className="solenoid-minimap__viewport"
        data-testid="minimap-viewport"
        style={{
          left: scale(props.viewport.left),
          top: scale(props.viewport.top),
          width: scale(props.viewport.width),
          height: scale(props.viewport.height),
        }}
        onPointerDown={startDrag}
      />
    </div>
  );
}

/** The configured minimap EVERY editing surface builds: collapse-aware geometry plus
 *  rAF-coalesced rendering. The plugin re-renders synchronously on `translated`,
 *  `zoomed` and `nodetranslated` — one full pass over every node view, at pointermove
 *  rate — so an uncoalesced map turns a pan into layout thrash. `isDestroyed` guards a
 *  frame that lands after the surface went away (a document switch destroys the area). */
export function createSolenoidMinimap(isDestroyed?: () => boolean): MinimapPlugin<Schemes> {
  const minimap = new MinimapPlugin<Schemes>({ ratio: 1.4 });
  (minimap as unknown as { getNodesRect: () => unknown }).getNodesRect = collapsedAwareNodesRect;
  const mm = minimap as unknown as { render: () => void };
  const rawRender = mm.render.bind(minimap);
  let rafPending = 0;
  mm.render = () => {
    if (rafPending) return;
    rafPending = requestAnimationFrame(() => {
      rafPending = 0;
      if (!isDestroyed?.()) rawRender();
    });
  };
  return minimap;
}

/** Render preset replacing `ReactPresets.minimap.setup` with the colored map. */
export function solenoidMinimapPreset(size: number) {
  return {
    render(context: { data: { type: string; [k: string]: unknown } }) {
      if (context.data.type === "minimap") {
        const d = context.data as unknown as Omit<MinimapProps, "size">;
        return <SolenoidMinimap {...d} size={size} />;
      }
      return undefined;
    },
  };
}

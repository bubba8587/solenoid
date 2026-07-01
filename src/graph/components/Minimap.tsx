import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getArea, getEditor } from "../process";
import { GroupNode, NoteNode, nodeKindOf, NODE_KIND_ACCENTS } from "../rete-nodes";
import { groupCollapseStore } from "../groupCollapse";
import { appThemeStore } from "../appTheme";
import { themeAccent, resolveColor } from "../palette";
import "./Minimap.css";

// A drop-in replacement for rete-react-plugin's minimap render preset. Two
// differences from the stock one:
//   1. Each node draws in its real accent color (groups as a faint wash of
//      their own color) instead of a single flat blue.
//   2. Node rects are `box-sizing: border-box`, so the 1px outline doesn't
//      inflate the silhouette — the stock MiniNode's content-box border made
//      every node read ~2px bigger than its true footprint, crowding the map.
// The geometry still comes from the plugin (already in sync with real node
// width/height, which NodeCard reports back from the rendered DOM).

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

// The nodes the minimap should draw, in a stable order shared by the geometry
// override and the color lookup so the two stay index-aligned. Members hidden
// inside a collapsed group are dropped — they aren't visible on the canvas, so
// they shouldn't crowd the map either.
function minimapNodes() {
  const editor = getEditor();
  const area = getArea();
  if (!editor || !area) return { area: null, nodes: [] as ReturnType<NonNullable<typeof editor>["getNodes"]> };
  const nodes = editor.getNodes().filter(
    (n) => area.nodeViews.get(n.id) && !groupCollapseStore.isNodeHidden(n.id),
  );
  return { area, nodes };
}

// Geometry override for the minimap plugin's `getNodesRect`. Same shape as the
// stock method, but it skips hidden members and sizes a collapsed group to its
// real (compact) rendered box instead of its stored expanded width/height.
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

// Recover per-node colors aligned to the geometry array — same filtered list,
// same order. Group nodes paint as a faint wash of their own color.
function nodeFills(mode: "dark" | "light"): Fill[] {
  return minimapNodes().nodes.map((n) => {
    if (n instanceof GroupNode) {
      const c = themeAccent(resolveColor(n.color), mode);
      return { background: hexToRgba(c, 0.2), borderColor: hexToRgba(c, 0.75) };
    }
    if (n instanceof NoteNode) {
      // Notes carry their own palette slot too (gray default came from falling
      // through to the util kind accent). They read more solid than a group's
      // wash on canvas, so paint a touch more present than the group branch.
      const c = themeAccent(resolveColor(n.color), mode);
      return { background: hexToRgba(c, 0.35), borderColor: hexToRgba(c, 0.9) };
    }
    const accent = themeAccent(NODE_KIND_ACCENTS[nodeKindOf(n)] ?? "#8a8f98", mode);
    return { background: hexToRgba(accent, 0.85), borderColor: hexToRgba(accent, 0.95) };
  });
}

// The node rectangles live in GRAPH coordinates, so panning the canvas doesn't
// move them — only the viewport box moves. But the minimap plugin re-emits a
// fresh render (new props) on EVERY pan/zoom frame, which would re-render all ~140
// node divs each frame (a full-green repaint of the minimap, a measured pan-perf
// hog). Splitting the rects into a memoized child keyed on a geometry+fill+width
// signature means they re-render only when a node actually moves/resizes or the
// theme changes — pan/zoom then updates just the one viewport div.
const MinimapNodes = memo(
  function MinimapNodes(props: {
    nodes: Rect[]; fills: Fill[]; containerWidth: number;
    geomSig: string; fillSig: string;
  }) {
    const { nodes, fills, containerWidth } = props;
    const scale = (v: number) => (Number.isFinite(v) ? v * containerWidth : 0);
    return (
      <>
        {nodes.map((n, i) => (
          <div
            key={i}
            className="solenoid-minimap__node"
            data-testid="minimap-node"
            style={{
              left: scale(n.left),
              top: scale(n.top),
              width: scale(n.width),
              height: scale(n.height),
              background: fills[i]?.background ?? "rgba(138, 143, 152, 0.85)",
              borderColor: fills[i]?.borderColor ?? "rgba(138, 143, 152, 0.95)",
            }}
          />
        ))}
      </>
    );
  },
  (a, b) =>
    a.containerWidth === b.containerWidth &&
    a.geomSig === b.geomSig &&
    a.fillSig === b.fillSig,
);

export function SolenoidMinimap(props: MinimapProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Track the container's content width so node positions scale correctly. The
  // plugin emits a fresh render on every pan/zoom, but the very first paint has
  // no measured width yet — a ResizeObserver fills it in.
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
  // The minimap plugin can hand us a non-finite normalized rect for a beat when
  // the node bounding box is degenerate (a lone node, or mid graph load/clear
  // before sizes settle). Coerce to 0 so React never sees `NaN` in a style.
  const scale = (v: number) => (Number.isFinite(v) ? v * containerWidth : 0);
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const fills = nodeFills(appThemeStore.getMode());
  // Cheap signatures so the memoized rect layer skips re-render on a pan/zoom that
  // didn't actually move a node. Pan leaves node graph-coords (and the bounding
  // box they're normalized against) unchanged, so geomSig is identical frame to
  // frame; only the viewport rect below updates.
  const geomSig = props.nodes.map((n) => `${n.left},${n.top},${n.width},${n.height}`).join(";");
  const fillSig = fills.map((f) => f.background).join(";");

  // Incremental drag of the mini-viewport → pan the real area.
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
      {containerWidth ? (
        <MinimapNodes
          nodes={props.nodes}
          fills={fills}
          containerWidth={containerWidth}
          geomSig={geomSig}
          fillSig={fillSig}
        />
      ) : null}
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

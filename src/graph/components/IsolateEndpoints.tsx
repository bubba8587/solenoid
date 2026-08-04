import { useSyncExternalStore, useState, useRef, useEffect } from "react";
import { isolateStore, isoEndpointSelect } from "../isolateStore";
import { boundaryCrossings, type BoundaryCrossing } from "../isolateBoundary";
import { getEditor, getArea, connectionVersionStore, unselectAllNodes } from "../process";
import { cableSelectionStore } from "../cableState";
import { standoffStore, standoffLayoutTick } from "../standoffs";
import { nodeTypeName } from "../nodeNames";
import { getCablePath, Position } from "../cablePaths";
import { cableShapeStore } from "../cableShape";
import "./isolateEndpoints.css";

// Auto-generated boundary endpoints for the Isolate overlay: the chain's crossings
// become an "Inputs" terminal on the LEFT and an "Outputs" terminal on the RIGHT.
// Rendered in the area's transformed plane (canvas coords), so it pans/zooms.

type Pt = { x: number; y: number };

const GAP = 80;       // canvas px between the focus bbox and a terminal
const TERM_W = 152;
const HEAD_H = 26;    // fixed header height so the lane/dot/cable maths line up
const LANE_H = 22;    // matches .solenoid-node__io-row

// A focused socket's position in canvas coords (transform-invariant), measured
// from its DOM dot relative to the area's transformed holder.
function socketCanvasPos(holder: HTMLElement, nodeId: string, key: string, side: "input" | "output"): Pt | null {
  const el = holder.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(nodeId)}"][data-socket-key="${CSS.escape(key)}"][data-socket-side="${side}"]`,
  );
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const hr = holder.getBoundingClientRect();
  const k = getArea()?.area.transform.k || 1;
  return { x: (r.left + r.width / 2 - hr.left) / k, y: (r.top + r.height / 2 - hr.top) / k };
}

function externalName(nodeId: string): string {
  const n = getEditor()?.getNode(nodeId);
  if (!n) return nodeId;
  return (n.label ?? "").trim() || nodeTypeName(n);
}

export function IsolateEndpoints() {
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  useSyncExternalStore(standoffLayoutTick.subscribe, standoffLayoutTick.version);
  useSyncExternalStore(isoEndpointSelect.subscribe, isoEndpointSelect.version);
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  const selected = isoEndpointSelect.get();

  const focus = isolateStore.get();
  const editor = getEditor();
  const area = getArea();

  // Drag offsets are ephemeral (reset when the isolated set changes) and in canvas
  // coords, applied on top of the auto-centered position.
  const [override, setOverride] = useState<{ entry: Pt; exit: Pt }>({ entry: { x: 0, y: 0 }, exit: { x: 0, y: 0 } });
  const dragRef = useRef<{ which: "entry" | "exit"; sx: number; sy: number; base: Pt } | null>(null);
  const focusKey = focus ? [...focus].sort().join(",") : "";
  useEffect(() => {
    setOverride({ entry: { x: 0, y: 0 }, exit: { x: 0, y: 0 } });
    isoEndpointSelect.set(null);
  }, [focusKey]);

  if (!focus || !editor || !area) return null;
  const holder = area.area.content.holder as HTMLElement;

  const startDrag = (which: "entry" | "exit") => (e: React.PointerEvent) => {
    e.stopPropagation();
    // Join the one selection system — selecting a terminal clears node / cable /
    // standoff selection (the canvas pointerdown handler clears the terminal back).
    isoEndpointSelect.set(which);
    unselectAllNodes();
    cableSelectionStore.set(null);
    standoffStore.select(null);
    dragRef.current = { which, sx: e.clientX, sy: e.clientY, base: override[which] };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const k = area.area.transform.k || 1;
    setOverride((o) => ({ ...o, [d.which]: { x: d.base.x + (e.clientX - d.sx) / k, y: d.base.y + (e.clientY - d.sy) / k } }));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); dragRef.current = null; }
  };

  const { entry, exit } = boundaryCrossings(
    focus,
    editor.getConnections().map((c) => ({ id: c.id, source: c.source, sourceOutput: c.sourceOutput, target: c.target, targetInput: c.targetInput })),
  );
  if (entry.length === 0 && exit.length === 0) return null;

  // Focus bounding box (canvas coords).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of focus) {
    const view = area.nodeViews.get(id);
    if (!view) continue;
    const w = view.element.offsetWidth || 120, h = view.element.offsetHeight || 60;
    minX = Math.min(minX, view.position.x); minY = Math.min(minY, view.position.y);
    maxX = Math.max(maxX, view.position.x + w); maxY = Math.max(maxY, view.position.y + h);
  }
  if (!isFinite(minX)) return null;

  // Resolve focused socket positions; order lanes by socket-y so cables don't cross.
  const entryLanes = entry
    .map((cr) => ({ cr, pos: socketCanvasPos(holder, cr.focusNodeId, cr.focusSocket, "input") }))
    .filter((l): l is { cr: BoundaryCrossing; pos: Pt } => l.pos !== null)
    .sort((a, b) => a.pos.y - b.pos.y);
  const exitLanes = exit
    .map((cr) => ({ cr, pos: socketCanvasPos(holder, cr.focusNodeId, cr.focusSocket, "output") }))
    .filter((l): l is { cr: BoundaryCrossing; pos: Pt } => l.pos !== null)
    .sort((a, b) => a.pos.y - b.pos.y);

  const cy = (minY + maxY) / 2;
  const entryH = HEAD_H + entryLanes.length * LANE_H;
  const exitH = HEAD_H + exitLanes.length * LANE_H;
  const entryX = minX - GAP - TERM_W + override.entry.x, entryY = cy - entryH / 2 + override.entry.y;
  const exitX = maxX + GAP + override.exit.x, exitY = cy - exitH / 2 + override.exit.y;

  const entryLanePt = (i: number): Pt => ({ x: entryX + TERM_W, y: entryY + HEAD_H + i * LANE_H + LANE_H / 2 });
  const exitLanePt = (i: number): Pt => ({ x: exitX, y: exitY + HEAD_H + i * LANE_H + LANE_H / 2 });

  const paths: string[] = [];
  entryLanes.forEach((l, i) => {
    const a = entryLanePt(i);
    paths.push(getCablePath(shape, { sourceX: a.x, sourceY: a.y, sourcePosition: Position.Right, targetX: l.pos.x, targetY: l.pos.y, targetPosition: Position.Left }));
  });
  exitLanes.forEach((l, i) => {
    const b = exitLanePt(i);
    paths.push(getCablePath(shape, { sourceX: l.pos.x, sourceY: l.pos.y, sourcePosition: Position.Right, targetX: b.x, targetY: b.y, targetPosition: Position.Left }));
  });

  // Reuse the node card chrome so terminals match real nodes AND so sockets straddle
  // the edge without being clipped (no overflow:hidden).
  const terminal = (side: "entry" | "exit", x: number, y: number, lanes: { cr: { externalNodeId: string } }[]) => (
    <div
      className={`solenoid-node solenoid-node--no-chevron solenoid-iso-ep solenoid-iso-ep--${side}${selected === side ? " solenoid-node--selected" : ""}`}
      style={{ left: x, top: y, width: TERM_W, ["--node-accent" as string]: "var(--sock-any)", cursor: "grab" }}
      onPointerDown={startDrag(side)}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
    >
      <div className="solenoid-node__header solenoid-iso-ep__head" style={{ height: HEAD_H }}>
        {side === "entry" ? (lanes.length > 1 ? "Inputs" : "Input") : (lanes.length > 1 ? "Outputs" : "Output")}
      </div>
      {lanes.map((l, i) => (
        <div key={i} className="solenoid-node__io-row" style={{ height: LANE_H }}>
          <span className="solenoid-node__io-label">{externalName(l.cr.externalNodeId)}</span>
        </div>
      ))}
      {lanes.map((_, i) => (
        <span
          key={`d${i}`}
          className={`solenoid-iso-ep__dot solenoid-iso-ep__dot--${side === "entry" ? "right" : "left"}`}
          style={{ top: HEAD_H + i * LANE_H + LANE_H / 2 - 6 }}
        />
      ))}
    </div>
  );

  return (
    <>
      <svg className="solenoid-iso-ep-svg">
        {paths.map((d, i) => <path key={i} className="solenoid-iso-ep-cable" d={d} />)}
      </svg>
      {entryLanes.length > 0 && terminal("entry", entryX, entryY, entryLanes)}
      {exitLanes.length > 0 && terminal("exit", exitX, exitY, exitLanes)}
    </>
  );
}

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Presets } from "rete-react-plugin";
import type { ClassicPreset } from "rete";
import { cableShapeStore, type CableShape } from "../cableShape";
import { cableAngleStore } from "../cableAngleStore";
import { isolateStore } from "../isolateStore";
import { cableSelectionStore, cableGhostStore, socketHighlightStore, socketHoverCableStore, dragSocketKey } from "../cableState";
import { unselectAllNodes, getArea, connectionVersionStore } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
import { getCablePath, Position } from "../cablePaths";
import { stopDragStart, IS_COARSE } from "../coarse";
import { touchSelectStore } from "../touchSelectStore";
import { SOCKET_COLORS, SolenoidSocket } from "../sockets";
import { cableValueStore } from "../cableValueStore";
import { cableFlowStore } from "../cableFlowStore";
import { loadRevealStore } from "../loadReveal";
import { groupCollapseStore, COLLAPSE_LAYOUT, pillY } from "../groupCollapse";
import { ribbonForConnection, ribbonHoverStore, conduitFacePoint, conduitLayoutStore, pinRibbonSeparation } from "../ribbonCable";
import { ConduitNode } from "../rete-nodes";
import { resolveTypedSource } from "../conduitTrace";
import { standoffStore } from "../standoffs";
import { settingsStore } from "../settingsStore";
import { useRenderMode } from "../renderMode";
import { cableScene, type CableStroke } from "../cableScene";

const { useConnection } = Presets.classic;

const DEFAULT_COLOR = SOCKET_COLORS.number;
// Themed: white pops on the dark canvas; a dark neutral reads on light.
const SELECTED_COLOR = "var(--cable-selected)";

// Conduit ribbon trunk: a neutral "conduit cable" band, ~4× a normal cable.
const RIBBON_COLOR = "#8a909c";
const RIBBON_WIDTH = 7.2;
// How far from a Conduit face the trunk starts/stops (the lanes merge after
// leaving the source face and split before reaching the target face).
const RIBBON_SPLIT = 24;

// Invisible hit-stroke widths. A fingertip needs a much fatter target than a
// mouse pointer; the visible strokes stay the same.
const CABLE_HIT_W = IS_COARSE ? 28 : 20;
const TRUNK_HIT_W = IS_COARSE ? 30 : 22;
const FAN_HIT_W = IS_COARSE ? 24 : 14;

// Each cable used to render into a 9999×9999px <svg> anchored at the holder
// origin. With C cables that's C ~100-megapixel layers, which is the keystone
// blocking GPU compositing of the area holder (promoting it would blow GPU
// memory), so pan/zoom repaint every cable every frame instead of moving a
// cached texture. Instead, bound each cable's <svg> to its own content bbox:
// position it at (minX,minY) with a matching `viewBox`, so absolute path coords
// still land in the same holder pixels (no path-string changes), but the layer
// box shrinks from 100MP to the cable's footprint. `overflow: visible` is kept
// so stroke/bow/corner ink that spills past the padded bbox still draws — the
// bbox only needs to be *roughly* right for the layer-size win; correctness
// doesn't depend on it. Flow beads and hit-strokes are untouched (they live
// inside this same <svg>), so all cable interaction stays identical.
const SVG_BBOX_PAD = 64; // covers stroke half-width, corner radius, spline bow
function boundedSvgProps(
  pts: Array<{ x: number; y: number }>,
  isoDim: boolean,
  revealStyle?: React.CSSProperties,
): { className: string; style: React.CSSProperties; viewBox: string } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  minX -= SVG_BBOX_PAD; minY -= SVG_BBOX_PAD;
  maxX += SVG_BBOX_PAD; maxY += SVG_BBOX_PAD;
  const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
  return {
    // Tags every cable <svg> so the gesture-time AA drop can EXCLUDE cables —
    // jaggy curves are the most visible quality loss, so cables keep their AA.
    className: "solenoid-cable-svg",
    style: {
      overflow: "visible",
      position: "absolute",
      left: minX,
      top: minY,
      width: w,
      height: h,
      pointerEvents: "none",
      ...(isoDim ? { opacity: 0.1 } : null),
      // Load reveal: fade the whole cable in (opacity only set while hidden, so
      // it never clobbers the isoDim dim above once revealed).
      ...revealStyle,
    },
    viewBox: `${minX} ${minY} ${w} ${h}`,
  };
}

// ── Flow-bead phase alignment across a ribbon assembly ────────────────────────
// The bead animation travels FLOW_PERIOD px per FLOW_DURATION s on every cable
// (keep in sync with .solenoid-cable-flow in canvas.css). A negative
// animation-delay shifts a segment's bead phase by the upstream length within
// the assembly, so beads appear to flow continuously: out of the Conduit's
// sockets down the source fans, onto the trunk exactly when the fan beads
// reach the merge face, and onward down the target fans. The canonical
// source-fan length is RIBBON_SPLIT (the face→merge distance); per-lane fans
// differ by a few px — approximation by design.
const FLOW_PERIOD = 72;
const FLOW_DURATION = 2.25;
const flowDelay = (upstreamPx: number) =>
  `${(-((upstreamPx % FLOW_PERIOD) / FLOW_PERIOD) * FLOW_DURATION).toFixed(4)}s`;

// Length of an SVG path string, measured on a detached path element (works in
// Chromium, which is what Tauri ships). Fallback: straight-line distance.
let _measurePath: SVGPathElement | null = null;
function pathLength(d: string, a: { x: number; y: number }, b: { x: number; y: number }): number {
  try {
    if (!_measurePath) {
      _measurePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    }
    _measurePath.setAttribute("d", d);
    return _measurePath.getTotalLength();
  } catch {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }
}

// ── Conduit hit clearance ─────────────────────────────────────────────────────
// Cable hit strokes are ~20px wide and end exactly on the socket. A compressed
// Conduit is a ~10×17px pill rendered at z -1 (UNDER the cables, so wires plug
// in over the block) — the converging hit strokes blanket it completely, and
// the dead zone matches the conduit's EXPANDED footprint. Clicks meant for the
// block hit cables instead, and it can't be re-selected once compressed. Trim
// the HIT coverage (never the visible path) just short of conduit
// endpoints via a dash pattern, so the block keeps its own hitbox.
const BLOCK_HIT_CLEAR = 14;

function hitTrimDash(total: number, trimStart: number, trimEnd: number): string | undefined {
  if (!(total > 0) || (trimStart <= 0 && trimEnd <= 0)) return undefined;
  // Never eat more than a third per side — short cables must stay clickable.
  const a = Math.min(trimStart, total / 3);
  const b = Math.min(trimEnd, total / 3);
  return `0 ${a.toFixed(1)} ${Math.max(0, total - a - b).toFixed(1)} ${b.toFixed(1)}`;
}

// ── Per-connection path cache ─────────────────────────────────────────────────
// getCablePath (the routeWalk/spline solve) is the expensive part of a cable
// render. This component subscribes to ~13 stores, most of which change only
// *appearance* (hover, selection, flow, value tint) — yet every bump re-renders
// us AND re-solves the path. Cache the last solve keyed on the geometry that
// actually feeds the solver, so appearance-only re-renders reuse the string and
// only genuine endpoint/shape/angle changes re-run getCablePath. Keyed by
// connection id; entries for deleted cables are harmless (bounded by session).
const _pathCache = new Map<string, { key: string; d: string }>();
// The cache key is shape+coords+angles, which DON'T change when the "direct cables"
// perf toggle flips (same shape, different routing) — so clear the whole cache on any
// settings change to force a re-solve.
settingsStore.subscribe(() => _pathCache.clear());
function cachedMainPath(
  id: string,
  shape: CableShape,
  cs: { x: number; y: number },
  ce: { x: number; y: number },
  sourceAngleDeg: number | null,
  targetAngleDeg: number | null,
): string {
  const key = `${shape}|${cs.x},${cs.y},${sourceAngleDeg}|${ce.x},${ce.y},${targetAngleDeg}`;
  const hit = _pathCache.get(id);
  if (hit && hit.key === key) return hit.d;
  const d = getCablePath(shape, {
    sourceX: cs.x, sourceY: cs.y, sourcePosition: Position.Right, sourceAngleDeg,
    targetX: ce.x, targetY: ce.y, targetPosition: Position.Left, targetAngleDeg,
  });
  _pathCache.set(id, { key, d });
  return d;
}

type ConnPayload = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node>;

export function ConnectionComponent({ data }: { data: ConnPayload }) {
  const { start, end } = useConnection();
  const [hovered, setHovered] = useState(false);
  const shape = useSyncExternalStore(cableShapeStore.subscribe, cableShapeStore.get);
  // Re-render when settings change so the "direct cables" perf toggle takes effect.
  useSyncExternalStore(settingsStore.subscribe, settingsStore.version);
  // Re-render when any socket's angle hint changes (a Conduit rotated, etc.).
  useSyncExternalStore(cableAngleStore.subscribe, () => 0);
  useSyncExternalStore(cableSelectionStore.subscribe, cableSelectionStore.version);
  useSyncExternalStore(cableValueStore.subscribe, cableValueStore.version);
  const flow = useSyncExternalStore(cableFlowStore.subscribe, cableFlowStore.get);
  // Subscribe to ghost membership changes so a ghost commit re-renders us.
  useSyncExternalStore(cableGhostStore.subscribe, cableGhostStore.version);
  // Socket-hover re-render trigger, narrowed to kill the all-cables fan-out.
  // Hovering one socket bumps the store once but used to re-render EVERY cable
  // (all subscribed to the global version). A standalone cable now watches only
  // its OWN hover flag, so an unrelated hover is an Object.is-equal snapshot and
  // skips its re-render. Ribbon members share appearance (one member hovered
  // lights the whole bundle), so they must still react to any member's change —
  // they fall back to the global version. ribbonRef is set after `ribbon` is
  // known below; the value is used only as a re-render key, never as logic
  // (socketHovered, the real boolean, is read separately).
  const ribbonRef = useRef(false);
  // Render mode: in "canvas" we publish this cable's visible stroke to cableScene
  // (CableCanvas paints it) and emit only the invisible hit path. Subscribing here
  // re-renders every cable when the mode flips.
  const renderMode = useRenderMode();
  // What to sync to the cable scene after THIS render (written in the render body,
  // applied in the layout effect below). Defaults to "remove" each render; only
  // the normal canvas-eligible return sets it.
  const publishRef = useRef<{ action: "set" | "remove"; draw?: CableStroke }>({ action: "remove" });
  useSyncExternalStore(
    socketHoverCableStore.subscribe,
    () => (ribbonRef.current ? socketHoverCableStore.version() : socketHoverCableStore.isHovered(data.id)),
  );
  const socketHovered = socketHoverCableStore.isHovered(data.id);
  // Hidden when it touches a member of a collapsed group.
  useSyncExternalStore(groupCollapseStore.subscribe, groupCollapseStore.version);
  // Ribbon membership changes with the connection set; trunk endpoints move
  // when a Conduit expands/rotates; ribbon hover is shared across components.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  useSyncExternalStore(conduitLayoutStore.subscribe, conduitLayoutStore.version);
  const hoveredRibbonKey = useSyncExternalStore(ribbonHoverStore.subscribe, ribbonHoverStore.get);
  // Isolate: a cable recedes when either end is outside the focus set.
  useSyncExternalStore(isolateStore.subscribe, isolateStore.version);
  const isoDim = isolateStore.isActive() && !!data.source && !!data.target
    && (!isolateStore.isVisible(data.source) || !isolateStore.isVisible(data.target));

  // Load reveal: while a graph is animating in, a cable stays hidden until its
  // turn, then fades + draws on (output → input). See loadReveal.ts.
  const revealActive = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.isActive);
  const revealed = useSyncExternalStore(loadRevealStore.subscribe, () => loadRevealStore.isConnRevealed(data.id));
  const hideForReveal = revealActive && !revealed;
  const revealStyle: React.CSSProperties | undefined = revealActive
    ? (hideForReveal ? { opacity: 0, transition: "opacity 340ms ease" } : { transition: "opacity 340ms ease" })
    : undefined;

  // The editor that OWNS this cable's endpoints — the drill-in's internal editor
  // when the cable renders inside an open composite, else main. Keyed on an
  // endpoint node id (a pseudo cable mid-drag has only one end). Resolving via
  // getEditor() (main) made every drill-in cable fall back to the default color
  // (no socket found), skip ribbon bundling, and miss the Conduit hit-trim.
  const editor = getOwningEditor(data.source || data.target);
  // Conduit-output ribbon this cable belongs to (2+ lanes to one Conduit/group).
  const ribbon = editor && data.source && data.target ? ribbonForConnection(editor, data) : null;
  const ribbonSelected =
    ribbon !== null && ribbon.members.some((m) => cableSelectionStore.has(m.id));
  const selected = cableSelectionStore.has(data.id);
  // Drives the socket-hover subscription's fan-out gate (see ribbonRef above):
  // ribbon members keep the global subscription, standalone cables go narrow.
  ribbonRef.current = ribbon !== null;

  // A selected cable jumps above every node and group. rete-area appends each
  // node/connection as a position:absolute holder child; rete-react then mounts
  // our <svg> inside a nested <span> within that child. z-index only bites on the
  // positioned holder child (the span is static), so target connectionViews'
  // element, not svg.parentElement. Reset on deselect / unmount.
  useLayoutEffect(() => {
    // Owning area, not main: a drill-in cable's holder lives in the drill-in's
    // AreaPlugin (see getOwningArea).
    const el = getOwningArea(data.source || data.target)?.connectionViews.get(data.id)?.element;
    if (!el) return;
    el.style.zIndex = selected || ribbonSelected ? "100" : "";
    return () => { el.style.zIndex = ""; };
  }, [selected, data.id, ribbonSelected, data.source, data.target]);

  // Evict this connection's cached path on unmount (or id change) so _pathCache
  // can't grow unbounded across a long session of cable create/delete churn.
  // Also drop it from the canvas scene so the painter stops drawing it.
  useLayoutEffect(() => () => { _pathCache.delete(data.id); cableScene.remove(data.id); }, [data.id]);

  // Sync this render's stroke into the cable scene (canvas mode) or remove it
  // (DOM mode, or a DOM-only case like ribbons / reveal / pseudo). Runs after
  // every render; publishRef was set during the render body.
  useLayoutEffect(() => {
    const p = publishRef.current;
    if (p.action === "set" && p.draw) cableScene.set(data.id, p.draw);
    else cableScene.remove(data.id);
  });

  // Default each render to "don't draw on canvas"; the normal canvas-eligible
  // return below overrides this. Any early return therefore removes the stroke.
  publishRef.current = { action: "remove" };

  if (groupCollapseStore.isConnHidden(data.id)) return null;

  // An endpoint that sits on a collapsed group's hidden member is drawn to that
  // group's edge pill instead (keyed by socket, so the in-progress drag from an
  // output pill anchors there too, not at the hidden member's 0,0).
  const pillPoint = (p: { groupId: string; side: "left" | "right"; index: number } | undefined) => {
    if (!p) return undefined;
    const g = getArea()?.nodeViews.get(p.groupId)?.position;
    if (!g) return undefined;
    return { x: p.side === "left" ? g.x : g.x + COLLAPSE_LAYOUT.width, y: g.y + pillY(p.index) };
  };
  let cs = start, ce = end;
  const outP = data.source ? pillPoint(groupCollapseStore.outPillFor(data.source, data.sourceOutput)) : undefined;
  if (outP) cs = outP;
  const inP = data.target ? pillPoint(groupCollapseStore.inPillFor(data.target, data.targetInput)) : undefined;
  if (inP) ce = inP;
  if (!cs || !ce) return null;

  const sourceAngleDeg = cableAngleStore.get(data.source, data.sourceOutput);
  const targetAngleDeg = cableAngleStore.get(data.target, data.targetInput);

  const pathD = cachedMainPath(data.id, shape, cs, ce, sourceAngleDeg, targetAngleDeg);

  const ghost = cableGhostStore.isGhost(data.id);
  const isPseudo = !data.target; // in-progress cable being drawn
  // Cable color follows the source socket's data type. When dragging from
  // an input socket the source side is null, so fall back to the target socket.
  // For combo socket types (numlist etc.) we resolve against the live output
  // value so the cable reflects what's actually flowing, not just the type.
  // Trace through a Conduit so the lane's real type colours the cable (see
  // resolveTypedSource) — otherwise a date/logical/frame passing through a
  // Conduit loses its colour (its `any` lane resolves by JS value type).
  const typed = data.source ? resolveTypedSource(editor, data.source, data.sourceOutput) : null;
  const sourceSocket = typed?.socket;
  const targetSocket = editor?.getNode(data.target)?.inputs[data.targetInput]?.socket;
  const activeSocket = sourceSocket ?? targetSocket;
  const valSource = typed?.source ?? data.source;
  const valOutput = typed?.sourceOutput ?? data.sourceOutput;

  let typeColor = DEFAULT_COLOR;
  if (activeSocket instanceof SolenoidSocket) {
    const dt = activeSocket.dataType;
    const isCombo = dt === "numlist" || dt === "strcombo" || dt === "datecombo" || dt === "any" || dt === "trueany";
    if (isCombo && valSource && valOutput) {
      const val = cableValueStore.get(valSource, valOutput);
      if (val !== undefined && val !== null) {
        // Resolve the combo against the live value: arrays take the combo's
        // list color, scalars its scalar color (any falls back to value kind).
        if (Array.isArray(val)) {
          typeColor = dt === "strcombo" ? SOCKET_COLORS.strlist
            : dt === "datecombo" ? SOCKET_COLORS.datelist
            : SOCKET_COLORS.list;
        } else if (typeof val === "string") {
          typeColor = SOCKET_COLORS.string;
        } else {
          typeColor = dt === "datecombo" ? SOCKET_COLORS.date : SOCKET_COLORS.number;
        }
      } else {
        typeColor = SOCKET_COLORS[dt] ?? DEFAULT_COLOR;
      }
    } else {
      typeColor = SOCKET_COLORS[dt] ?? DEFAULT_COLOR;
    }
  }
  const stroke = selected ? SELECTED_COLOR : typeColor;
  const activeHover = hovered || socketHovered;
  const baseWidth = selected ? 2.6 : (activeHover || isPseudo) ? 2.5 : 1.8;

  // Ctrl/Cmd-click (or a tap in touch select mode) accumulates cables into a
  // multi-selection instead of replacing it — mirrors node selection.
  const accumulating = (e: React.MouseEvent) => e.ctrlKey || e.metaKey || touchSelectStore.get();

  // Selecting a SEPARATED ribbon lane deselects its Conduit — pin the
  // separation open so the ribbon doesn't re-form under the click. The pin
  // holds exactly as long as this cable stays selected.
  const pinIfSeparatedLane = () => {
    if (!editor || !data.source || !data.target) return;
    const would = ribbonForConnection(editor, data, { ignoreSeparation: true });
    if (would) {
      pinRibbonSeparation(
        would.kind === "conduit" ? [would.sourceId, would.targetId] : [would.sourceId],
        data.id,
      );
    }
  };

  // ── Conduit ribbon: trunk + fan rendering ──────────────────────────────────
  // The trunk (drawn by the representative, lowest lane) runs between a merge
  // point just past the source Conduit's output face and a split point just
  // before the target Conduit's input face (or all the way onto a collapsed
  // group's combined pill — no target fan there). EVERY member draws its own
  // fan branches: source socket → its own slot on the trunk's flat starting
  // face, and from its own slot on the flat end face → target socket. Slots
  // are spread across the trunk width, ordered by lane rank on each side, so
  // branches sit side-by-side and can never cross. Hover and selection are
  // shared ribbon-wide via ribbonHoverStore / cableSelectionStore(repId), so
  // the whole thing behaves as one cable.
  // ── Inverse ribbon: bundle OUT of a collapsed group all the way to one dest ──
  // A Conduit hidden in a collapsed group whose outputs land on ONE destination
  // (a visible Conduit, or another collapsed group). cs is the source group's
  // combined OUTPUT pill (a stadium, like the input side); there is NO source fan
  // — the pill is the bundle cap. The trunk runs all the way to the destination:
  // a visible Conduit gets a target fan into its lanes; a collapsed group lands
  // whole on its input pill (ce). Mirror of the group-target case below.
  if (ribbon && ribbon.kind === "groupSource") {
    const tgtFace = ribbon.destKind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
    if (ribbon.destKind === "group" || tgtFace) {
      const n = ribbon.members.length;
      const lane = (key: string) => Number(key.slice(key.indexOf("_") + 1));
      const slot = (rank: number) => ((rank + 0.5) / n - 0.5) * RIBBON_WIDTH;
      const isRep = ribbon.repId === data.id;
      const srcPill = cs; // source group's combined output pill — exits +x

      let trunkEnd: { x: number; y: number };
      let trunkAngle: number | null = null;
      let tgtFanD: string | null = null;
      let tgtFanLen = 0;
      if (ribbon.destKind === "conduit" && tgtFace) {
        const radT = (tgtFace.angle * Math.PI) / 180;
        const split = { x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT, y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT };
        const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
        const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
        const tgtRank = byTgt.findIndex((m) => m.id === data.id);
        const tgtSlot = { x: split.x + perpT.x * slot(tgtRank), y: split.y + perpT.y * slot(tgtRank) };
        tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
        tgtFanLen = Math.hypot(ce.x - tgtSlot.x, ce.y - tgtSlot.y);
        trunkEnd = split;
        trunkAngle = tgtFace.angle;
      } else {
        trunkEnd = ce; // collapsed-group destination — land whole on its pill
      }

      let trunkD: string | null = null;
      let trunkLen = 0;
      if (isRep || flow) {
        trunkD = getCablePath(shape, {
          sourceX: srcPill.x, sourceY: srcPill.y, sourcePosition: Position.Right, sourceAngleDeg: 0,
          targetX: trunkEnd.x, targetY: trunkEnd.y, targetPosition: Position.Left, targetAngleDeg: trunkAngle,
        });
        if (flow) trunkLen = pathLength(trunkD, srcPill, trunkEnd);
      }

      const ribbonHover = hovered || hoveredRibbonKey === ribbon.key
        || ribbon.members.some((m) => socketHoverCableStore.isHovered(m.id));
      const active = ribbonHover || ribbonSelected;
      const trunkStroke = ribbonSelected ? SELECTED_COLOR : RIBBON_COLOR;
      const trunkW = ribbonSelected ? RIBBON_WIDTH + 1.2 : ribbonHover ? RIBBON_WIDTH + 0.8 : RIBBON_WIDTH;
      const fanStroke = ribbonSelected ? SELECTED_COLOR : typeColor;
      const fanW = active ? 2.2 : 1.6;
      const hoverKeys = ribbon.members.flatMap((m) => [
        dragSocketKey(m.source, m.sourceOutput),
        dragSocketKey(m.target, m.targetInput),
      ]);
      const onEnter = () => { setHovered(true); ribbonHoverStore.set(ribbon.key); socketHighlightStore.setCableHover(hoverKeys); };
      const onLeave = () => { setHovered(false); ribbonHoverStore.set(null); socketHighlightStore.setCableHover([]); };
      const onRibbonClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        standoffStore.select(null);
        if (accumulating(e)) {
          cableSelectionStore.toggle(ribbon.repId);
          if (cableSelectionStore.has(ribbon.repId)) unselectAllNodes();
          return;
        }
        if (ribbonSelected && cableSelectionStore.count() === 1) cableSelectionStore.set(null);
        else { cableSelectionStore.set(ribbon.repId); unselectAllNodes(); }
      };
      const hitProps = {
        fill: "none", stroke: "transparent", "data-conn-id": data.id,
        style: { cursor: "pointer", pointerEvents: "auto" } as React.CSSProperties,
        onMouseEnter: onEnter, onMouseLeave: onLeave, onClick: onRibbonClick,
        onPointerDown: stopDragStart, onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      };
      const showTrunk = isRep && trunkD;
      // Trunk hit: trimmed off the source pill (so its socket stays draggable),
      // and off the destination pill too when landing whole on a group.
      const trunkHitDash = showTrunk
        ? hitTrimDash(pathLength(trunkD!, srcPill, trunkEnd), BLOCK_HIT_CLEAR, ribbon.destKind === "group" ? BLOCK_HIT_CLEAR : 0)
        : undefined;
      return (
        <svg {...boundedSvgProps([cs, ce, trunkEnd], isoDim, revealStyle)}>
          {showTrunk && (
            <path d={trunkD!} fill="none" stroke={trunkStroke} strokeWidth={trunkW}
                  strokeLinecap="butt" opacity={active ? 0.95 : 0.85} pointerEvents="none" />
          )}
          {tgtFanD && (
            <path d={tgtFanD} fill="none" stroke={fanStroke} strokeWidth={fanW}
                  opacity={active ? 0.9 : 0.78} pointerEvents="none" />
          )}
          {/* Flow beads: trunk leaves the pill (phase 0); the fan continues once
              the bead reaches the trunk's end cap (trunkLen downstream). */}
          {flow && showTrunk && (
            <path className="solenoid-cable-flow" d={trunkD!} fill="none"
                  stroke={`color-mix(in srgb, ${RIBBON_COLOR} 70%, #fff)`}
                  strokeWidth={trunkW + 3.5} strokeLinecap="round" pointerEvents="none" />
          )}
          {flow && tgtFanD && (
            <path className="solenoid-cable-flow" d={tgtFanD} fill="none"
                  stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
                  strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
                  style={{ animationDelay: flowDelay(trunkLen) }} />
          )}
          {showTrunk && (
            <path className="solenoid-cable-hit" d={trunkD!} strokeWidth={TRUNK_HIT_W}
                  strokeDasharray={trunkHitDash} {...hitProps} />
          )}
          {tgtFanD && (
            <path className="solenoid-cable-hit" d={tgtFanD} strokeWidth={FAN_HIT_W}
                  strokeDasharray={hitTrimDash(tgtFanLen, 0, BLOCK_HIT_CLEAR)} {...hitProps} />
          )}
        </svg>
      );
    }
    // Destination Conduit not mounted yet (first frame) — fall through to normal.
  }

  if (ribbon) {
    const srcFace = conduitFacePoint(ribbon.sourceId, "out");
    const tgtFace = ribbon.kind === "conduit" ? conduitFacePoint(ribbon.targetId, "in") : null;
    if (srcFace && (ribbon.kind === "group" || tgtFace)) {
      const isRep = ribbon.repId === data.id;
      const n = ribbon.members.length;
      const lane = (key: string) => Number(key.slice(key.indexOf("_") + 1));
      // Slot offset across the trunk's flat cap for the given rank.
      const slot = (rank: number) => ((rank + 0.5) / n - 0.5) * RIBBON_WIDTH;

      // Source side: lanes converge onto the trunk's flat starting face.
      const radS = (srcFace.angle * Math.PI) / 180;
      const merge = {
        x: srcFace.x + Math.cos(radS) * RIBBON_SPLIT,
        y: srcFace.y + Math.sin(radS) * RIBBON_SPLIT,
      };
      // Perpendicular along which lane sockets spread (laneY direction).
      const perpS = { x: -Math.sin(radS), y: Math.cos(radS) };
      const srcRank = ribbon.members.findIndex((m) => m.id === data.id);
      const srcSlot = {
        x: merge.x + perpS.x * slot(srcRank),
        y: merge.y + perpS.y * slot(srcRank),
      };
      const srcFanD = `M ${cs.x},${cs.y} L ${srcSlot.x},${srcSlot.y}`;
      const srcFanLen = Math.hypot(srcSlot.x - cs.x, srcSlot.y - cs.y);

      let trunkD: string | null = null;
      let tgtFanD: string | null = null;
      let tgtFanLen = 0;
      let trunkLen = 0; // for the target fans' flow phase
      if (ribbon.kind === "conduit" && tgtFace) {
        const radT = (tgtFace.angle * Math.PI) / 180;
        const split = {
          x: tgtFace.x - Math.cos(radT) * RIBBON_SPLIT,
          y: tgtFace.y - Math.sin(radT) * RIBBON_SPLIT,
        };
        const perpT = { x: -Math.sin(radT), y: Math.cos(radT) };
        // Rank by TARGET lane on this side so slots match socket order.
        const byTgt = [...ribbon.members].sort((a, b) => lane(a.targetInput) - lane(b.targetInput));
        const tgtRank = byTgt.findIndex((m) => m.id === data.id);
        const tgtSlot = {
          x: split.x + perpT.x * slot(tgtRank),
          y: split.y + perpT.y * slot(tgtRank),
        };
        tgtFanD = `M ${tgtSlot.x},${tgtSlot.y} L ${ce.x},${ce.y}`;
        tgtFanLen = Math.hypot(ce.x - tgtSlot.x, ce.y - tgtSlot.y);
        // Non-reps don't render the trunk, but with flow on they still need
        // its LENGTH for their target fan's bead phase. Same inputs ⇒ every
        // member computes the identical trunk.
        if (isRep || flow) {
          trunkD = getCablePath(shape, {
            sourceX: merge.x, sourceY: merge.y,
            sourcePosition: Position.Right, sourceAngleDeg: srcFace.angle,
            targetX: split.x, targetY: split.y,
            targetPosition: Position.Left, targetAngleDeg: tgtFace.angle,
          });
          if (flow) trunkLen = pathLength(trunkD, merge, split);
        }
      } else if (isRep) {
        // Collapsed-group target: the trunk terminates whole on the combined
        // pill (ce is already redirected there) — no target fan.
        trunkD = getCablePath(shape, {
          sourceX: merge.x, sourceY: merge.y,
          sourcePosition: Position.Right, sourceAngleDeg: srcFace.angle,
          targetX: ce.x, targetY: ce.y,
          targetPosition: Position.Left, targetAngleDeg: null,
        });
      }

      const ribbonHover =
        hovered ||
        hoveredRibbonKey === ribbon.key ||
        ribbon.members.some((m) => socketHoverCableStore.isHovered(m.id));
      const active = ribbonHover || ribbonSelected;
      const trunkStroke = ribbonSelected ? SELECTED_COLOR : RIBBON_COLOR;
      const trunkW = ribbonSelected ? RIBBON_WIDTH + 1.2 : ribbonHover ? RIBBON_WIDTH + 0.8 : RIBBON_WIDTH;
      const fanStroke = ribbonSelected ? SELECTED_COLOR : typeColor;
      const fanW = active ? 2.2 : 1.6;
      const hoverKeys = ribbon.members.flatMap((m) => [
        dragSocketKey(m.source, m.sourceOutput),
        dragSocketKey(m.target, m.targetInput),
      ]);
      const onEnter = () => {
        setHovered(true);
        ribbonHoverStore.set(ribbon.key);
        socketHighlightStore.setCableHover(hoverKeys);
      };
      const onLeave = () => {
        setHovered(false);
        ribbonHoverStore.set(null);
        socketHighlightStore.setCableHover([]);
      };
      const onRibbonClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        standoffStore.select(null);
        if (accumulating(e)) {
          // Toggle the whole ribbon (its representative) in/out of the set.
          cableSelectionStore.toggle(ribbon.repId);
          if (cableSelectionStore.has(ribbon.repId)) unselectAllNodes();
          return;
        }
        if (ribbonSelected && cableSelectionStore.count() === 1) {
          cableSelectionStore.set(null);
        } else {
          cableSelectionStore.set(ribbon.repId);
          unselectAllNodes();
        }
      };
      const hitProps = {
        fill: "none",
        stroke: "transparent",
        "data-conn-id": data.id,
        style: { cursor: "pointer", pointerEvents: "auto" } as React.CSSProperties,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        onClick: onRibbonClick,
        onPointerDown: stopDragStart,
        onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
      };
      const fans = [srcFanD, tgtFanD].filter((d): d is string => d !== null);
      // Fan hit strokes yield near the conduit faces so the block stays
      // clickable (see BLOCK_HIT_CLEAR above). The trunk starts/stops
      // RIBBON_SPLIT off the faces and never covers the block.
      const fanHits: Array<{ d: string; dash?: string }> = [
        { d: srcFanD, dash: hitTrimDash(srcFanLen, BLOCK_HIT_CLEAR, 0) },
      ];
      if (tgtFanD) fanHits.push({ d: tgtFanD, dash: hitTrimDash(tgtFanLen, 0, BLOCK_HIT_CLEAR) });
      const showTrunk = isRep && trunkD;
      return (
        <svg {...boundedSvgProps([cs, ce, srcFace, merge], isoDim, revealStyle)}>
          {showTrunk && (
            // Flat (butt) caps: the fans emerge side-by-side from the cut face.
            <path
              d={trunkD!} fill="none" stroke={trunkStroke} strokeWidth={trunkW}
              strokeLinecap="butt" opacity={active ? 0.95 : 0.85} pointerEvents="none"
            />
          )}
          {fans.map((d, i) => (
            <path
              key={`fan${i}`} d={d} fill="none" stroke={fanStroke} strokeWidth={fanW}
              opacity={active ? 0.9 : 0.78} pointerEvents="none"
            />
          ))}
          {/* Flow beads, phase-aligned across the assembly: source fans start
              at the sockets (phase 0), the trunk's beads start when the fan
              beads reach the merge face, the target fans continue from the
              trunk's end. The flow overlays MUST keep round caps — the beads
              are 0.01-length dashes that butt caps flatten into slivers. */}
          {flow && showTrunk && (
            <path
              className="solenoid-cable-flow" d={trunkD!} fill="none"
              stroke={`color-mix(in srgb, ${RIBBON_COLOR} 70%, #fff)`}
              strokeWidth={trunkW + 3.5} strokeLinecap="round" pointerEvents="none"
              style={{ animationDelay: flowDelay(RIBBON_SPLIT) }}
            />
          )}
          {flow && (
            <path
              className="solenoid-cable-flow" d={srcFanD} fill="none"
              stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
              strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
            />
          )}
          {flow && tgtFanD && (
            <path
              className="solenoid-cable-flow" d={tgtFanD} fill="none"
              stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
              strokeWidth={fanW + 3} strokeLinecap="round" pointerEvents="none"
              style={{ animationDelay: flowDelay(RIBBON_SPLIT + trunkLen) }}
            />
          )}
          {showTrunk && <path className="solenoid-cable-hit" d={trunkD!} strokeWidth={TRUNK_HIT_W} {...hitProps} />}
          {fanHits.map((f, i) => (
            <path
              key={`fanhit${i}`} className="solenoid-cable-hit" d={f.d}
              strokeWidth={FAN_HIT_W} strokeDasharray={f.dash} {...hitProps}
            />
          ))}
        </svg>
      );
    }
    // Conduit layout not published yet (first mount) — fall through to normal.
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    standoffStore.select(null);
    if (ghost) {
      // Click on a ghost commits it to a real cable.
      cableGhostStore.commit(data.id);
      cableSelectionStore.set(null);
      return;
    }
    if (accumulating(e)) {
      cableSelectionStore.toggle(data.id);
      if (cableSelectionStore.has(data.id)) {
        unselectAllNodes();
        pinIfSeparatedLane();
      }
      return;
    }
    if (selected && cableSelectionStore.count() === 1) {
      // Plain click on the sole selected cable deselects it; on a cable in a
      // multi-selection it collapses the selection to just that cable (the
      // `else` below) — same as plain-clicking a node in a multi-selection.
      cableSelectionStore.set(null);
    } else {
      cableSelectionStore.set(data.id);
      // Cable + node selections stay mutually exclusive.
      unselectAllNodes();
      pinIfSeparatedLane();
    }
  }

  // Hit clearance near block endpoints (see BLOCK_HIT_CLEAR above).
  const srcBlock = !!data.source && editor?.getNode(data.source) instanceof ConduitNode;
  const tgtBlock = !!data.target && editor?.getNode(data.target) instanceof ConduitNode;
  const hitDash = srcBlock || tgtBlock
    ? hitTrimDash(
        pathLength(pathD, cs, ce),
        srcBlock ? BLOCK_HIT_CLEAR : 0,
        tgtBlock ? BLOCK_HIT_CLEAR : 0,
      )
    : undefined;

  // Reveal "drawing" effect: dash the whole path length and animate the offset
  // from full (undrawn) to 0 (drawn) the instant this cable is revealed. The
  // path string starts at the source output, so the line draws output → input.
  const drawLen = revealActive ? pathLength(pathD, cs, ce) : 0;

  // The 0.72 idle value is mirrored by the gesture canvas (htmlCanvasRenderer
  // drawCables globalAlpha) — change them together or the swap pops.
  const cableOpacity = ghost ? 0.65 : activeHover || selected || isPseudo ? 0.9 : 0.72;

  // Canvas mode: move the VISIBLE stroke to the shared canvas layer (CableCanvas)
  // for this normal cable, keeping the invisible hit path in the DOM. Excluded:
  // the reveal cinematic (DOM owns the draw-on animation), in-progress pseudo
  // cables (transient, follow the cursor), and flow-on cables (the bead animation
  // stays on the CSS/SVG path). Ribbons never reach here (they returned earlier).
  const canvasEligible = renderMode === "canvas" && !revealActive && !isPseudo && !flow;
  if (canvasEligible) {
    publishRef.current = {
      action: "set",
      draw: {
        d: pathD,
        color: stroke,
        width: baseWidth,
        // isoDim is the DOM SVG wrapper's opacity:0.1; fold it into the stroke
        // here, since the canvas stroke doesn't inherit that wrapper.
        opacity: cableOpacity * (isoDim ? 0.1 : 1),
        dash: ghost ? [6, 5] : undefined,
        // A selected cable paints above nodes, mirroring the DOM z-index:100 jump.
        above: selected,
      },
    };
  }

  return (
    <svg {...boundedSvgProps([cs, ce], isoDim, revealStyle)}>
      {!canvasEligible && <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={baseWidth}
        strokeDasharray={revealActive ? drawLen : ghost ? "6 5" : undefined}
        strokeDashoffset={revealActive ? (revealed ? 0 : drawLen) : undefined}
        style={revealActive ? { transition: "stroke-dashoffset 440ms ease" } : undefined}
        // Idle cables sit slightly dimmer than before; hover / selected
        // stay at the previous 0.9 so hovering now lifts a cable out of
        // the pack — easier to trace where overlapping ones go.
        opacity={cableOpacity}
        pointerEvents="none"
      />}
      {/* Animated mode: a stream of beads riding the cable from output → input.
          Real, committed cables only — a half-drawn or ghost cable isn't
          carrying data yet. Beads are a brightened tint of the cable's type
          color; the flow itself is a CSS dash animation (see canvas.css). */}
      {flow && !isPseudo && !ghost && !revealActive && (
        <path
          className="solenoid-cable-flow"
          d={pathD}
          fill="none"
          stroke={`color-mix(in srgb, ${typeColor} 85%, #fff)`}
          strokeWidth={baseWidth + 3.5}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}
      <path
        className="solenoid-cable-hit"
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={CABLE_HIT_W}
        strokeDasharray={hitDash}
        data-conn-id={data.id}
        style={{ cursor: "pointer", pointerEvents: "auto" }}
        onMouseEnter={() => {
          setHovered(true);
          if (data.source && data.target) {
            socketHighlightStore.setCableHover([
              dragSocketKey(data.source, data.sourceOutput),
              dragSocketKey(data.target, data.targetInput),
            ]);
          }
        }}
        onMouseLeave={() => {
          setHovered(false);
          socketHighlightStore.setCableHover([]);
        }}
        onClick={onClick}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </svg>
  );
}

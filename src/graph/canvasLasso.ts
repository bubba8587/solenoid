// Shift-drag lasso selection (extracted from Canvas.tsx). AutoCAD-style:
// CW winding (positive signed area in screen coords) = touch / crossing —
// any overlap with a node selects it. CCW winding = window / enclose — only
// nodes fully inside the lasso are selected.
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { AreaPlugin } from "rete-area-plugin";
import type { Schemes, AreaExtra } from "./schemes";
import { pointInPolygon, polygonIntersectsBBox, signedArea, lassoActiveStore, type Pt } from "./lasso";
import { groupCollapseStore } from "./groupCollapse";
import { isolateStore } from "./isolateStore";
import { touchSelectStore } from "./touchSelectStore";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import {
  unselectAllNodes as unselectAllNodesFromProcess,
  selectNode as selectNodeFromProcess,
} from "./process";
import { isPinching, isPalmContact, onPenDown } from "./pointerGesture";

export type LassoState = { points: Pt[]; mode: "touch" | "enclose" } | null;

export interface LassoDeps {
  container: HTMLElement;
  editorRef: MutableRefObject<NodeEditor<Schemes> | null>;
  areaRef: MutableRefObject<AreaPlugin<Schemes, AreaExtra> | null>;
  /** Feeds the lasso outline <svg> in Canvas's JSX. */
  setLasso: (l: LassoState) => void;
}

// Installs the capture-phase pointerdown starter on the container; returns the remover.
export function installLassoSelection(deps: LassoDeps): () => void {
  const { container, editorRef, areaRef, setLasso } = deps;
  const points: Pt[] = [];
  let active = false;

  // Node screen-corners, cached once at lasso start. A lasso owns the pointer,
  // so the canvas can't pan/zoom and nodes can't move during it — their rects
  // are stable. Reading them once kills the O(N) getBoundingClientRect (a
  // forced reflow) that otherwise ran every coalesced frame.
  let nodeCorners: Array<{ id: string; corners: Pt[] }> = [];
  // Signature of the last applied node match, so an unchanged set (lasso grew
  // but crossed no new node) skips the unselect-all + reselect churn.
  let lastNodeSig = "";
  function cacheNodeRects() {
    const area = areaRef.current;
    nodeCorners = [];
    if (!area) return;
    const cr = container.getBoundingClientRect();
    for (const [id, view] of area.nodeViews) {
      // Skip members hidden inside a collapsed group. They're `visibility:hidden`
      // but still LAID OUT at their pre-collapse positions (deliberately, to keep
      // socket/size measurement valid), so getBoundingClientRect returns a real
      // box the lasso would otherwise "reach over" and select invisibly — pulling
      // them into a new group when the user then hits G. The group node itself
      // stays visible (never in this set), so a collapsed group is still lassoable.
      if (groupCollapseStore.isNodeHidden(id)) continue;
      // Isolate's non-focus nodes are receded to opacity .08 + pointer-events:none —
      // effectively invisible, so the lasso must not reach them either (same rule
      // as Ctrl+A: you select what you can see).
      if (!isolateStore.isVisible(id)) continue;
      const br = view.element.getBoundingClientRect();
      nodeCorners.push({ id, corners: [
        { x: br.left  - cr.left, y: br.top    - cr.top },
        { x: br.right - cr.left, y: br.top    - cr.top },
        { x: br.right - cr.left, y: br.bottom - cr.top },
        { x: br.left  - cr.left, y: br.bottom - cr.top },
      ] });
    }
  }

  // applyLasso is heavy — it bbox-tests every node AND (on release) samples
  // every cable's SVG path (getTotalLength/getPointAtLength). `pointermove`
  // fires at the mouse's poll rate (well above the refresh rate on a gaming
  // mouse), so running it per move saturates the main thread. Coalesce to at
  // most one apply per animation frame; the visual lasso outline still updates
  // per move. Live frames select nodes only — the precise cable hit-test is
  // deferred to release (drop), off the hot path.
  let lassoRaf = 0;
  let latestMode: "touch" | "enclose" = "touch";
  const scheduleApply = (mode: "touch" | "enclose") => {
    latestMode = mode;
    if (lassoRaf) return;
    lassoRaf = requestAnimationFrame(() => {
      lassoRaf = 0;
      if (active && points.length >= 3) applyLasso(points, latestMode, false);
    });
  };

  function relPoint(e: PointerEvent): Pt {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function modeOf(pts: Pt[]) {
    return signedArea(pts) > 0 ? "touch" : "enclose";
  }

  function onDown(e: PointerEvent) {
    // Shift-drag (desktop) or touch select mode (mobile) starts a lasso; a
    // plain primary-button drag otherwise falls through to the area pan.
    const selectMode = touchSelectStore.get();
    if ((!e.shiftKey && !selectMode) || e.button !== 0) return;
    // Multi-touch is a pinch / two-finger pan, NEVER a lasso. If a second finger
    // lands (this pointer OR a lasso already in flight), abort the lasso and let
    // this pointer reach the area WITHOUT stopPropagation, so rete can pan/zoom.
    // (The census already counts this pointer: it listens on WINDOW capture, which
    // runs before this container-capture handler.) Checked before the node-target
    // test so a second finger landing on a node still releases the lasso.
    if (active || isPinching()) {
      cancelLasso();
      return;
    }
    // A palm landing beside an in-contact stylus must not draw a lasso.
    if (isPalmContact(e)) return;
    // Don't start a lasso when the click landed on a node or a socket inside
    // one (so click-drag-on-socket cable creation isn't stolen, and tapping a
    // note/group in touch-select mode selects it rather than lassoing). Test
    // area.nodeViews containment — the authoritative node-root check per
    // CLAUDE.md. A CSS class list (`.solenoid-node, …`) silently misses
    // whichever roots it forgot: this one omitted `.solenoid-note` and
    // `.solenoid-group`, so a touch on either wrongly began a lasso.
    const target = e.target as Element | null;
    const area = areaRef.current;
    if (target && area) {
      for (const [, v] of area.nodeViews) if (v.element.contains(target)) return;
    }
    e.preventDefault();
    // Desktop shift-lasso: stop the press reaching rete's area drag, or it pans
    // while you lasso. Mobile select mode does NOT stopPropagation — rete's Drag
    // (pan) handler is disabled for the duration instead (see the select-mode
    // effect), and the ZOOM handler must still SEE this pointer so a second finger
    // makes a 2-finger pinch/pan (stopPropagation here hid finger 1 from it, which
    // is why zoom never worked in select mode).
    if (!selectMode) e.stopPropagation();
    active = true;
    points.length = 0;
    points.push(relPoint(e));
    lastNodeSig = "";
    cacheNodeRects();
    setLasso({ points: [...points], mode: "touch" });
    lassoActiveStore.set(true); // let the canvas renderer take over for the lasso
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function onMove(e: PointerEvent) {
    if (!active) return;
    // A finger joined mid-drag (pinch/pan) — bail even if this pointer's own
    // moves keep firing (the resting first finger's wouldn't).
    if (isPinching()) { cancelLasso(); return; }
    const p = relPoint(e);
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    points.push(p);
    const mode: "touch" | "enclose" = modeOf(points);
    setLasso({ points: [...points], mode });
    // Live selection — coalesced to one apply per frame (see scheduleApply) so
    // nodes light up / dim as the lasso grows without per-move thrash.
    if (points.length >= 3) scheduleApply(mode);
  }
  function onUp() {
    if (!active) return;
    active = false;
    lassoActiveStore.set(false); // hand back to the DOM (after the canvas settle)
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    // Flush a final apply so the release selection is exact (a coalesced frame
    // may still be pending, or the last move may not have applied yet).
    if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
    if (points.length >= 3) applyLasso(points, latestMode, true);
    setLasso(null);
  }
  // Abort an in-flight lasso WITHOUT applying it — used when a gesture turns out
  // to be a pinch / two-finger pan. Leaves the current selection untouched (a
  // clean 2-finger gesture lands both fingers before the first builds a polygon).
  function cancelLasso() {
    if (!active) return;
    active = false;
    lassoActiveStore.set(false);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
    setLasso(null);
  }

  function applyLasso(pts: Pt[], mode: "touch" | "enclose", includeCables: boolean) {
    const editor = editorRef.current;
    const area = areaRef.current;
    if (!editor || !area) return;
    const matched: string[] = [];
    for (const { id, corners } of nodeCorners) {
      let hit = false;
      if (mode === "enclose") {
        hit = corners.every((c) => pointInPolygon(c, pts));
      } else {
        hit = corners.some((c) => pointInPolygon(c, pts))
           || pointInPolygon(pts[0], corners)        // lasso wholly inside node
           || polygonIntersectsBBox(pts, corners);
      }
      if (hit) matched.push(id);
    }
    // Skip the re-apply when the match set is unchanged from the last frame —
    // unselect-all + reselect re-renders every selected node, so this avoids
    // per-frame churn while the lasso grows over empty space.
    const sig = mode + "|" + matched.join(",");
    if (sig !== lastNodeSig) {
      lastNodeSig = sig;
      unselectAllNodesFromProcess();
      for (let i = 0; i < matched.length; i++) {
        // First node replaces; rest accumulate.
        selectNodeFromProcess(matched[i], i > 0);
      }
    }

    // Precise cable hit-testing is deferred to release (drop) — it samples
    // every cable's SVG path, far too heavy for the per-frame hot path.
    if (!includeCables) return;

    // Cables: sample each cable's rendered hit paths (canvas coords → screen
    // via the area transform) and test the samples against the polygon.
    // Touch mode: any sample inside selects; enclose: every sample must be
    // inside. A Ribbon is one entity — its members are judged as a unit and
    // selected together.
    const { x: tx, y: ty, k } = area.area.transform;
    const unitHit = (unit: string[]): boolean => {
      let any = false;
      let all = true;
      let samples = 0;
      for (const id of unit) {
        const el = area.connectionViews.get(id)?.element;
        if (!el) continue;
        for (const path of el.querySelectorAll<SVGPathElement>("path.solenoid-cable-hit")) {
          let len = 0;
          try { len = path.getTotalLength(); } catch { continue; }
          if (!Number.isFinite(len) || len <= 0) continue;
          // ~every 12 screen px, capped so a very long cable stays cheap.
          const step = Math.max(12 / k, len / 64);
          for (let d = 0; ; d += step) {
            const at = Math.min(d, len);
            const p = path.getPointAtLength(at);
            samples++;
            if (pointInPolygon({ x: p.x * k + tx, y: p.y * k + ty }, pts)) any = true;
            else all = false;
            // Early out once the verdict can't change.
            if (mode === "touch" && any) return true;
            if (mode === "enclose" && !all) return false;
            if (at >= len) break;
          }
        }
      }
      return samples > 0 && (mode === "enclose" ? all : any);
    };
    const matchedCables: string[] = [];
    const seen = new Set<string>();
    for (const conn of editor.getConnections()) {
      if (seen.has(conn.id) || cableGhostStore.isGhost(conn.id)) continue;
      const ribbon = ribbonForConnection(editor, conn);
      const unit = ribbon ? ribbon.members.map((m) => m.id) : [conn.id];
      for (const id of unit) seen.add(id);
      if (unitHit(unit)) matchedCables.push(...unit);
    }
    cableSelectionStore.replaceAll(matchedCables);
  }

  container.addEventListener("pointerdown", onDown, true);
  // Forward-only palm rejection can't un-register a palm that landed BEFORE the pen
  // (the usual grip), so the stylus instead cancels whatever that palm began — the
  // palm can start a lasso, but never finish one.
  const stopPenSub = onPenDown(cancelLasso);
  return () => {
    stopPenSub();
    container.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (lassoRaf) cancelAnimationFrame(lassoRaf);
  };
}

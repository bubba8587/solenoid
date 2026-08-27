// AutoCAD winding rule: CW (positive signed area in screen coords) = touch/crossing,
// CCW = window/enclose.
import type { Area } from "./area";
import type { MutableRefObject } from "react";
import type { NodeEditor } from "rete";
import type { Schemes } from "./schemes";
import { pointInPolygon, polygonIntersectsBBox, signedArea, lassoActiveStore, type Pt } from "./lasso";
import { groupCollapseStore } from "./groupCollapse";
import { isolateStore } from "./isolateStore";
import { touchSelectStore } from "./touchSelectStore";
import { cableSelectionStore, cableGhostStore } from "./cableState";
import { ribbonForConnection } from "./ribbonCable";
import { unselectAllNodes as unselectAllNodesFromProcess, selectNode as selectNodeFromProcess } from "./canvasCommands";
import { isPinching } from "./pointerGesture";

export type LassoState = { points: Pt[]; mode: "touch" | "enclose" } | null;

export interface LassoDeps {
  container: HTMLElement;
  editorRef: MutableRefObject<NodeEditor<Schemes> | null>;
  areaRef: MutableRefObject<Area | null>;
  /** Feeds the lasso outline <svg> in Canvas's JSX. */
  setLasso: (l: LassoState) => void;
}

export function installLassoSelection(deps: LassoDeps): () => void {
  const { container, editorRef, areaRef, setLasso } = deps;
  const points: Pt[] = [];
  let active = false;

  // Cached once at lasso start: the lasso owns the pointer, so rects are stable and
  // reading them per frame would force an O(N) reflow.
  let nodeCorners: Array<{ id: string; corners: Pt[] }> = [];
  // Signature of the last applied match, so an unchanged set skips the reselect churn.
  let lastNodeSig = "";
  function cacheNodeRects() {
    const area = areaRef.current;
    nodeCorners = [];
    if (!area) return;
    const cr = container.getBoundingClientRect();
    for (const [id, view] of area.nodeViews) {
      // Members of a collapsed group stay LAID OUT at their pre-collapse positions,
      // so their rects are real and the lasso would select them invisibly.
      if (groupCollapseStore.isNodeHidden(id)) continue;
      // Same rule as Ctrl+A: the lasso reaches only what you can see.
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

  // `pointermove` fires at the mouse's poll rate, far above the refresh rate, so
  // applyLasso is coalesced to one call per frame; the outline still updates per move.
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
    // A plain primary-button drag must fall through to the area pan.
    const selectMode = touchSelectStore.get();
    if ((!e.shiftKey && !selectMode) || e.button !== 0) return;
    // Multi-touch is a pinch, NEVER a lasso: abort and let the pointer reach the area
    // WITHOUT stopPropagation. Must precede the node-target test so a second finger
    // landing on a node still releases the lasso.
    if (active || isPinching()) {
      cancelLasso();
      return;
    }
    // A press inside a node starts no lasso (socket cable-drags must survive). Test
    // area.nodeViews containment — a CSS class list silently misses roots.
    const target = e.target as Element | null;
    const area = areaRef.current;
    if (target && area) {
      for (const [, v] of area.nodeViews) if (v.element.contains(target)) return;
    }
    e.preventDefault();
    // Desktop stops the press reaching rete's area drag, or it pans while you lasso.
    // Mobile select mode must NOT — the zoom handler has to see finger 1 for a pinch.
    if (!selectMode) e.stopPropagation();
    active = true;
    lassoActiveStore.set(true);
    points.length = 0;
    points.push(relPoint(e));
    lastNodeSig = "";
    cacheNodeRects();
    setLasso({ points: [...points], mode: "touch" });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  function onMove(e: PointerEvent) {
    if (!active) return;
    // A finger joined mid-drag — bail even though this pointer's moves keep firing.
    if (isPinching()) { cancelLasso(); return; }
    const p = relPoint(e);
    const last = points[points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    points.push(p);
    const mode: "touch" | "enclose" = modeOf(points);
    setLasso({ points: [...points], mode });
    if (points.length >= 3) scheduleApply(mode);
  }
  function onUp() {
    if (!active) return;
    active = false;
    lassoActiveStore.set(false);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    // Flush a final apply — a coalesced frame may still be pending.
    if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
    if (points.length >= 3) applyLasso(points, latestMode, true);
    setLasso(null);
    // The stopped pointerdown still yields a `click` on release, and React Flow's pane
    // clears the selection on click: swallow that ONE click (the same task), no more.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    container.addEventListener("click", swallow, true);
    setTimeout(() => container.removeEventListener("click", swallow, true), 0);
  }
  // Aborts WITHOUT applying, leaving the current selection untouched.
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
    // unselect-all + reselect re-renders every selected node, so skip an unchanged set.
    const sig = mode + "|" + matched.join(",");
    if (sig !== lastNodeSig) {
      lastNodeSig = sig;
      unselectAllNodesFromProcess();
      for (let i = 0; i < matched.length; i++) {
        selectNodeFromProcess(matched[i], i > 0);
      }
    }

    // Cable hit-testing samples every cable's SVG path, far too heavy for the
    // per-frame path, so it runs only on release.
    if (!includeCables) return;

    // A Ribbon is ONE entity — its members are judged as a unit and selected together.
    const { x: tx, y: ty, k } = area.transform;
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
  return () => {
    container.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (lassoRaf) cancelAnimationFrame(lassoRaf);
  };
}

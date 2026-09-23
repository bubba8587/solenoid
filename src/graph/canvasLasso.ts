// [[C52]] visibleSelection, [[C92]] pinchUnvetoable
import type { View } from "./view";
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
  viewRef: MutableRefObject<View | null>;
  setLasso: (l: LassoState) => void;
}

export function installLassoSelection(deps: LassoDeps): () => void {
  const { container, editorRef, viewRef, setLasso } = deps;
  const points: Pt[] = [];
  let active = false;

  let nodeCorners: Array<{ id: string; corners: Pt[] }> = [];
  let lastNodeSig = "";
  function cacheNodeRects() {
    const view = viewRef.current;
    const editor = editorRef.current;
    nodeCorners = [];
    if (!view || !editor) return;
    const cr = container.getBoundingClientRect();
    for (const { id } of editor.getNodes()) {
      if (groupCollapseStore.isNodeHidden(id)) continue;
      if (!isolateStore.isVisible(id)) continue;
      const el = view.nodeElement(id);
      if (!el) continue;
      const br = el.getBoundingClientRect();
      nodeCorners.push({ id, corners: [
        { x: br.left  - cr.left, y: br.top    - cr.top },
        { x: br.right - cr.left, y: br.top    - cr.top },
        { x: br.right - cr.left, y: br.bottom - cr.top },
        { x: br.left  - cr.left, y: br.bottom - cr.top },
      ] });
    }
  }

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
    const selectMode = touchSelectStore.get();
    if ((!e.shiftKey && !selectMode) || e.button !== 0) return;
    // Must precede the node-target test, so a second finger landing on a node still releases the lasso.
    if (active || isPinching()) {
      cancelLasso();
      return;
    }
    // Test live node-element containment: a CSS class list silently misses some roots.
    const target = e.target as Element | null;
    const view = viewRef.current;
    const editor = editorRef.current;
    if (target && view && editor) {
      for (const { id } of editor.getNodes()) if (view.nodeElement(id)?.contains(target)) return;
    }
    e.preventDefault();
    // Desktop stops the press or the pane pans under the lasso; select mode must not, so the pinch sees finger one.
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
    if (lassoRaf) { cancelAnimationFrame(lassoRaf); lassoRaf = 0; }
    if (points.length >= 3) applyLasso(points, latestMode, true);
    setLasso(null);
    // The stopped pointerdown still yields a click that RF's pane would use to clear the selection: swallow that one click.
    const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
    container.addEventListener("click", swallow, true);
    setTimeout(() => container.removeEventListener("click", swallow, true), 0);
  }
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
    const view = viewRef.current;
    if (!editor || !view) return;
    const matched: string[] = [];
    for (const { id, corners } of nodeCorners) {
      let hit = false;
      if (mode === "enclose") {
        hit = corners.every((c) => pointInPolygon(c, pts));
      } else {
        hit = corners.some((c) => pointInPolygon(c, pts))
           || pointInPolygon(pts[0], corners)
           || polygonIntersectsBBox(pts, corners);
      }
      if (hit) matched.push(id);
    }
    const sig = mode + "|" + matched.join(",");
    if (sig !== lastNodeSig) {
      lastNodeSig = sig;
      unselectAllNodesFromProcess();
      for (let i = 0; i < matched.length; i++) {
        selectNodeFromProcess(matched[i], i > 0);
      }
    }

    if (!includeCables) return;

    const { x: tx, y: ty, k } = view.transform;
    const unitHit = (unit: string[]): boolean => {
      let any = false;
      let all = true;
      let samples = 0;
      for (const id of unit) {
        const el = view.connectionElement(id);
        if (!el) continue;
        for (const path of el.querySelectorAll<SVGPathElement>("path.solenoid-cable-hit")) {
          let len = 0;
          try { len = path.getTotalLength(); } catch { continue; }
          if (!Number.isFinite(len) || len <= 0) continue;
          const step = Math.max(12 / k, len / 64);
          for (let d = 0; ; d += step) {
            const at = Math.min(d, len);
            const p = path.getPointAtLength(at);
            samples++;
            if (pointInPolygon({ x: p.x * k + tx, y: p.y * k + ty }, pts)) any = true;
            else all = false;
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

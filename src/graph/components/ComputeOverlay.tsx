import { useSyncExternalStore } from "react";
import type { PointerEvent, WheelEvent, MouseEvent } from "react";
import { computeOverlayStore } from "../computeOverlayStore";
import { loadRevealStore } from "../loadReveal";
import "./ComputeOverlay.css";

/** The "busy" curtain for a heavy recompute (computeOverlayStore owns the deferred +
 *  min-visible timing). It SWALLOWS pointer / wheel events so pan, zoom, node drag and
 *  cable drag are inert while the pass runs. Suppressed while the load overlay is up. */
export function ComputeOverlay() {
  const visible = useSyncExternalStore(computeOverlayStore.subscribe, computeOverlayStore.visible);
  const loadPhase = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.phase);
  if (!visible || loadPhase !== "idle") return null;

  // Eat every gesture that would reach the canvas below.
  const eat = (e: PointerEvent | MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  const eatWheel = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div
      className="solenoid-compute-overlay"
      onPointerDown={eat}
      onPointerUp={eat}
      onMouseDown={eat}
      onClick={eat}
      onWheel={eatWheel}
      onContextMenu={eat}
    >
      <div className="solenoid-compute-overlay__card">
        <span className="solenoid-compute-overlay__spinner" aria-hidden="true" />
        <span className="solenoid-compute-overlay__label">Computing…</span>
      </div>
    </div>
  );
}

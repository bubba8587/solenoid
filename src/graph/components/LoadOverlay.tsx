import { useSyncExternalStore } from "react";
import { loadRevealStore } from "../loadReveal";
import "./LoadOverlay.css";

/** Curtain hiding node-by-node construction during a load. */
export function LoadOverlay() {
  const phase = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.phase);
  const progress = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.progress);
  if (phase === "idle") return null;

  const pct = Math.round(progress * 100);
  return (
    <div className="solenoid-load-overlay">
      <div className="solenoid-load-overlay__card">
        <div className="solenoid-load-overlay__label">Loading graph</div>
        <div className="solenoid-load-overlay__track">
          <div className="solenoid-load-overlay__fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="solenoid-load-overlay__pct">{pct}%</div>
      </div>
    </div>
  );
}

import { useSyncExternalStore } from "react";
import { loadRevealStore } from "../loadReveal";
import "./LoadOverlay.css";

/**
 * The build-phase curtain: a centered card with an accurate progress bar shown
 * while a graph is constructed on load (startup / File → Open). It covers the
 * canvas so the node-by-node construction never shows; once building finishes the
 * phase flips to "revealing" and this fades out, uncovering the staged reveal.
 * Driven entirely by loadRevealStore (see loadReveal.ts).
 */
export function LoadOverlay() {
  const phase = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.phase);
  const progress = useSyncExternalStore(loadRevealStore.subscribe, loadRevealStore.progress);
  if (phase === "idle") return null;

  const pct = Math.round(progress * 100);
  return (
    <div className={`solenoid-load-overlay${phase === "revealing" ? " solenoid-load-overlay--leaving" : ""}`}>
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

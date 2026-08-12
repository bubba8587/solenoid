import { useState } from "react";
import { isWebDemo } from "../env";
import "./WebDemoBanner.css";

// Web frontend only, never the Tauri shell. Disabled for now (author request) —
// keep the component so flipping this flag back re-enables it.
const WEB_DEMO_BANNER_ENABLED = false;

export function WebDemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (!WEB_DEMO_BANNER_ENABLED || !isWebDemo || dismissed) return null;

  const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

  return (
    <div className="solenoid-webdemo" onPointerDown={stop} onMouseDown={stop}>
      <span className="solenoid-webdemo__text">
        You're on the <strong>web demo</strong>. Your graph isn't saved between visits.
      </span>
      {/* Link disabled while the repo isn't public: restore href/target/rel. */}
      <a
        className="solenoid-webdemo__download solenoid-webdemo__download--disabled"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
      >
        Download the desktop app
      </a>
      <button
        type="button"
        className="solenoid-webdemo__close"
        title="Dismiss"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}

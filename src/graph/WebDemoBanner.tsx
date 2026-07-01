import { useState } from "react";
import { isWebDemo } from "../env";
import "./WebDemoBanner.css";

/**
 * Notice shown only on the web frontend (the Vercel demo), never inside the
 * Tauri desktop shell. Tells visitors they're using the in-browser demo and
 * points them at the desktop download. Dismissible for the session.
 */
// Disabled for now (author request) — keep the component so it can be re-enabled
// by flipping this flag back to true.
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
      {/* Link disabled for now — repo isn't public yet. Re-enable by
          restoring href={DOWNLOAD_URL} / target / rel. */}
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

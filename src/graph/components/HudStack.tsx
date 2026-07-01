import { createPortal } from "react-dom";
import { PinLayer } from "./PinLayer";
import { AlertLayer } from "./AlertLayer";
import "./hudStack.css";

/**
 * The right-side HUD column: a single screen-fixed flex stack (below the nav
 * pill) that owns positioning for the floating panels. The pinned-values section
 * sits on top; the fired-alerts section stacks directly below it, so the alert
 * button always lands below all pins regardless of how many are pinned. Each
 * section renders nothing when empty, so the stack is invisible until something
 * is pinned or an alert fires.
 */
export function HudStack() {
  return createPortal(
    <div className="solenoid-hud-stack">
      <PinLayer />
      <AlertLayer />
    </div>,
    document.body,
  );
}

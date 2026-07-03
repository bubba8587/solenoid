import { createPortal } from "react-dom";
import { PinLayer } from "./PinLayer";
import { AlertLayer } from "./AlertLayer";
import { ProblemsPanel } from "./ProblemsPanel";
import { CommentsPanel } from "./CommentsPanel";
import "./hudStack.css";

/**
 * The right-side HUD column: a single screen-fixed flex stack (below the nav
 * pill) that owns positioning for the floating panels. The pinned-values section
 * sits on top; the fired-alerts section stacks below it, then Problems, then
 * Comments. Each section renders nothing when empty, so the stack is invisible
 * until something is pinned, an alert fires, a #CODE! error is hit, or a node
 * has a comment.
 */
export function HudStack() {
  return createPortal(
    <div className="solenoid-hud-stack">
      <PinLayer />
      <AlertLayer />
      <ProblemsPanel />
      <CommentsPanel />
    </div>,
    document.body,
  );
}

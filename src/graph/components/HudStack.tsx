import { createPortal } from "react-dom";
import { PinLayer } from "./PinLayer";
import { AlertLayer } from "./AlertLayer";
import { ProblemsPanel } from "./ProblemsPanel";
import { CommentsPanel } from "./CommentsPanel";
import "./hudStack.css";

/** The one screen-fixed stack that owns positioning for the right-side floating panels;
 *  each section renders nothing when empty, so the stack is invisible until used. */
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

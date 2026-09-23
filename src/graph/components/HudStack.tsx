// [[C39]] effectsEdgeTriggered. Mechanics: tree/specs/computation/alert-node-alerts-hud.md.
import { createPortal } from "react-dom";
import { PinLayer } from "./PinLayer";
import { AlertLayer } from "./AlertLayer";
import { ProblemsPanel } from "./ProblemsPanel";
import { CommentsPanel } from "./CommentsPanel";
import "./hudStack.css";

/** Owns positioning for the right-side floating panels; each section renders nothing when empty. */
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

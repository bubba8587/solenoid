// [[C93]] gestureByPointerType

import { useEffect, useState } from "react";

import { cableSelectionStore } from "./cableState";
import { IS_COARSE } from "./coarse";
import { getActiveEditor } from "./activeGraph";
import { fireMenuKey } from "./menuModel";

export function fireUndo(redo: boolean) {
  fireMenuKey("KeyZ", { ctrl: true, shift: redo });
}

export function fireGroup() {
  fireMenuKey("KeyG", { key: "g" });
}

/** Polled, since there is no selection store, so a button dimmed by it must stay tappable; `enabled` skips the interval where the bar isn't rendered. */
export function useHasSelection(enabled = IS_COARSE): boolean {
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const editor = getActiveEditor();
      const nodeSelected = !!editor?.getNodes().some((n) => (n as { selected?: boolean }).selected);
      setHasSelection(nodeSelected || cableSelectionStore.count() > 0);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [enabled]);
  return hasSelection;
}


type IconProps = { size?: number };
const stroke = {
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export function CommandGlyph({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="m5 8 4 4-4 4" />
      <path d="M13 16h6" />
    </svg>
  );
}

export function UndoGlyph({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M6 10 H15 a4.5 4.5 0 0 1 0 9 H9" />
      <path d="M6 10 L10 6 M6 10 L10 14" />
    </svg>
  );
}

export function RedoGlyph({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M18 10 H9 a4.5 4.5 0 0 0 0 9 H15" />
      <path d="M18 10 L14 6 M18 10 L14 14" />
    </svg>
  );
}

export function SelectGlyph({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeDasharray="3 3">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

export function DeleteGlyph({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function GroupGlyph({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M4 8V5a1 1 0 0 1 1-1h3" />
      <path d="M16 4h3a1 1 0 0 1 1 1v3" />
      <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
      <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

/** The drill-in ports tab's outline, sloped at its shoulders. */
export function PortsTabShape() {
  return (
    <svg className="solenoid-mobile-bar__ports-tab" viewBox="0 0 126 13" aria-hidden="true">
      <path className="solenoid-mobile-bar__ports-fill" d="M0 13 L10 1.8 Q11 0.5 13 0.5 H113 Q115 0.5 116 1.8 L126 13 Z" />
      <path className="solenoid-mobile-bar__ports-edge" d="M0 12.5 L10 1.8 Q11 0.5 13 0.5 H113 Q115 0.5 116 1.8 L126 12.5" />
    </svg>
  );
}

/** The drill-in port buttons' faces: a faded accent disc with the app face's own bold I or O (Atkinson Hyperlegible Next at
 *  700, 8px cap height), drawn as outlines so the letter centers on the disc exactly. */
const GLYPH_I = "M-1.99 4V2.71H-0.87V-2.71H-1.99V-4H1.99V-2.71H0.87V2.71H1.99V4Z";
const GLYPH_O = "M0 4.14Q-1.21 4.14 -2.13 3.63Q-3.05 3.11 -3.56 2.17Q-4.08 1.24 -4.08 0Q-4.08 -1.24 -3.56 -2.17Q-3.05 -3.11 -2.13 -3.63Q-1.21 -4.14 0 -4.14Q1.21 -4.14 2.12 -3.63Q3.04 -3.11 3.56 -2.17Q4.08 -1.24 4.08 0Q4.08 1.24 3.56 2.17Q3.04 3.11 2.12 3.63Q1.21 4.14 0 4.14ZM0 2.7Q0.61 2.7 1.12 2.39Q1.62 2.09 1.93 1.49Q2.23 0.89 2.23 0Q2.23 -0.89 1.93 -1.49Q1.62 -2.09 1.12 -2.39Q0.61 -2.7 0 -2.7Q-0.6 -2.7 -1.11 -2.39Q-1.62 -2.09 -1.93 -1.49Q-2.23 -0.89 -2.23 0Q-2.23 0.89 -1.93 1.49Q-1.62 2.09 -1.11 2.39Q-0.6 2.7 0 2.7Z";
export function PortGlyph({ side }: { side: "in" | "out" }) {
  return (
    <svg viewBox="-10 -10 20 20" width="20" height="20" aria-hidden="true">
      <circle className="solenoid-mobile-bar__port-disc" r="9.5" />
      <path className="solenoid-mobile-bar__port-glyph" d={side === "in" ? GLYPH_I : GLYPH_O} />
    </svg>
  );
}

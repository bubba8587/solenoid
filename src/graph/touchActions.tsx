// One definition of each keyboard-less edit action, shared by the mobile bottom bar
// and the tablet top bar; the bars differ only in placement and sizing.

import { useEffect, useState } from "react";

import { cableSelectionStore } from "./cableState";
import { IS_COARSE } from "./coarse";
import { getActiveEditor } from "./activeGraph";

// Synthetic Ctrl+Z through Canvas's key handler, keeping undo single-sourced.
export function fireUndo(redo: boolean) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true }),
  );
}

// Via the same "G" shortcut Canvas handles — no separate plumbing per bar.
export function fireGroup() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyG", key: "g", bubbles: true, cancelable: true }),
  );
}

/** Is anything selected? Polled — there is no selection store — so the buttons that
 *  dim on it stay TAPPABLE while dim, or the poll interval would swallow a tap.
 *  `enabled` skips the interval where the bar isn't rendered. */
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

// Each glyph takes `size`: the bottom bar's touch targets are larger than the top
// bar's 28px buttons.

type IconProps = { size?: number };
const stroke = {
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

/** Lucide "terminal" (>_) — the command palette, Obsidian-style. Its search
 *  covers find-node too, so one glyph carries both. */
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

/** Dashed marquee — drag to lasso-select; tap nodes to add/remove. */
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

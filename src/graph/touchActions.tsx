// ─── The touch action set, shared by the mobile bottom bar and the tablet top bar ──
// One definition of each keyboard-less edit action: its glyph, its handler, and
// (for the two that need a selection) its enabled test. The two bars differ ONLY
// in WHERE they sit and how they're sized — a phone gets a thumb-reachable bottom
// bar, a tablet gets them in the top bar because it runs the DESKTOP chrome and
// has no bottom bar at all (IS_MOBILE is false on a tablet: iPadOS ships a desktop
// UA on purpose — see coarse.ts).
//
// Lifted here rather than copied so the two can't drift: a glyph redrawn or a
// handler retargeted in one bar would otherwise silently disagree with the other.
// The ACTIONS themselves stay single-sourced further down still — undo/redo and
// group dispatch the same synthetic keydowns Canvas's window handler already
// listens for, so neither bar owns a private code path into the editor.

import { useEffect, useState } from "react";
import { getEditor } from "./process";
import { cableSelectionStore } from "./cableState";
import { IS_COARSE } from "./coarse";

// Dispatch the synthetic Ctrl+Z / Ctrl+Shift+Z that Canvas's window key handler
// already listens for, keeping undo/redo single-sourced.
export function fireUndo(redo: boolean) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true }),
  );
}

// Group the selection via the same "G" shortcut Canvas already handles (single-
// sourced, like undo/redo) — no separate editor/area plumbing for either bar.
export function fireGroup() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyG", key: "g", bubbles: true, cancelable: true }),
  );
}

/** Is anything (node or cable) selected? Polled the cheap way the StatusBar does
 *  it — there is no dedicated selection store. Delete and Group read this to dim
 *  themselves; they stay TAPPABLE while dim so a fresh selection isn't blocked by
 *  the poll interval.
 *
 *  `enabled` skips the interval entirely where the bar isn't rendered: on a
 *  desktop the top bar's tablet controls are CSS-hidden, and scanning every node
 *  5×/sec for an invisible control is pure waste on the largest graphs. */
export function useHasSelection(enabled = IS_COARSE): boolean {
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const editor = getEditor();
      const nodeSelected = !!editor?.getNodes().some((n) => (n as { selected?: boolean }).selected);
      setHasSelection(nodeSelected || cableSelectionStore.count() > 0);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [enabled]);
  return hasSelection;
}

// ── Glyphs ───────────────────────────────────────────────────────────────────
// Sized by the caller (the bottom bar's touch targets are larger than the top
// bar's 28px buttons), so each takes `size` rather than hard-coding one.

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

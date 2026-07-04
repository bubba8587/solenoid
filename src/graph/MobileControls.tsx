import { useEffect, useState, useSyncExternalStore } from "react";
import { getEditor, deleteSelected } from "./process";
import { addMenuRequest } from "./addMenuStore";
import { cableSelectionStore } from "./cableState";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { paletteStore } from "./paletteStore";
import "./MobileControls.css";

/**
 * Touch-only bottom action bar (hidden ≥640px via CSS): one row of 6 buttons
 * around the raised accent Add FAB — Commands · Undo · Redo · ➕ · Select ·
 * Delete · Fit. The Commands button opens the command palette, which subsumes
 * the old Search slot (typing a node's name in it jumps to the node, and it
 * carries every other action, so one button covers both). Delete is disabled
 * (dimmed) when nothing's selected, so the bar never reflows and the buttons
 * keep fixed positions.
 *
 * Selection state is polled the same cheap way the StatusBar does it (there is
 * no dedicated selection store), so Delete enables only when there's something
 * to remove.
 */
export function MobileControls() {
  const [hasSelection, setHasSelection] = useState(false);
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);

  // The bar only renders under html.is-mobile (== IS_MOBILE), so on desktop this poll would
  // scan every node 5×/sec for an invisible control. Skip it entirely there.
  useEffect(() => {
    if (!IS_MOBILE) return;
    const tick = () => {
      const editor = getEditor();
      const nodeSelected = !!editor?.getNodes().some((n) => (n as { selected?: boolean }).selected);
      const cableSelected = cableSelectionStore.count() > 0;
      setHasSelection(nodeSelected || cableSelected);
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, []);

  // Open the Add-node menu near the top so the on-screen keyboard (for its
  // search field) doesn't cover it.
  const openAddMenu = () => addMenuRequest.open(window.innerWidth / 2, 96);

  return (
    <div className="solenoid-mobile-bar" onPointerDown={(e) => e.stopPropagation()}>
      {/* Lucide "terminal" (>_) — the command palette, Obsidian-style. Its search
          covers find-node too. */}
      <button className="solenoid-mobile-bar__btn" aria-label="Command palette" onClick={() => paletteStore.open()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 8 4 4-4 4" />
          <path d="M13 16h6" />
        </svg>
      </button>
      <button className="solenoid-mobile-bar__btn" aria-label="Undo" onClick={() => fireUndo(false)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 10 H15 a4.5 4.5 0 0 1 0 9 H9" />
          <path d="M6 10 L10 6 M6 10 L10 14" />
        </svg>
      </button>
      <button className="solenoid-mobile-bar__btn" aria-label="Redo" onClick={() => fireUndo(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 10 H9 a4.5 4.5 0 0 0 0 9 H15" />
          <path d="M18 10 L14 6 M18 10 L14 14" />
        </svg>
      </button>
      <button
        className="solenoid-mobile-bar__btn solenoid-mobile-bar__add"
        aria-label="Add node"
        onClick={openAddMenu}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        className={
          "solenoid-mobile-bar__btn solenoid-mobile-bar__select" +
          (selectMode ? " solenoid-mobile-bar__btn--on" : "")
        }
        aria-label="Select mode"
        aria-pressed={selectMode}
        onClick={() => touchSelectStore.toggle()}
      >
        {/* Dashed marquee — drag to lasso-select; tap nodes to add/remove. */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 3">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      </button>
      <button
        className={
          "solenoid-mobile-bar__btn solenoid-mobile-bar__delete" +
          (hasSelection ? "" : " solenoid-mobile-bar__btn--dim")
        }
        aria-label="Delete selection"
        aria-disabled={!hasSelection}
        onClick={() => void deleteSelected()}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
      {/* Group the current selection (G) — the highest-value keyboard-less edit op.
          Fires the same shortcut Canvas listens for. Dimmed when nothing's selected
          (it needs a selection), but still tappable so a fresh select isn't blocked
          by the poll. Fit/autofit moved to the floating canvas pill. */}
      <button
        className={
          "solenoid-mobile-bar__btn" + (hasSelection ? "" : " solenoid-mobile-bar__btn--dim")
        }
        aria-label="Group selection"
        aria-disabled={!hasSelection}
        onClick={fireGroup}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 8V5a1 1 0 0 1 1-1h3" />
          <path d="M16 4h3a1 1 0 0 1 1 1v3" />
          <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
          <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
      </button>
    </div>
  );
}

// Dispatch the synthetic Ctrl+Z / Ctrl+Shift+Z that Canvas's window key handler
// already listens for, keeping undo/redo single-sourced.
function fireUndo(redo: boolean) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyZ", ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true }),
  );
}

// Group the selection via the same "G" shortcut Canvas already handles (single-
// sourced, like undo/redo) — no separate editor/area plumbing for the mobile bar.
function fireGroup() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code: "KeyG", key: "g", bubbles: true, cancelable: true }),
  );
}

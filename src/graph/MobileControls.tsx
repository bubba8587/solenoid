import { useSyncExternalStore } from "react";
import { deleteSelected } from "./process";
import { addMenuRequest } from "./addMenuStore";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { paletteStore } from "./paletteStore";
import {
  fireUndo, fireGroup, useHasSelection,
  CommandGlyph, UndoGlyph, RedoGlyph, SelectGlyph, DeleteGlyph, GroupGlyph,
} from "./touchActions";
import "./MobileControls.css";

/**
 * Touch-only bottom action bar (hidden ≥640px via CSS): one row of 6 buttons
 * around the raised accent Add FAB — Commands · Undo · Redo · ➕ · Select ·
 * Delete · Fit. The Commands button opens the command palette (typing a node's
 * name jumps to the node, and it carries every other action, so one button
 * covers both search and commands). Delete is disabled
 * (dimmed) when nothing's selected, so the bar never reflows and the buttons
 * keep fixed positions.
 *
 * Selection state is polled the same cheap way the StatusBar does it (there is
 * no dedicated selection store), so Delete enables only when there's something
 * to remove.
 */
export function MobileControls() {
  // The bar only renders under html.is-mobile (== IS_MOBILE), so on desktop the
  // poll would scan every node 5×/sec for an invisible control — skip it there.
  const hasSelection = useHasSelection(IS_MOBILE);
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);

  // Open the Add-node menu near the top so the on-screen keyboard (for its
  // search field) doesn't cover it.
  const openAddMenu = () => addMenuRequest.open(window.innerWidth / 2, 96);

  return (
    <div className="solenoid-mobile-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button className="solenoid-mobile-bar__btn" aria-label="Command palette" onClick={() => paletteStore.open()}>
        <CommandGlyph size={20} />
      </button>
      <button className="solenoid-mobile-bar__btn" aria-label="Undo" onClick={() => fireUndo(false)}>
        <UndoGlyph size={22} />
      </button>
      <button className="solenoid-mobile-bar__btn" aria-label="Redo" onClick={() => fireUndo(true)}>
        <RedoGlyph size={22} />
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
        <SelectGlyph size={20} />
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
        <DeleteGlyph size={20} />
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
        <GroupGlyph size={20} />
      </button>
    </div>
  );
}


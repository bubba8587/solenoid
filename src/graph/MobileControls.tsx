import { useSyncExternalStore } from "react";
import { deleteSelected } from "./process";
import { addMenuRequest } from "./addMenuStore";
import { touchSelectStore } from "./touchSelectStore";
import { IS_MOBILE } from "./coarse";
import { paletteStore } from "./paletteStore";
import { useBottomChrome } from "./chromeBottom";
import {
  fireUndo, fireGroup, useHasSelection,
  CommandGlyph, UndoGlyph, RedoGlyph, SelectGlyph, DeleteGlyph, GroupGlyph,
} from "./touchActions";
import "./MobileControls.css";

/** Touch-only bottom action bar; buttons dim rather than disappear, so the bar never
 *  reflows and positions stay fixed. */
export function MobileControls() {
  // On desktop the poll would scan every node 5×/sec for an invisible control.
  const hasSelection = useHasSelection(IS_MOBILE);
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);

  // Near the top, so the on-screen keyboard doesn't cover the menu's search field.
  const openAddMenu = () => addMenuRequest.open(window.innerWidth / 2, 96);

  // Joins the measured `--chrome-bottom` envelope (chromeBottom.ts); the bar's
  // height includes its safe-area padding, so the var carries the inset too.
  const bottomRef = useBottomChrome<HTMLDivElement>();

  return (
    <div className="solenoid-mobile-bar" ref={bottomRef} onPointerDown={(e) => e.stopPropagation()}>
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
      {/* Dimmed without a selection but still tappable, so a fresh select isn't
          blocked by the poll. */}
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


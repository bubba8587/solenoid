import { useSyncExternalStore } from "react";
import { deleteSelected } from "./process";
import { touchSelectStore } from "./touchSelectStore";
import { paletteStore } from "./paletteStore";
import { IS_TABLET } from "./coarse";
import {
  fireUndo, fireGroup, useHasSelection,
  CommandGlyph, UndoGlyph, RedoGlyph, SelectGlyph, DeleteGlyph, GroupGlyph,
} from "./touchActions";

/** The keyboard-less edit actions in the TOP BAR, for a tablet — `MobileControls` never
 *  mounts there. Rendered unconditionally and gated by `html.is-tablet` in CSS; only the
 *  selection poll is gated in JS, so a desktop never watches a control it can't see. */
export function TabletActions() {
  const hasSelection = useHasSelection(IS_TABLET);
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);

  return (
    <>
      <div className="solenoid-topbar__group solenoid-topbar__group--tablet solenoid-topbar__group--tablet-edit">
        <button
          className="solenoid-nav__btn"
          title="Commands (Ctrl+K)"
          aria-label="Command palette"
          onClick={() => paletteStore.open()}
        >
          <CommandGlyph size={15} />
        </button>
      </div>

      <div className="solenoid-topbar__group solenoid-topbar__group--tablet solenoid-topbar__group--tablet-edit">
        <button className="solenoid-nav__btn" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={() => fireUndo(false)}>
          <UndoGlyph size={15} />
        </button>
        <button className="solenoid-nav__btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" onClick={() => fireUndo(true)}>
          <RedoGlyph size={15} />
        </button>
      </div>

      {/* Group and Delete dim without a selection but stay tappable, so a fresh select
          isn't blocked by the 200ms poll. */}
      <div className="solenoid-topbar__group solenoid-topbar__group--tablet solenoid-topbar__group--tablet-edit">
        <button
          className={`solenoid-nav__btn${selectMode ? " solenoid-nav__btn--on" : ""}`}
          title={selectMode ? "Select mode: on" : "Select mode: off"}
          aria-label="Select mode"
          aria-pressed={selectMode}
          onClick={() => touchSelectStore.toggle()}
        >
          <SelectGlyph size={15} />
        </button>
        <button
          className={`solenoid-nav__btn${hasSelection ? "" : " solenoid-nav__btn--dim"}`}
          title="Group selection (G)"
          aria-label="Group selection"
          aria-disabled={!hasSelection}
          onClick={fireGroup}
        >
          <GroupGlyph size={15} />
        </button>
        <button
          className={`solenoid-nav__btn${hasSelection ? "" : " solenoid-nav__btn--dim"}`}
          title="Delete selection (Del)"
          aria-label="Delete selection"
          aria-disabled={!hasSelection}
          onClick={() => void deleteSelected()}
        >
          <DeleteGlyph size={15} />
        </button>
      </div>
    </>
  );
}

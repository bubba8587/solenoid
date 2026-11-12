// [[touch-gestures#A gesture follows what touches the screen, not the device]]
import { useSyncExternalStore } from "react";
import { deleteSelected } from "./canvasCommands";
import { touchSelectStore } from "./touchSelectStore";
import { paletteStore } from "./paletteStore";
import { IS_COARSE } from "./coarse";
import { useIsMobile } from "./useDeviceMode";
import { canvasLockStore } from "./canvasLock";
import {
  fireUndo, fireGroup, useHasSelection,
  CommandGlyph, UndoGlyph, RedoGlyph, SelectGlyph, DeleteGlyph, GroupGlyph,
} from "./touchActions";

/** A tablet's keyboard-less edit actions (MobileControls never mounts there). Gated by `html.is-tablet` in CSS; only the
 *  selection poll is gated in JS, so a desktop never watches a control it can't see. */
export function TabletActions() {
  const hasSelection = useHasSelection(IS_COARSE && !useIsMobile());
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);
  // A locked canvas takes no edits: the edit buttons dim and do nothing until it unlocks.
  const locked = useSyncExternalStore(canvasLockStore.subscribe, canvasLockStore.get);
  const editable = hasSelection && !locked;
  const dimIf = (dim: boolean) => `solenoid-nav__btn${dim ? " solenoid-nav__btn--dim" : ""}`;

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
        <button className={dimIf(locked)} title="Undo (Ctrl+Z)" aria-label="Undo" aria-disabled={locked} onClick={() => { if (!locked) fireUndo(false); }}>
          <UndoGlyph size={15} />
        </button>
        <button className={dimIf(locked)} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" aria-disabled={locked} onClick={() => { if (!locked) fireUndo(true); }}>
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
          className={dimIf(!editable)}
          title="Group selection (G)"
          aria-label="Group selection"
          aria-disabled={!editable}
          onClick={() => { if (!locked) fireGroup(); }}
        >
          <GroupGlyph size={15} />
        </button>
        <button
          className={dimIf(!editable)}
          title="Delete selection (Del)"
          aria-label="Delete selection"
          aria-disabled={!editable}
          onClick={() => { if (!locked) void deleteSelected(); }}
        >
          <DeleteGlyph size={15} />
        </button>
      </div>
    </>
  );
}

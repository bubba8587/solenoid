import { useSyncExternalStore } from "react";
import { deleteSelected } from "./process";
import { touchSelectStore } from "./touchSelectStore";
import { paletteStore } from "./paletteStore";
import { IS_TABLET } from "./coarse";
import {
  fireUndo, fireGroup, useHasSelection,
  CommandGlyph, UndoGlyph, RedoGlyph, SelectGlyph, DeleteGlyph, GroupGlyph,
} from "./touchActions";

/**
 * The keyboard-less edit actions, in the TOP BAR, for a tablet.
 *
 * A tablet runs the desktop chrome — `IS_MOBILE` is false there because iPadOS
 * ships a desktop UA on purpose (coarse.ts) — so `MobileControls` never mounts
 * and none of these actions had a touch target on a tablet at all. Same handlers,
 * same glyphs, same disabled logic as the bottom bar; only the location differs.
 * Everything shared lives in `touchActions.tsx` so the two bars cannot drift.
 *
 * Two things are deliberately NOT carried over from the bottom bar:
 *   • **Add node** — the bar already has its own Add affordance and the canvas
 *     double-tap; a second ➕ in the top bar would be the third.
 *   • **The raised FAB treatment** — that's a thumb-reach accommodation for a
 *     phone's bottom edge. Up here it would just be a loud button, and the
 *     Quiet Accent Rule says accent conveys type/state, not emphasis.
 *
 * PORTRAIT (2026-08-01): the desktop bar does not fit a tablet in portrait, so on
 * a tablet it WRAPS to a second row. The palette pins to row 1 beside Reference
 * and Settings (author call — those three stay top-right); the edit clusters
 * carry `--tablet-edit` and wrap to row 2 with the file/layout/cable tools.
 *
 * Rendered unconditionally; `html.is-tablet` gates the CSS (TopBar.css). The
 * selection poll is the one thing gated in JS — `useHasSelection(IS_TABLET)` —
 * so a desktop never pays to watch a control it cannot see.
 */
export function TabletActions() {
  const hasSelection = useHasSelection(IS_TABLET);
  const selectMode = useSyncExternalStore(touchSelectStore.subscribe, touchSelectStore.get);

  return (
    <>
      {/* Command palette — its search covers find-node too, so one button carries
          both, exactly as on the bottom bar. */}
      <div className="solenoid-topbar__group solenoid-topbar__group--tablet solenoid-topbar__group--tablet-pinned">
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

      {/* Select mode · Group · Delete — the selection cluster. Group and Delete
          dim without a selection but stay tappable, so a fresh select isn't
          blocked by the 200ms poll (the bottom bar's rule, kept). */}
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

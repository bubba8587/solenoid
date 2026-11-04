// [[C28]] literalsIffEditable
import { useState, useSyncExternalStore, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { collapseStore } from "../collapseStore";
import { ValueDisplay } from "./nodeKit";
import { useDraftCommit } from "./inlineInput";
import { stopDragStart } from "../coarse";
import type { DisplayValue } from "./valueDisplayFormat";
import "./CollapsedCell.css";

/** Whether a card is collapsed, for a cell-collapse card choosing between its open value box and `CollapsedCell`. */
export function useCollapsed(nodeId: string): boolean {
  return useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(nodeId));
}

/** How a collapsed cell edits: the keyed text it opens, what commits it, and for a two-valued type a flip in place of
 *  the text. */
export interface CellEdit {
  text: string;
  onCommit: (text: string) => void;
  flip?: () => void;
}

/** A cell-collapse card's whole body while collapsed (`NodeShell cellCollapse`): its value, with no copy button. With
 *  `edit` it is a Frame cell: a press shows the keyed text, Enter or a blur commits and shows the value again, Escape
 *  keeps the old text, and `flip` takes the press instead for a two-valued type. Without it the cell only shows. */
export function CollapsedCell({ value, socketKey, edit, render, renderWins }: {
  value: DisplayValue;
  socketKey?: string;
  edit?: CellEdit;
  render?: (v: number) => ReactNode;
  renderWins?: boolean;
}) {
  return (
    <div className="solenoid-node__collapsed-only sol-cell">
      {edit ? <EditableCell value={value} socketKey={socketKey} edit={edit} /> : (
        <div className="sol-cell__view">
          <ValueDisplay value={value} socketKey={socketKey} copy={false} render={render} renderWins={renderWins} />
        </div>
      )}
    </div>
  );
}

function EditableCell({ value, socketKey, edit }: { value: DisplayValue; socketKey?: string; edit: CellEdit }) {
  const [editing, setEditing] = useState(false);
  const field = useDraftCommit<string>(edit.text, (v) => v, (t) => t, edit.onCommit);
  const stop = {
    onPointerDown: stopDragStart,
    onMouseDown: (e: MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: MouseEvent) => e.stopPropagation(),
  };
  if (editing) {
    return (
      <input
        className="solenoid-node__value-input sol-cell__input"
        autoFocus
        value={field.draft}
        style={{ width: `${Math.max(4, field.draft.length + 2)}ch` }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
        onBlur={() => { field.onBlur(); setEditing(false); }}
        onKeyDown={field.onKeyDown}
        spellCheck={false}
        {...stop}
      />
    );
  }
  return (
    <div
      className="sol-cell__view sol-cell__view--edit"
      title={edit.flip ? "Flipped in place" : "The value, edited in place"}
      onClick={(e) => {
        e.stopPropagation();
        if (edit.flip) edit.flip();
        else setEditing(true);
      }}
      {...stop}
    >
      <ValueDisplay value={value} socketKey={socketKey} copy={false} />
    </div>
  );
}

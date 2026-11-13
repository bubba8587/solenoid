// [[B19]] spreadsheetHabits, [[table-popup#The Pivot view]]
// The chip and the Fields list the drag-to-place popups share: Configure Fields on a Pivot, the Categorize sorter.
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { CloseIcon } from "./CloseIcon";
import "./PivotEditorPopup.css";

/** A draggable chip: a glyph, a name and, when it can leave where it sits, an ×. `onDropBefore` makes it a drop target
 *  that places the dragged chip before it. */
export function FieldChip({ name, glyph, className = "", title, onDragStart, onDropBefore, onRemove, removeTitle = "Remove", onClick, children }: {
  name: ReactNode;
  glyph?: ReactNode;
  className?: string;
  title?: string;
  onDragStart?: (e: DragEvent) => void;
  onDropBefore?: () => void;
  onRemove?: () => void;
  removeTitle?: string;
  onClick?: (e: MouseEvent) => void;
  children?: ReactNode;
}) {
  return (
    <span
      className={`pivot-chip ${className}`.trim()}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragOver={onDropBefore && ((e) => { e.preventDefault(); e.stopPropagation(); })}
      onDrop={onDropBefore && ((e) => { e.preventDefault(); e.stopPropagation(); onDropBefore(); })}
      onClick={onClick}
      title={title}
    >
      {glyph !== undefined && <span className="pivot-chip__glyph">{glyph}</span>}
      <span className="pivot-chip__name">{name}</span>
      {children}
      {onRemove && <button className="pivot-chip__x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={removeTitle} title={removeTitle}><CloseIcon size={10} /></button>}
    </span>
  );
}

/** The Fields list: what can be placed, a chip dropped on it leaving where it was. */
export function FieldsPanel({ head, hint, onDrop, children }: { head: ReactNode; hint?: ReactNode; onDrop: () => void; children: ReactNode }) {
  return (
    <div className="pivot-fields" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
      <div className="pivot-fields__head">{head} {hint && <span className="pivot-fields__hint">· {hint}</span>}</div>
      <div className="pivot-fields__list">{children}</div>
    </div>
  );
}

/** Firefox starts no HTML5 drag without data on it, so the chip's name rides along; the drop reads the caller's ref. */
export function startChipDrag(e: DragEvent, text: string): void {
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", text);
}

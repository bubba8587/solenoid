// [[C95]] commitOnEnter, [[D17]] relaysTransparent (the static shape resolver)
import { useMemo, useSyncExternalStore } from "react";
import { useDraftCommit } from "./inlineInput";
import { connectionVersionStore } from "../graphSignals";
import { getOwningEditor } from "../activeGraph";
import { makeFrameShapeResolver } from "../frameShapeResolver";
import { columnNamesOf } from "../frameShape";
import { stopDragStart } from "../coarse";

/** The shared column-name field: tree/specs/values/type-propagation-on-in-place-socket-retype.md
 *  (column pickers). Writes the SAME string literal the plain field does; renders only for
 *  an UNWIRED socket. */
export function ColumnPickerField({ nodeId, frameInput, value, onChange, placeholder }: {
  nodeId: string;
  frameInput: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Resolve ONCE per wiring change, never per keystroke: the memo depends only on the
  // connection version (+ ids), so typing (which only moves the draft) never re-walks.
  const connVersion = useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const columns = useMemo(() => {
    const editor = getOwningEditor(nodeId);
    if (!editor) return [];
    const feed = editor.getConnections().find((c) => c.target === nodeId && c.targetInput === frameInput);
    if (!feed) return [];
    return columnNamesOf(makeFrameShapeResolver(editor).outShape(feed.source, feed.sourceOutput));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, frameInput, connVersion]);

  const field = useDraftCommit(value ?? "", (v) => v, (t) => t, onChange);
  const listId = `colpick-${nodeId}-${frameInput}`;
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--inline">
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
      <span className="solenoid-node__quoted-field">
        <input
          type="text"
          className="solenoid-node__quoted-input"
          value={field.draft}
          placeholder={placeholder}
          list={columns.length ? listId : undefined}
          onChange={(e) => field.setDraft(e.target.value)}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
        />
        {columns.length > 0 && (
          <datalist id={listId}>
            {columns.map((c) => <option key={c} value={c} />)}
          </datalist>
        )}
      </span>
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
    </span>
  );
}

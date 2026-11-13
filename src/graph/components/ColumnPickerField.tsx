// [[B19]] spreadsheetHabits
import { useMemo, useSyncExternalStore } from "react";
import { useDraftCommit } from "./inlineInput";
import { connectionVersionStore } from "../graphSignals";
import { compositePassStore } from "../compositeEditorStore";
import { getOwningEditor } from "../activeGraph";
import { makeFrameShapeResolver } from "../frameShapeResolver";
import { columnNamesOf } from "../frameShape";
import { stopDragStart } from "../coarse";
import { listLiteralItems } from "../listLiterals";
import { csvField } from "../csvSafety";

/** Column pickers: tree/specs/values/type-propagation-on-in-place-socket-retype.md; writes the same string literal the plain field does, and renders only for an unwired socket. */
export function ColumnPickerField({ nodeId, frameInput, value, onChange, placeholder }: {
  nodeId: string;
  frameInput: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const columns = useFeedColumns(nodeId, frameInput);
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

/** The static column names of the Frame wired into `frameInput`; empty when unwired or unknown. */
function useFeedColumns(nodeId: string, frameInput: string): string[] {
  // Resolve once per wiring change or graph pass (an upstream rename reaches the shape only through a pass), so typing never re-walks.
  const connVersion = useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const passVersion = useSyncExternalStore(compositePassStore.subscribe, compositePassStore.version);
  const columns = useMemo(() => {
    const editor = getOwningEditor(nodeId);
    if (!editor) return [];
    const feed = editor.getConnections().find((c) => c.target === nodeId && c.targetInput === frameInput);
    if (!feed) return [];
    return columnNamesOf(makeFrameShapeResolver(editor).outShape(feed.source, feed.sourceOutput));
  }, [nodeId, frameInput, connVersion, passVersion]);

  return columns;
}

/** A list of column names: the plain list field, suggesting the feed's columns not yet listed after what is typed. */
export function ColumnListField({ nodeId, frameInput, value, onChange, placeholder }: {
  nodeId: string;
  frameInput: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const columns = useFeedColumns(nodeId, frameInput);
  const field = useDraftCommit(value ?? "", (v) => v, (t) => t, onChange);
  const listId = `collist-${nodeId}-${frameInput}`;
  const cut = field.draft.lastIndexOf(",");
  const head = cut < 0 ? "" : `${field.draft.slice(0, cut + 1)} `;
  const listed = new Set(listLiteralItems(head));
  const offers = columns.filter((c) => !listed.has(c));
  return (
    <>
      <input
        type="text"
        className="solenoid-node__inline-input solenoid-node__inline-input--list"
        value={field.draft}
        placeholder={placeholder}
        list={offers.length ? listId : undefined}
        onChange={(e) => field.setDraft(e.target.value)}
        onBlur={field.onBlur}
        onKeyDown={field.onKeyDown}
        onPointerDown={stopDragStart}
        onMouseDown={(e) => e.stopPropagation()}
        spellCheck={false}
      />
      {offers.length > 0 && (
        <datalist id={listId}>
          {offers.map((c) => <option key={c} value={head + csvField(c, false)} />)}
        </datalist>
      )}
    </>
  );
}

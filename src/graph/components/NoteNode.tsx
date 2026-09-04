import { useFlowResizeGrip } from "../flowSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { NoteNode as NoteNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { SocketDot, type SocketGlyph } from "./SocketLegend";
import { NodeSocket } from "./NodeSocket";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { useEditableLabel } from "./inlineInput";
// getActiveEditor/getActiveView, NOT getEditor/getView: a Note inside a composite
// drill-in must prune/reconcile/refresh on its OWN graph.
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { reconcileFcTypes } from "../fcReconcile";
import { scheduleAutosave } from "../persistence";
import { standoffStore, settleStandoffs } from "../standoffs";
import { SOCKET_COLORS } from "../sockets";
import { dropStrandedFrontmatterCables } from "../noteFrontmatterSync";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { parseNoteFrontmatter, toggleTaskMarker, type FrontmatterFieldType, type FrontmatterValue } from "../noteFrontmatter";
import { isFrameValue, type FrameValue } from "../frame";
import type { NodeProps, Emit } from "./nodeKit";
import type { ClassicPreset } from "rete";
import { stopDragStart } from "../coarse";
import "./Markdown.css";
import "./NoteNode.css";

type FieldValue = FrontmatterValue | FrameValue;

// Grouped by dimensionality — the override picker offers the four element families at
// the field's CURRENT dimension; glyphs reuse the Socket Legend vocabulary.
const SCALAR_FIELD_TYPES: FrontmatterFieldType[] = ["number", "string", "date", "logical"];
const LIST_FIELD_TYPES: FrontmatterFieldType[] = ["list", "strlist", "datelist", "logicallist"];
const FIELD_TYPE_LABEL: Record<FrontmatterFieldType, string> = {
  number: "Number", string: "Text", date: "Date", logical: "Boolean",
  list: "Number list", strlist: "Text list", datelist: "Date list", logicallist: "Boolean list",
  frame: "Frame",
};
const isListFieldType = (t: FrontmatterFieldType) => LIST_FIELD_TYPES.includes(t);

function glyphFor(t: FrontmatterFieldType): SocketGlyph {
  return { kind: isListFieldType(t) || t === "frame" ? "square" : "circle", color: SOCKET_COLORS[t] };
}

/** A short, human-readable preview of a field's value for the row. */
function previewValue(value: FieldValue, t: FrontmatterFieldType): string {
  if (t === "frame") {
    if (!isFrameValue(value)) return "table";
    const rows = value.columns[0]?.values.length ?? 0;
    return `⊞ ${rows}×${value.columns.length}`;
  }
  const one = (v: number | string | boolean | null): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number" && (t === "date" || t === "datelist")) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
    return String(v);
  };
  if (Array.isArray(value)) {
    const shown = value.slice(0, 4).map((e) => one(e as number | string | boolean | null));
    return `[${shown.join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  return one(value as number | string | boolean | null);
}

// The body edit gets its OWN undo entry, pushed AFTER the cable removals: syncFields

// Resize floors, no ceiling. The height floor GROWS by the fields strip (22px per
// socket row + 6px strip padding) so a note can never shrink below its sockets.
const NOTE_MIN_W = 160;
const NOTE_MIN_H = 80;
const FIELD_ROW_H = 22;
const fieldsStripHeight = (n: number) => (n > 0 ? n * FIELD_ROW_H + 6 : 0);

// Unconditional stop, for surfaces where a touch press must place the cursor rather
// than start a drag; the READ body keeps coarse-aware stopDragStart so it can drag.
const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/** Marked renders a GFM task-list item as a DISABLED checkbox, and a disabled input
 *  fires no click. Strip `disabled` from the checkbox inputs — the only `<input>`
 *  marked emits — so the read view's boxes are tickable. Runs on already-sanitized
 *  HTML (post-DOMPurify), so it only ever sees marked's own markup. */
function enableTaskCheckboxes(html: string): string {
  return html.replace(/<input\b[^>]*\btype="checkbox"[^>]*>/g, (tag) =>
    tag.replace(/\s+disabled(="[^"]*")?/g, ""),
  );
}


/** A `---`-fenced YAML block at the top of the body turns each key into a typed OUTPUT
 *  socket; those reconcile on BLUR, never per keystroke, so typing can't churn cables. */
export function NoteComponent({ data, emit }: NodeProps<NoteNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [body, setBody] = useState(data.body);
  const [color, setColor] = useState(data.color);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The shared header title-edit mechanic (click-to-edit, Enter/blur, Escape revert).
  const title = useEditableLabel(data);
  // Bumped whenever the frontmatter fields change (body commit / type override)
  // to re-render the strip + markdown off the node's freshly-synced derived state.
  const [, setFieldsVersion] = useState(0);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);

  useEffect(() => { setBody(data.body); }, [data.body]);
  useEffect(() => { setColor(data.color); }, [data.color]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  // The body text last reconciled to sockets — lets a no-edit blur skip the heavy
  // view.update + processGraph, whose mid-gesture re-render closed the mobile keyboard.
  const lastSyncRef = useRef(data.body);
  // Suppress an enter-edit click landing within a beat of a blur: on mobile the same
  // tap that dismisses the keyboard falls through onto the read view and reopens it.
  const lastBlurRef = useRef(0);
  const startEdit = () => { if (Date.now() - lastBlurRef.current > 300) setEditing(true); };

  // Runs on editor blur and after a type override, NEVER per keystroke. `force` is for
  // the override path, which mutates fieldTypes rather than the body.
  async function commitFields(force = false) {
    if (!force && data.body === lastSyncRef.current) return;
    lastSyncRef.current = data.body;
    const { removed, retyped } = data.syncFields();
    const editor = getActiveEditor();
    const view = getActiveView();
    await dropStrandedFrontmatterCables(data.id, removed, retyped);
    setFieldsVersion((v) => v + 1);
    await view?.rerenderNode(data.id);
    // A pure retype fires no connection event, so re-adapt downstream FCs by hand or
    // they keep formatting by the OLD type.
    if (editor && view && retyped.length) reconcileFcTypes(editor, view);
    bumpConnectionVersion(); // re-route cables whose source row shifted
    await processGraph();
  }

  async function setFieldType(key: string, t: FrontmatterFieldType) {
    data.fieldTypes[key] = t;
    scheduleAutosave();
    await commitFields(true);
  }

  const fieldKeys = data.fieldKeys();
  // NOT data.data() — that's the installErrorGuards-wrapped version, which throws
  // when called with no inputs (firstInputError runs outside its try/catch).
  const fieldValues = data.fieldValues();
  // Height floor grows with the fields strip so a resize can never clip a socket row.
  const minNoteH = NOTE_MIN_H + fieldsStripHeight(fieldKeys.length);

  // The body wrapper clips, so the `document` dot lives at the card root with a
  // MEASURED top at the body's center (−6 for its own half-height).
  const noteRootRef = useRef<HTMLDivElement>(null);
  const noteBodyRef = useRef<HTMLDivElement>(null);
  const [docDotTop, setDocDotTop] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const bodyEl = noteBodyRef.current, rootEl = noteRootRef.current;
    if (!bodyEl || !rootEl) { setDocDotTop(undefined); return; }
    let y = 0;
    for (let el: HTMLElement | null = bodyEl; el && el !== rootEl; el = el.offsetParent as HTMLElement | null) y += el.offsetTop;
    setDocDotTop(y + bodyEl.offsetHeight / 2 - 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, fieldKeys.length, data.height, data.width, body]);

  // Manual width + height, like a Group: a fixed box the body fills and scrolls in.
  // No history entry — just an autosave on release.
  const Grip = useFlowResizeGrip();
  function onResize(size: { width: number; height: number }) {
    data.width = Math.max(NOTE_MIN_W, size.width);
    data.height = Math.max(minNoteH, size.height);
    void getActiveView()?.rerenderNode(data.id);
  }
  function onResizeEnd() {
    scheduleAutosave();
    // The standoff solver MEASURES offsetWidth/Height, so defer a frame for the paint;
    // pinning this note makes its partner re-align, not the reverse.
    if (!standoffStore.isEmpty()) {
      requestAnimationFrame(() => settleStandoffs(new Set([data.id])));
    }
  }

  // Derived LIVE from `body`, not `data.renderBody` — the RENDER is deliberately
  // decoupled from the blur-driven socket-commit cycle, which would go stale.
  const renderBody = useMemo(() => parseNoteFrontmatter(body).body, [body]);
  // NOT trusted content — a body arrives in shared .solenoid files and marked does no
  // sanitizing, so sanitize EVERY render (the CSP is only the second layer).
  const bodyHtml = useMemo(
    () => enableTaskCheckboxes(DOMPurify.sanitize(marked.parse(renderBody || "", { async: false, gfm: true, breaks: true }) as string)),
    [renderBody],
  );
  // The read body's task-list checkboxes index into it in document order (= source
  // order, since a nested item's box still comes after its parent's).
  const renderedRef = useRef<HTMLDivElement>(null);
  function onRenderedClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target;
    // A tick on a task checkbox toggles its source marker; it must NOT fall through
    // to startEdit (which would swap in the textarea and drop the tap). The box is a
    // native input, like the Boolean Input node's.
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      const boxes = renderedRef.current?.querySelectorAll('input[type="checkbox"]');
      const idx = boxes ? Array.prototype.indexOf.call(boxes, target) : -1;
      if (idx >= 0) {
        const next = toggleTaskMarker(body, idx);
        setBody(next);
        data.body = next;
        scheduleAutosave();
        // view.update re-captures the note for the canvas renderer (a bare setBody
        // leaves the OLD text showing there, same reason `pick` does it); processGraph
        // refreshes the `document` output for any downstream sink.
        void getActiveView()?.rerenderNode(data.id);
        void processGraph(data.id);
      }
      return;
    }
    startEdit();
  }

  // Store the raw text live (autosave), but DON'T reconcile sockets per keystroke —
  // that happens on blur (commitFields), so editing the YAML doesn't churn cables.
  function onBody(v: string) { setBody(v); data.body = v; scheduleAutosave(); }
  // view.update drives the pipe the HTML-canvas renderer re-captures on; a bare setColor
  // re-renders only rete's root, leaving the canvas showing the OLD color.
  function pick(c: string) { setColor(c); data.color = c; void getActiveView()?.rerenderNode(data.id); scheduleAutosave(); }
  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  const mode = appThemeStore.getMode();
  const themed = themeAccent(resolveColor(color), mode);
  const vars = {
    "--note-color": themed,
    "--note-bg": hexToRgba(themed, 0.3),
  } as React.CSSProperties;

  return (
    <div
      ref={noteRootRef}
      className={`solenoid-note${data.selected ? " solenoid-note--selected" : ""}${collapsed ? " solenoid-note--collapsed" : ""}${fieldKeys.length ? " solenoid-note--has-fields" : ""}`}
      style={{ width: data.width, height: collapsed ? undefined : Math.max(data.height, minNoteH), ...vars }}
    >
      <div className="solenoid-note__bar">
        <button
          type="button"
          className="solenoid-note__chevron"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={(e) => { e.stopPropagation(); toggleCollapse(); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {title.editing ? (
          <input className="solenoid-note__name" placeholder="Note" {...title.inputProps} />
        ) : (
          // Fit-content so the textless part of the bar stays draggable.
          <div
            className={`solenoid-note__name-display${data.label.trim() ? "" : " solenoid-note__name-display--empty"}`}
            title={data.label || "Note"}
            {...title.displayProps}
          >
            {data.label.trim() || "Note"}
          </div>
        )}
        <button
          ref={swatchRef}
          type="button"
          className="solenoid-note__swatch"
          title="Note color"
          onClick={(e) => { e.stopPropagation(); setPickerOpen((o) => !o); }}
          onPointerDown={stopDragStart}
          onMouseDown={stopDragStart}
        >
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="6" cy="6" r="4.5" />
          </svg>
        </button>
        {pickerOpen && (
          <div ref={paletteRef} className="solenoid-note__palette" onPointerDown={stop} onMouseDown={stop}>
            <SwatchGrid value={color} onPick={pick} />
          </div>
        )}
      </div>
      {fieldKeys.length > 0 && (
        // OUTSIDE the overflow-clipped content so the dots straddle the right edge, and
        // rendered even when COLLAPSED so the output sockets and their cables survive.
        <div className="solenoid-note__fields">
          {fieldKeys.map((key) => {
            const t = data.fieldType(key);
            const output = data.outputs[key];
            if (!t || !output) return null;
            return (
              <FieldRow
                key={key}
                nodeId={data.id}
                emit={emit}
                fieldKey={key}
                type={t}
                value={fieldValues[key]}
                socket={output.socket}
                onPickType={(nt) => void setFieldType(key, nt)}
              />
            );
          })}
        </div>
      )}
      {/* The `document` OUTPUT — the whole note as a DocumentValue for a document sink.
          Always present, independent of the frontmatter fields. */}
      {data.outputs.document && (
        <NodeSocket side="output" socketKey="document" nodeId={data.id} emit={emit} payload={data.outputs.document.socket} top={docDotTop} />
      )}
      {!collapsed && (
        /* Wrapper clips the scrolling body to the card's rounded base — a textarea
           (or its scrollbar) can't be clipped by the note's own radius without an
           overflow:hidden ancestor, and the note can't clip itself without eating
           the selection ring. */
        <div ref={noteBodyRef} className="solenoid-note__content">
          {editing ? (
            <textarea
              className="solenoid-note__body nowheel"
              value={body}
              placeholder="Markdown note…"
              spellCheck={false}
              autoFocus
              onChange={(e) => onBody(e.target.value)}
              onBlur={() => { lastBlurRef.current = Date.now(); setEditing(false); void commitFields(); }}
              // Unconditional stop, NOT the read body's stopDragStart — while editing a
              // tap must place the cursor, and rete's drag would close the keyboard.
              onPointerDown={stop}
              onMouseDown={stop}
            />
          ) : renderBody.trim() ? (
            // Plain markdown — a Note is output-only, so a `` `=name` `` span stays
            // literal inline code (no ref swap). bodyHtml is already sanitized.
            <div
              ref={renderedRef}
              className="solenoid-note__rendered sol-md nowheel"
              onClick={onRenderedClick}
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <div
              className="solenoid-note__rendered solenoid-note__rendered--empty"
              onClick={startEdit}
              onPointerDown={stopDragStart}
              onMouseDown={stopDragStart}
            >
              Markdown note…
            </div>
          )}
        </div>
      )}
      {!collapsed && Grip && (
        <Grip className="solenoid-note__resize" minWidth={NOTE_MIN_W} minHeight={minNoteH} onResize={onResize} onResizeEnd={onResizeEnd}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M11 5 5 11M11 9l-2 2" />
          </svg>
        </Grip>
      )}
    </div>
  );
}

/**
 * One frontmatter field row — the row is the socket dot's positioning context.
 * Exported so the Import-from-Obsidian card reuses the exact same row.
 */
export function FieldRow({
  nodeId, emit, fieldKey, type, value, socket, onPickType,
}: {
  nodeId: string;
  emit: Emit;
  fieldKey: string;
  type: FrontmatterFieldType;
  value: FieldValue;
  socket: ClassicPreset.Socket;
  onPickType: (t: FrontmatterFieldType) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), [btnRef, popRef]);
  // Offer the four element families at this field's current dimensionality — its
  // value already fixed scalar vs list; the override only swaps the element type. A
  // frame field has no element-type to swap, so its glyph is inert (no picker).
  const canRetype = type !== "frame";
  const options = isListFieldType(type) ? LIST_FIELD_TYPES : SCALAR_FIELD_TYPES;

  // An FC fed by this field formats the box BEHIND it — this row — so render its locked
  // format/unit (the upstream half of FC unit-locking), else the raw preview.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const ann = formatAnnotationStore.get(nodeId, fieldKey);
  const preview =
    ann && typeof value === "number" && Number.isFinite(value)
      ? formatNumberWithAnnotation(value, ann)
      : previewValue(value, type);

  return (
    <div className="solenoid-note__field-row">
      <button
        ref={btnRef}
        type="button"
        className="solenoid-note__field-glyph"
        title={canRetype ? `${FIELD_TYPE_LABEL[type]}. Change the type.` : FIELD_TYPE_LABEL[type]}
        onClick={(e) => { e.stopPropagation(); if (canRetype) setOpen((o) => !o); }}
        onPointerDown={stop}
        onMouseDown={stop}
      >
        <SocketDot entry={glyphFor(type)} />
      </button>
      <span className="solenoid-note__field-key" title={fieldKey}>{fieldKey}</span>
      <span className="solenoid-note__field-val" title={preview}>{preview}</span>
      {open && canRetype && (
        <div ref={popRef} className="solenoid-note__field-picker" onPointerDown={stop} onMouseDown={stop}>
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={"solenoid-note__field-opt" + (opt === type ? " solenoid-note__field-opt--on" : "")}
              title={FIELD_TYPE_LABEL[opt]}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onPickType(opt); }}
            >
              <SocketDot entry={glyphFor(opt)} />
              <span>{FIELD_TYPE_LABEL[opt]}</span>
            </button>
          ))}
        </div>
      )}
      <NodeSocket side="output" socketKey={fieldKey} nodeId={nodeId} emit={emit} payload={socket} />
    </div>
  );
}


// [[C68]] knapIsTheDocumentSyntax, [[D10]] onePrunePath
import { useFlowResizeGrip } from "../flowSurface";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import type { NoteNode as NoteNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { SocketDot, type SocketGlyph } from "./SocketLegend";
import { NodeSocket } from "./NodeSocket";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { useKnapRender } from "./useKnapRender";
import { useEditableLabel } from "./inlineInput";
// getActiveEditor and getActiveView: a Note inside a drill-in must prune and refresh on its own graph.
import { processGraph } from "../process";
import { bumpConnectionVersion } from "../graphSignals";
import { getActiveEditor, getActiveView } from "../activeGraph";
import { reconcileFcTypes } from "../fcReconcile";
import { scheduleAutosave } from "../persistence";
import { standoffStore, settleStandoffs } from "../standoffs";
import { SOCKET_COLORS, isDateType } from "../sockets";
import { dropStrandedFrontmatterCables } from "../noteFrontmatterSync";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { parseNoteFrontmatter, toggleTaskMarker, type FrontmatterFieldType, type FrontmatterValue } from "../noteFrontmatter";
import { isFrameValue, isCubeValue, cubeRowCount, cubeDepth, type FrameValue, type CubeValue } from "../frame";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import type { NodeProps, Emit } from "./nodeKit";
import type { ClassicPreset } from "rete";
import { stopDragStart } from "../coarse";
import "./Markdown.css";
import "./NoteNode.css";
import { renderNoteMarkdown } from "../noteMarkdown";
import { useKatexReady } from "./katexLoader";

type FieldValue = FrontmatterValue | FrameValue | CubeValue | SolError;

const FIELD_TYPES_AT_RANK: FrontmatterFieldType[][] = [
  ["number", "string", "date", "logical", "complex"],
  ["list", "strlist", "datelist", "logicallist", "complexlist"],
  ["table", "strtable", "datetable", "logicaltable", "complextable"],
];
const FIELD_TYPE_LABEL: Record<FrontmatterFieldType, string> = {
  number: "Number", string: "Text", date: "Date", logical: "Boolean", complex: "Complex",
  list: "Number list", strlist: "Text list", datelist: "Date list", logicallist: "Boolean list", complexlist: "Complex list",
  table: "Number table", strtable: "Text table", datetable: "Date table", logicaltable: "Boolean table", complextable: "Complex table",
  frame: "Frame", cube: "Cube",
};
const rankOfField = (t: FrontmatterFieldType): number => FIELD_TYPES_AT_RANK.findIndex((types) => types.includes(t));

function glyphFor(t: FrontmatterFieldType): SocketGlyph {
  return { kind: rankOfField(t) > 0 || t === "frame" || t === "cube" ? "square" : "circle", color: SOCKET_COLORS[t] };
}

function previewValue(value: FieldValue, t: FrontmatterFieldType): string {
  if (isSolError(value)) return value.code;
  if (t === "frame") {
    if (!isFrameValue(value)) return "Frame";
    return `${value.columns[0]?.values.length ?? 0}×${value.columns.length} Frame`;
  }
  if (t === "cube") {
    if (!isCubeValue(value)) return "Cube";
    return `${cubeRowCount(value)}×${value.columns.length}×${cubeDepth(value)} Cube`;
  }
  const one = (v: number | string | boolean | null): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number" && isDateType(t)) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
    return String(v);
  };
  if (Array.isArray(value) && rankOfField(t) === 2) {
    const rows = value as unknown[][];
    return `${rows.length}×${rows[0]?.length ?? 0} Table`;
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, 4).map((e) => one(e as number | string | boolean | null));
    return `[${shown.join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  return one(value as number | string | boolean | null);
}


const NOTE_MIN_W = 160;
const NOTE_MIN_H = 80;
const FIELD_ROW_H = 22;
const fieldsStripHeight = (n: number) => (n > 0 ? n * FIELD_ROW_H + 6 : 0);

// An unconditional stop, so a touch press places the cursor instead of starting a drag.
const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/** A disabled input fires no click; this runs on sanitized HTML, so it sees only marked's own checkboxes. */
function enableTaskCheckboxes(html: string, live: boolean): string {
  if (!live) return html;
  return html.replace(/<input\b[^>]*\btype="checkbox"[^>]*>/g, (tag) =>
    tag.replace(/\s+disabled(="[^"]*")?/g, ""),
  );
}


export function NoteComponent({ data, emit }: NodeProps<NoteNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [body, setBody] = useState(data.body);
  const [color, setColor] = useState(data.color);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const title = useEditableLabel(data);
  const [fieldsVersion, setFieldsVersion] = useState(0);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);

  useEffect(() => { setBody(data.body); }, [data.body]);
  useEffect(() => { setColor(data.color); }, [data.color]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  // A blur with no edit skips the heavy update, whose mid-gesture re-render closed the mobile keyboard.
  const lastSyncRef = useRef(data.body);
  // On mobile the tap that dismisses the keyboard falls through onto the read view and would reopen it.
  const lastBlurRef = useRef(0);
  const startEdit = () => { if (Date.now() - lastBlurRef.current > 300) setEditing(true); };

  // `force` is for the type override, which changes fieldTypes rather than the body.
  async function commitFields(force = false) {
    if (!force && data.body === lastSyncRef.current) return;
    lastSyncRef.current = data.body;
    const { removed, retyped } = data.syncFields();
    const editor = getActiveEditor();
    const view = getActiveView();
    await dropStrandedFrontmatterCables(data.id, removed, retyped);
    setFieldsVersion((v) => v + 1);
    await view?.rerenderNode(data.id);
    if (editor && view && retyped.length) reconcileFcTypes(editor, view);
    bumpConnectionVersion(); // re-route cables whose source row shifted
    await processGraph();
  }

  // The body stays a local draft while typing and reaches the node here ([[C95]] commitOnEnter).
  async function commitBody() {
    if (body !== data.body) { data.body = body; scheduleAutosave(); }
    await commitFields();
  }

  async function setFieldType(key: string, t: FrontmatterFieldType) {
    data.fieldTypes[key] = t;
    scheduleAutosave();
    await commitFields(true);
  }

  const fieldKeys = data.fieldKeys();
  // Never data.data(): the error-guard wrapper throws when called with no inputs.
  const fieldValues = data.fieldValues();
  const minNoteH = NOTE_MIN_H + fieldsStripHeight(fieldKeys.length);

  // The body wrapper clips, so the `document` dot sits at the card root, measured to the body's center.
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

  const Grip = useFlowResizeGrip();
  function onResize(size: { width: number; height: number }) {
    data.width = Math.max(NOTE_MIN_W, size.width);
    data.height = Math.max(minNoteH, size.height);
    void getActiveView()?.rerenderNode(data.id);
  }
  function onResizeEnd() {
    scheduleAutosave();
  // The standoff solver measures offsetWidth and offsetHeight, so wait a frame for the paint.
    if (!standoffStore.isEmpty()) {
      requestAnimationFrame(() => settleStandoffs(new Set([data.id])));
    }
  }

  const templateVars = useMemo(() => data.templateVariables(), [data, fieldsVersion]);
  const { text: rendered, errors: templateErrors } = useKnapRender(body, templateVars, 0, null, true);
  const renderBody = useMemo(() => parseNoteFrontmatter(rendered).body, [rendered]);
  const tex = useKatexReady();
  const bodyHtml = useMemo(
    () => enableTaskCheckboxes(DOMPurify.sanitize(renderNoteMarkdown(renderBody || "")), rendered === body),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [renderBody, rendered, body, tex],
  );
  // Checkbox order in the rendered body is source order: a nested item's box still follows its parent's.
  const renderedRef = useRef<HTMLDivElement>(null);
  function onRenderedClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target;
    // A tick must not fall through to startEdit, which would swap in the textarea and drop the tap.
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      const boxes = renderedRef.current?.querySelectorAll('input[type="checkbox"]');
      const idx = boxes ? Array.prototype.indexOf.call(boxes, target) : -1;
      if (idx >= 0) {
        const next = toggleTaskMarker(body, idx);
        setBody(next);
        data.body = next;
        scheduleAutosave();
        // A bare setBody leaves the old text on the canvas renderer; view.update re-captures it.
        void getActiveView()?.rerenderNode(data.id);
        void processGraph(data.id);
      }
      return;
    }
    startEdit();
  }

  // A bare setColor re-renders only rete's root, leaving the canvas renderer on the old color.
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
        // Outside the clipped content so the dots straddle the edge; rendered collapsed too, so cables survive.
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
      {/* Always present, independent of the frontmatter fields. */}
      {data.outputs.document && (
        <NodeSocket side="output" socketKey="document" nodeId={data.id} emit={emit} payload={data.outputs.document.socket} top={docDotTop} />
      )}
      {!collapsed && (
        /* A textarea can't be clipped by the note's own radius without an overflow:hidden ancestor. */
        <div ref={noteBodyRef} className="solenoid-note__content">
          {editing ? (
            <textarea
              className="solenoid-note__body nowheel"
              value={body}
              placeholder="Markdown note…"
              spellCheck={false}
              autoFocus
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => { lastBlurRef.current = Date.now(); setEditing(false); void commitBody(); }}
              // Not stopDragStart: while editing a tap must place the cursor, and rete's drag would close the keyboard.
              onPointerDown={stop}
              onMouseDown={stop}
            />
          ) : templateErrors ? (
            <pre className="solenoid-note__rendered solenoid-note__template-error" onClick={startEdit} onPointerDown={stopDragStart} onMouseDown={stopDragStart}>{templateErrors}</pre>
          ) : renderBody.trim() ? (
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
  const canRetype = type !== "frame" && type !== "cube";
  const options = FIELD_TYPES_AT_RANK[rankOfField(type)] ?? [];

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
      {isSolError(value)
        ? <span className="solenoid-note__field-val solenoid-note__field-val--error" title={errorTip(value)}>{value.code}</span>
        : <span className="solenoid-note__field-val" title={preview}>{preview}</span>}
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


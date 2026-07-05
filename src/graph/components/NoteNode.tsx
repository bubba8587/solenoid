import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { NoteNode as NoteNodeType } from "../rete-nodes";
import { hexToRgba, themeAccent, resolveColor } from "../palette";
import { appThemeStore } from "../appTheme";
import { SwatchGrid } from "./SwatchGrid";
import { SocketDot, type SocketGlyph } from "./SocketLegend";
import { NodeSocket } from "./NodeSocket";
import { useDismissOnOutside } from "./useDismissOnOutside";
import { getArea, getEditor, processGraph, bumpConnectionVersion, pushHistory } from "../process";
import { reconcileFcTypes } from "../fcReconcile";
import { scheduleAutosave } from "../persistence";
import { gridSnapStore, snapCoord } from "../gridSnapStore";
import { standoffStore, settleStandoffs } from "../standoffs";
import { SOCKET_COLORS, SolenoidSocket, canConnect } from "../sockets";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { formatDateSerial, DEFAULT_DATE_FORMAT } from "../nodes/date";
import { parseNoteFrontmatter, type FrontmatterFieldType, type FrontmatterValue } from "../noteFrontmatter";
import type { NodeProps, Emit } from "./nodeKit";
import type { ClassicPreset } from "rete";
import { stopDragStart } from "../coarse";
import "./Markdown.css";
import "./NoteNode.css";

// Field types grouped by dimensionality — the type-override picker offers the four
// element families at the field's current dimension (scalar ↔ list). The glyph
// reuses the Socket Legend vocabulary: circle = scalar, square = list, family color.
const SCALAR_FIELD_TYPES: FrontmatterFieldType[] = ["number", "string", "date", "logical"];
const LIST_FIELD_TYPES: FrontmatterFieldType[] = ["list", "strlist", "datelist", "logicallist"];
const FIELD_TYPE_LABEL: Record<FrontmatterFieldType, string> = {
  number: "Number", string: "Text", date: "Date", logical: "Boolean",
  list: "Number list", strlist: "Text list", datelist: "Date list", logicallist: "Boolean list",
};
const isListFieldType = (t: FrontmatterFieldType) => LIST_FIELD_TYPES.includes(t);

function glyphFor(t: FrontmatterFieldType): SocketGlyph {
  return { kind: isListFieldType(t) ? "square" : "circle", color: SOCKET_COLORS[t] };
}

/** A short, human-readable preview of a field's value for the row. */
function previewValue(value: FrontmatterValue, t: FrontmatterFieldType): string {
  const one = (v: number | string | boolean | null): string => {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
    if (typeof v === "number" && (t === "date" || t === "datelist")) return formatDateSerial(v, DEFAULT_DATE_FORMAT);
    return String(v);
  };
  if (Array.isArray(value)) {
    const shown = value.slice(0, 4).map(one);
    return `[${shown.join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  return one(value);
}

// A body EDIT that removes a wired frontmatter key strands its cable: `syncFields`
// drops the output socket (a body-derived change history doesn't track), while the
// caller's `removeConnection` IS tracked — so a plain Ctrl+Z re-adds the cable onto a
// socket that no longer exists (a zombie cable to a missing output). Record the body
// edit as its OWN undo entry, pushed AFTER the cable removals so undo restores the body
// + re-derives the socket FIRST and the cable re-add then lands on a live socket — the
// same ordering `ExtensibleInputs.pushRowRemovalUndo` uses, adapted to the note's
// body-derived sockets. `refresh` re-renders the note + re-routes cables + recomputes.
// Exported for the unit test. (A per-key type override pruned on removal isn't restored
// — the re-derived socket takes the guessed type; the rare override+remove+undo edge.)
type NoteSyncHost = { body: string; syncFields: () => unknown };
export function pushNoteFieldRemovalUndo(
  node: NoteSyncHost, prevBody: string, newBody: string, refresh: () => void,
): void {
  pushHistory(
    () => { node.body = prevBody; node.syncFields(); refresh(); }, // undo → body + socket back
    () => { node.body = newBody; node.syncFields(); refresh(); },  // redo → re-apply the edit
  );
}

// Resize floor — width keeps the header (chevron + name + swatch) legible; height
// keeps the bar plus a sliver of body. No ceiling (like Groups): notes grow freely.
// The height floor GROWS by the frontmatter fields strip: each output-socket row is
// ~22px (.solenoid-note__field-row min-height 18 + 2+2 padding) and the strip adds
// 6px (3+3) of its own padding, so a note can never shrink below its sockets.
const NOTE_MIN_W = 160;
const NOTE_MIN_H = 80;
const FIELD_ROW_H = 22;
const fieldsStripHeight = (n: number) => (n > 0 ? n * FIELD_ROW_H + 6 : 0);

// Unconditional stop — used by the palette popup, the click-to-edit title, AND the
// body textarea while editing (so a touch press positions the cursor / long-presses
// to copy instead of bubbling to rete's drag). The READ body still uses the coarse-
// aware stopDragStart so a touch press there can bubble to rete to drag the note.
const stop = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();

/**
 * A canvas Note — a free-floating sticky annotation. The header bar is the drag
 * handle; the title is a click-to-edit label (matches other nodes) and the body
 * stops pointerdown so editing doesn't start a drag. Tinted by `color`; the body
 * fills the note's manual height and scrolls. Edits persist via scheduleAutosave.
 *
 * If the body opens with an Obsidian-style `---`-fenced YAML block, each key
 * becomes a typed OUTPUT socket (see noteFrontmatter.ts) shown in a fields strip
 * below the header; the markdown renders below that. Sockets reconcile on BLUR
 * (commit-on-clickaway), never per keystroke — so editing the YAML doesn't churn
 * cables mid-type.
 */
export function NoteComponent({ data, emit }: NodeProps<NoteNodeType>) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const [label, setLabel] = useState(data.label);
  const [body, setBody] = useState(data.body);
  const [color, setColor] = useState(data.color);
  const [collapsed, setCollapsed] = useState(data.collapsed);
  const [editing, setEditing] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Bumped whenever the frontmatter fields change (body commit / type override)
  // to re-render the strip + markdown off the node's freshly-synced derived state.
  const [, setFieldsVersion] = useState(0);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(pickerOpen, () => setPickerOpen(false), [swatchRef, paletteRef]);

  useEffect(() => { setLabel(data.label); }, [data.label]);
  useEffect(() => { setBody(data.body); }, [data.body]);
  useEffect(() => { setColor(data.color); }, [data.color]);
  useEffect(() => { setCollapsed(data.collapsed); }, [data.collapsed]);

  // The body text last reconciled to sockets. Lets a blur with no edit (e.g. a
  // mobile long-press to copy/paste) skip the heavy area.update + processGraph — that
  // re-render mid-gesture was closing/reopening the keyboard.
  const lastSyncRef = useRef(data.body);
  // Timestamp of the last editor blur. On mobile a tap that dismisses the keyboard
  // blurs the textarea, then the SAME gesture's click falls through onto the read
  // view that replaced it → re-enter → keyboard reopens (a flicker on every tap).
  // Suppress an enter-edit click that lands within a beat of a blur.
  const lastBlurRef = useRef(0);
  const startEdit = () => { if (Date.now() - lastBlurRef.current > 300) setEditing(true); };

  // Commit the body's frontmatter to sockets: re-sync, drop cables that lost their
  // output (a removed or retyped key), then re-render + recompute downstream. Run on
  // blur of the editor and after a type override — NOT per keystroke. `force` runs
  // even when the body string is unchanged (a type override mutates fieldTypes, not
  // the body); otherwise an unchanged body is a no-op so a no-edit blur stays cheap.
  async function commitFields(force = false) {
    if (!force && data.body === lastSyncRef.current) return;
    const prevBody = lastSyncRef.current; // body BEFORE this commit (still has the removed key)
    const newBody = data.body;
    lastSyncRef.current = data.body;
    const { removed, retyped } = data.syncFields();
    const editor = getEditor();
    const area = getArea();
    let strandedByRemoval = false; // did we drop a cable because its output key was REMOVED?
    if (editor && (removed.length || retyped.length)) {
      // A retyped output (same key, new socket type) keeps its cable when the
      // downstream input still accepts the new type — an `any` input always does;
      // a same-family widening (e.g. number→list into a list input) does too. Only
      // a now-incompatible target, or a fully removed key, drops the cable.
      const retypedMap = new Map(retyped.map((r) => [r.key, r.type]));
      for (const c of editor.getConnections()) {
        if (c.source !== data.id) continue;
        if (removed.includes(c.sourceOutput)) { await editor.removeConnection(c.id); strandedByRemoval = true; continue; }
        const newType = retypedMap.get(c.sourceOutput);
        if (newType === undefined) continue; // unchanged output — leave it
        const inSock = editor.getNode(c.target)?.inputs?.[c.targetInput]?.socket;
        const inType = inSock instanceof SolenoidSocket ? inSock.dataType : undefined;
        if (!inType || !canConnect(newType, inType)) await editor.removeConnection(c.id);
      }
    }
    // If a body EDIT stranded a cable by removing its key, make that body change undoable
    // AS ONE with the cable removal (pushed AFTER the removeConnection entries so undo
    // restores the body + socket before the cable re-add lands — else Ctrl+Z leaves a
    // zombie cable to a missing output). Body-path only (`!force`); a type-override drop
    // mutates fieldTypes, not the body, so it's a separate case.
    if (!force && strandedByRemoval && prevBody !== newBody) {
      pushNoteFieldRemovalUndo(data, prevBody, newBody, () => {
        setBody(data.body);
        setFieldsVersion((v) => v + 1);
        const ed = getEditor(); const ar = getArea();
        void ar?.update("node", data.id);
        if (ed && ar) reconcileFcTypes(ed, ar);
        bumpConnectionVersion();
        void processGraph();
      });
    }
    setFieldsVersion((v) => v + 1);
    await area?.update("node", data.id);
    // A retyped output changed the type flowing downstream — re-adapt every Format
    // Controller so it reformats by the NEW type (a date→number retype must stop
    // formatting as a date down the whole chain). No connection event fires on a
    // pure retype, so the Canvas pipe wouldn't otherwise run.
    if (editor && area && retyped.length) reconcileFcTypes(editor, area);
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
  // Height floor grows with the output-fields strip so resizing (and the rendered
  // height) can never clip a socket row. Plain note (no frontmatter) → the original 80.
  const minNoteH = NOTE_MIN_H + fieldsStripHeight(fieldKeys.length);

  // Manual width + height (drag the corner grip — same model as a Group). The note
  // is a fixed box; the body fills it and scrolls. area.update re-renders on each
  // move (width/height read straight off `data` in the style). No history (notes
  // never recorded one), just an autosave on release.
  function onResizeDown(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const startW = data.width, startH = data.height;
    const area = getArea();
    const k = area?.area.transform.k ?? 1;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      data.width = Math.max(NOTE_MIN_W, startW + (ev.clientX - startX) / k);
      data.height = Math.max(minNoteH, startH + (ev.clientY - startY) / k);
      void area?.update("node", data.id);
    };
    const up = () => {
      handle.releasePointerCapture(e.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      // Snap-to-grid (on release): land the bottom-right corner on the grid by
      // adjusting w/h (the top-left is fixed during a resize) — same as Groups.
      if (gridSnapStore.get()) {
        const pos = area?.nodeViews.get(data.id)?.position;
        if (pos) {
          data.width = Math.max(NOTE_MIN_W, snapCoord(pos.x + data.width) - pos.x);
          data.height = Math.max(minNoteH, snapCoord(pos.y + data.height) - pos.y);
        }
      }
      void area?.update("node", data.id);
      scheduleAutosave();
      // Re-resolve standoffs against the new bbox once we let go. The solver
      // MEASURES offsetWidth/Height, so defer one frame to let the resize paint.
      // Pin this note so its standoff partner re-aligns to it, not the reverse.
      if (!standoffStore.isEmpty()) {
        requestAnimationFrame(() => settleStandoffs(new Set([data.id])));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // The markdown to render BELOW any frontmatter block — derived LIVE from the
  // current `body` state, NOT from `data.renderBody`. `data.renderBody` only
  // refreshes inside commitFields()→syncFields() on blur, and that path early-
  // returns when `data.body === lastSyncRef.current`; if a mobile keystroke/blur
  // races (the final delete didn't reach data.body before the commit, or blur fires
  // in an unexpected order), the cached renderBody stays stale and the read view
  // freezes — e.g. a leftover `<hr>` from a half-typed `---` keeps the first line
  // shifted down until the next edit cycle. Parsing straight from `body` (a pure,
  // cheap frontmatter strip) makes the visual a function of the live text alone, so
  // it can never lag the socket-commit cycle. `body` is kept current everywhere:
  // onBody on each keystroke, and the `[data.body]` effect on external changes
  // (load / paste / undo). The socket lifecycle still commits on blur — only the
  // RENDER is decoupled from it.
  const renderBody = useMemo(() => parseNoteFrontmatter(body).body, [body]);
  // NOT trusted content: a Note body arrives in shared .solenoid files, and marked
  // does no sanitization — an <img onerror=…> in a note was a stored XSS with Tauri
  // IPC in reach (audit P0-6). Sanitize every render; the CSP is the second,
  // independent layer. `breaks: true` so a lone newline becomes a line break.
  const bodyHtml = useMemo(
    () => DOMPurify.sanitize(marked.parse(renderBody || "", { async: false, gfm: true, breaks: true }) as string),
    [renderBody],
  );

  function onLabel(v: string) { setLabel(v); data.label = v; scheduleAutosave(); }
  // Store the raw text live (autosave), but DON'T reconcile sockets per keystroke —
  // that happens on blur (commitFields), so editing the YAML doesn't churn cables.
  function onBody(v: string) { setBody(v); data.body = v; scheduleAutosave(); }
  // area.update fires the area "render"/node pipe the HTML-canvas renderer rebuilds on, so a
  // recolor re-captures the note's clone (a bare setColor only re-renders rete's root — the
  // canvas never sees it, leaving the next pan/zoom showing the OLD color).
  function pick(c: string) { setColor(c); data.color = c; void getArea()?.update("node", data.id); scheduleAutosave(); }
  function toggleCollapse() { const v = !collapsed; setCollapsed(v); data.collapsed = v; scheduleAutosave(); }

  const mode = appThemeStore.getMode();
  const themed = themeAccent(resolveColor(color), mode);
  const vars = {
    "--note-color": themed,
    "--note-bg": hexToRgba(themed, 0.3),
  } as React.CSSProperties;

  return (
    <div
      className={`solenoid-note${data.selected ? " solenoid-note--selected" : ""}${collapsed ? " solenoid-note--collapsed" : ""}${fieldKeys.length ? " solenoid-note--has-fields" : ""}`}
      style={{ width: data.width, height: collapsed ? undefined : Math.max(data.height, minNoteH), ...vars }}
    >
      <div className="solenoid-note__bar" title="Drag to move">
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
        {editingLabel ? (
          <input
            className="solenoid-note__name"
            value={label}
            placeholder="Note"
            spellCheck={false}
            autoFocus
            onChange={(e) => onLabel(e.target.value)}
            onBlur={() => setEditingLabel(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
            onPointerDown={stop}
            onMouseDown={stop}
          />
        ) : (
          // Click-to-edit, fit-content title — mirrors a regular node's header
          // label so the textless part of the bar stays draggable (the title only
          // intercepts clicks on the text itself, like every other node).
          <div
            className={`solenoid-note__name-display${label.trim() ? "" : " solenoid-note__name-display--empty"}`}
            title={label || "Note"}
            onClick={() => setEditingLabel(true)}
            onPointerDown={stop}
            onMouseDown={stop}
          >
            {label.trim() || "Note"}
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
        // Frontmatter → typed output sockets. A full-width strip OUTSIDE the
        // overflow-clipped content so the dots can straddle the right edge. Each
        // row is a positioning context, so a plain NodeSocket (no explicit top)
        // centers on the row via its 50% fallback. Rendered even when COLLAPSED so
        // the output sockets — and any cables wired to them — survive (a data note
        // collapses to its fields, hiding only the prose body).
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
      {!collapsed && (
        /* Wrapper clips the scrolling body to the card's rounded base — a textarea
           (or its scrollbar) can't be clipped by the note's own radius without an
           overflow:hidden ancestor, and the note can't clip itself without eating
           the selection ring. */
        <div className="solenoid-note__content">
          {editing ? (
            <textarea
              className="solenoid-note__body"
              value={body}
              placeholder="Note… (markdown)"
              spellCheck={false}
              autoFocus
              onChange={(e) => onBody(e.target.value)}
              onBlur={() => { lastBlurRef.current = Date.now(); setEditing(false); void commitFields(); }}
              // Unconditional stop (like the title input) — NOT the coarse-aware
              // stopDragStart the read body uses. While editing, a tap must position
              // the cursor / long-press to copy, not bubble to rete's drag (which on
              // touch stole focus and closed the keyboard on every tap).
              onPointerDown={stop}
              onMouseDown={stop}
            />
          ) : renderBody.trim() ? (
            // Plain markdown — a Note is output-only, so a `` `=name` `` span stays
            // literal inline code (no ref swap). bodyHtml is already sanitized.
            <div
              className="solenoid-note__rendered sol-md"
              onClick={startEdit}
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
              Note… (markdown)
            </div>
          )}
        </div>
      )}
      {!collapsed && (
        <div
          className="solenoid-note__resize"
          title="Drag to resize"
          onPointerDown={onResizeDown}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M11 5 5 11M11 9l-2 2" />
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * One frontmatter field row: a type-glyph button (click → override picker, reusing
 * the Socket Legend glyphs), the key, a value preview, and the output socket dot
 * straddling the note's right edge. The row is the socket's positioning context.
 */
function FieldRow({
  nodeId, emit, fieldKey, type, value, socket, onPickType,
}: {
  nodeId: string;
  emit: Emit;
  fieldKey: string;
  type: FrontmatterFieldType;
  value: FrontmatterValue;
  socket: ClassicPreset.Socket;
  onPickType: (t: FrontmatterFieldType) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => setOpen(false), [btnRef, popRef]);
  // Offer the four element families at this field's current dimensionality — its
  // value already fixed scalar vs list; the override only swaps the element type.
  const options = isListFieldType(type) ? LIST_FIELD_TYPES : SCALAR_FIELD_TYPES;

  // An FC fed by this field formats the box BEHIND it — i.e. this row. Render that
  // locked format/unit (the upstream half of FC unit-locking); fall back to the raw
  // preview. Re-render when any annotation changes.
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
        title={`${FIELD_TYPE_LABEL[type]} — click to change type`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onPointerDown={stop}
        onMouseDown={stop}
      >
        <SocketDot entry={glyphFor(type)} />
      </button>
      <span className="solenoid-note__field-key" title={fieldKey}>{fieldKey}</span>
      <span className="solenoid-note__field-val" title={preview}>{preview}</span>
      {open && (
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

// Inline-ref rendering (InlineRefBody/InlineRefValue/RefInputRow/…) lives in
// components/inlineRefDisplay.tsx and is used by the REPORT node only — a Note is
// output-only (no `=name` inputs), so it renders its body as plain markdown above.

// [[C95]] commitOnEnter (useDraftCommit, useEditableLabel), [[C28]] literalsIffEditable, [[D16]] retypeReconciles. Mechanics: tree/specs/documents/literal-input-editors.md.
import type { Emit } from "./nodeKit";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { useKatexRender } from "./katexLoader";
import type { ClassicPreset } from "rete";
import { SolenoidSocket } from "../sockets";
import { processGraph } from "../process";
import { scheduleAutosave } from "../persistence";
import { connectionVersionStore } from "../graphSignals";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { nodeName } from "../catalogUtils";
import { collapseStore } from "../collapseStore";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { ColumnPickerField } from "./ColumnPickerField";
import { columnPickersOf } from "../nodes/columnPickerHook";
import { stopDragStart } from "../coarse";
import { usePendingDraft } from "../draftFlush";
import { decimalFromText } from "../valueKinds";

// Body-height estimate only; socket placement is measured per row.
export const INPUT_ROW_PITCH = 28;

/** Derived at render time, never cached in state, so any re-render sees the current graph. */
export function useConnectedInputs(nodeId: string): Set<string> {
  // getOwningEditor, not getEditor: a node inside a drill-in must read its own graph's connections.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const conns = getOwningEditor(nodeId)?.getConnections() ?? [];
  const set = new Set<string>();
  for (const c of conns) {
    if (c.target === nodeId && typeof c.targetInput === "string") set.add(c.targetInput);
  }
  return set;
}

export type IncomingSource = { sourceId: string; sourceOutput: string; label: string };

/** Derived at render time because a source's label changes on rename, not only on connection changes. */
export function useIncomingSources(nodeId: string): Map<string, IncomingSource> {
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const editor = getOwningEditor(nodeId);
  const map = new Map<string, IncomingSource>();
  for (const c of editor?.getConnections() ?? []) {
    if (c.target !== nodeId || typeof c.targetInput !== "string") continue;
    const src = editor?.getNode(c.source);
    // An unlabeled source shows its catalog name ([[D22]] oneNamePerCard).
    const srcLabel = (src as { label?: string } | undefined)?.label?.trim();
    map.set(c.targetInput, {
      sourceId: c.source,
      sourceOutput: c.sourceOutput as string,
      label: srcLabel || (src ? (nodeName(src) ?? "") : ""),
    });
  }
  return map;
}

/** `parse` result for a draft that can't become a value (commit reverts). */
export const INVALID_DRAFT = Symbol("invalid-draft");

/** [[C95]] commitOnEnter. `apply` owns the mirror + processGraph, never onChange. */
export function useDraftCommit<T>(
  committed: T,
  toText: (v: T) => string,
  parse: (text: string) => T | typeof INVALID_DRAFT,
  apply: (v: T) => void,
) {
  const [draft, setDraft] = useState(() => toText(committed));
  const canceled = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(toText(committed)); }, [committed]);
  const commit = () => {
    const next = parse(draft);
    if (next === INVALID_DRAFT || Object.is(next, committed)) {
      setDraft(toText(committed));
      return;
    }
    apply(next);
  };
  usePendingDraft(draft !== toText(committed), commit);
  const onBlur = () => {
    if (canceled.current) { canceled.current = false; setDraft(toText(committed)); return; }
    commit();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
  };
  return { draft, setDraft, onBlur, onKeyDown };
}

// The title swallows the pointer (the caret needs it); the rest of the header stays the drag handle.
const stopTitle = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Spread `inputProps` onto the editing <input> and `displayProps` onto the display; Group drives `begin()` itself. */
export function useEditableLabel(node: { label: string }, onCommit?: () => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.label);
  const canceled = useRef(false);
  useEffect(() => { if (!editing) setDraft(node.label); }, [node.label, editing]);

  const begin = () => { setDraft(node.label); canceled.current = false; setEditing(true); };
  const commit = () => {
    setEditing(false);
    if (canceled.current) { canceled.current = false; return; }
    if (draft !== node.label) { node.label = draft; scheduleAutosave(); onCommit?.(); }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
  };
  return {
    editing,
    begin,
    inputProps: {
      value: draft,
      autoFocus: true,
      spellCheck: false,
      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown,
      onPointerDown: stopTitle,
      onMouseDown: stopTitle,
    },
    displayProps: {
      onClick: begin,
      onPointerDown: stopTitle,
      onMouseDown: stopTitle,
    },
  };
}

const numToText = (v: number | undefined) => (v == null ? "" : String(v));
const parseNum = (t: string): number | undefined | typeof INVALID_DRAFT => {
  if (t.trim() === "") return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : INVALID_DRAFT;
};

// Under this, pointerup is a no-op, so a plain click still focuses and places a caret.
const SCRUB_MOVE_THRESHOLD = 4; // px
const SCRUB_PX_PER_STEP = 6; // px of drag per unit step, at the unmodified rate

type ScrubState = { startX: number; startY: number; startValue: number; currentValue: number; dragging: boolean };

/** Drag-to-scrub handlers for a number field: `showValue` previews the live draft (and
 *  reverts on cancel), `commitValue` applies the final value and owns its undo entry. */
export function useNumberScrub(
  committed: number | undefined,
  showValue: (v: number | undefined) => void,
  commitValue: (next: number) => void,
) {
  const dragRef = useRef<ScrubState | null>(null);
  // Window-level Escape listener, since a drag blurs the input; its ref unbinds it when a drag is interrupted.
  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  useEffect(() => () => {
    if (escRef.current) window.removeEventListener("keydown", escRef.current);
    // An unmount mid-drag skips endDrag; gated on this field owning the drag, so an unrelated unmount can't strip an active scrub's cursor class.
    if (dragRef.current) {
      dragRef.current = null;
      document.body.classList.remove("solenoid-scrubbing");
    }
  }, []);

  function endDrag(e: React.PointerEvent<HTMLInputElement>, commit: boolean) {
    const d = dragRef.current;
    dragRef.current = null;
    if (escRef.current) { window.removeEventListener("keydown", escRef.current); escRef.current = null; }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("solenoid-scrubbing");
    if (!d || !d.dragging) return;
    if (commit) {
      if (!Object.is(d.currentValue, committed)) commitValue(d.currentValue);
    } else {
      showValue(d.startValue);
    }
  }

  function onPointerDown(e: React.PointerEvent<HTMLInputElement>) {
    e.stopPropagation();
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startValue: committed ?? 0, currentValue: committed ?? 0, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    const onEsc = (ke: KeyboardEvent) => {
      if (ke.key !== "Escape") return;
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener("keydown", onEsc);
      escRef.current = null;
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      document.body.classList.remove("solenoid-scrubbing");
      if (d) showValue(d.startValue);
    };
    escRef.current = onEsc;
    window.addEventListener("keydown", onEsc);
  }

  function onPointerMove(e: React.PointerEvent<HTMLInputElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = d.startY - e.clientY;
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < SCRUB_MOVE_THRESHOLD) return;
      d.dragging = true;
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.classList.add("solenoid-scrubbing");
    }
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    // Count steps first, then scale: rounding the product would make Alt-fine a slow integer scrub instead of a 0.1 one.
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const raw = d.startValue + Math.round(delta / SCRUB_PX_PER_STEP) * mult;
    const next = mult < 1 ? Math.round(raw * 10) / 10 : raw;
    d.currentValue = next;
    showValue(next);
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: React.PointerEvent<HTMLInputElement>) => endDrag(e, true),
    onPointerCancel: (e: React.PointerEvent<HTMLInputElement>) => endDrag(e, false),
  };
}

export function InlineNumberField({
  value,
  onChange,
  placeholder = "0",
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  const field = useDraftCommit(value, numToText, parseNum, onChange);
  const scrub = useNumberScrub(
    value,
    (v) => field.setDraft(numToText(v)),
    (next) => {
      onChange(next);
    },
  );

  return (
    <input
      type="number"
      className="solenoid-node__inline-input"
      value={field.draft}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      {...scrub}
      onMouseDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}

export function QuotedTextInput(props: {
  value: string;
  onChange: (v: string) => void;
  variant?: "inline" | "value";
  autoFocus?: boolean;
  placeholder?: string;
  /** When set, the field shows a resize grip. */
  nodeId?: string;
  /** A `<datalist>` id for type-ahead suggestions (the caller renders the list). */
  listId?: string;
}) {
  // Multi-line textarea: a single-line <input> silently strips newlines on paste.
  return props.variant === "value"
    ? <QuotedValueTextarea value={props.value} onChange={props.onChange} autoFocus={props.autoFocus} />
    : <QuotedInlineInput value={props.value} onChange={props.onChange} autoFocus={props.autoFocus} placeholder={props.placeholder} listId={props.listId} />;
}

function QuotedInlineInput({ value, onChange, autoFocus, placeholder, listId }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string; listId?: string }) {
  const field = useDraftCommit(value, (v) => v, (t) => t, onChange);
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--inline">
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
      <span className="solenoid-node__quoted-field">
        <input
          type="text"
          className="solenoid-node__quoted-input"
          value={field.draft}
          placeholder={placeholder}
          list={listId}
          onChange={(e) => field.setDraft(e.target.value)}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          autoFocus={autoFocus}
        />
      </span>
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
    </span>
  );
}

const VALUE_TEXTAREA_MAX = 200;

function QuotedValueTextarea({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  const canceled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(value); }, [value]);
  // Before paint, so the grow never flickers.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, VALUE_TEXTAREA_MAX)}px`;
  }, [draft]);
  const commit = () => {
    if (canceled.current) { canceled.current = false; setDraft(value); return; }
    if (draft === value) return;
    onChange(draft);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
  };
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--value solenoid-node__quoted--multiline">
      <span className="solenoid-node__quoted-field">
        <textarea
          ref={ref}
          className="solenoid-node__quoted-input solenoid-node__quoted-textarea nowheel"
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          autoFocus={autoFocus}
        />
      </span>
    </span>
  );
}

export function InlineTextField({
  value,
  onChange,
  placeholder,
  listId,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  listId?: string;
}) {
  return <QuotedTextInput value={value ?? ""} onChange={onChange} placeholder={placeholder} listId={listId} />;
}

export type AutoLiteral = number | string | undefined;
const autoToText = (v: AutoLiteral) => (v == null ? "" : String(v));
const parseAuto = (t: string): AutoLiteral => {
  const trimmed = t.trim();
  if (trimmed === "") return undefined;
  const n = decimalFromText(trimmed);
  return Number.isFinite(n) ? n : t;
};

export function InlineAutoField({
  num,
  text,
  onChange,
  placeholder,
}: {
  num: number | undefined;
  text: string | undefined;
  /** Writes exactly one of the two maps; the caller clears the other. */
  onChange: (v: AutoLiteral) => void;
  placeholder?: string;
}) {
  const committed: AutoLiteral = text !== undefined ? text : num;
  const field = useDraftCommit<AutoLiteral>(committed, autoToText, parseAuto, onChange);
  const quoted = typeof committed === "string";
  const scrub = useNumberScrub(
    num,
    (v) => field.setDraft(autoToText(v)),
    (next) => {
      onChange(next);
    },
  );
  // type="text": a number input refuses a non-numeric draft outright.
  const input = (
    <input
      type="text"
      className={quoted ? "solenoid-node__quoted-input" : "solenoid-node__inline-input"}
      value={field.draft}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      {...(quoted ? { onPointerDown: stopDragStart } : scrub)}
      onMouseDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
  // The chrome flips only on commit, when the field is already blurred, so this remount costs no focus.
  if (!quoted) return input;
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--inline">
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
      <span className="solenoid-node__quoted-field">{input}</span>
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
    </span>
  );
}

export interface AutoLiteralHost {
  autoLiterals?: boolean;
  stringLiterals?: Record<string, string>;
}

export function takesAutoLiteral(node: AutoLiteralHost, dt: string | undefined): boolean {
  return !!node.autoLiterals && (dt === "any" || dt === "anydata" || dt === "trueany");
}

const DEFAULT_LABEL_RE = /^(.*?)\s*\(default\s+(.+?)\)\s*$/;
export function splitDefaultLabel(label: string): { label: string; placeholder?: string } {
  const m = DEFAULT_LABEL_RE.exec(label);
  if (!m) return { label };
  return { label: m[1], placeholder: m[2].replace(/^["']|["']$/g, "") };
}

export function InlineCsvField({
  value,
  onChange,
  listId,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  listId?: string;
}) {
  const field = useDraftCommit(value ?? "", (v) => v, (t) => t, onChange);
  return (
    <input
      type="text"
      className="solenoid-node__inline-input"
      value={field.draft}
      placeholder="a, b, c"
      list={listId}
      onChange={(e: ChangeEvent<HTMLInputElement>) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}


type InputPort = { socket: ClassicPreset.Socket; label?: string };
export type InlineNode = {
  id: string;
  inputs: Record<string, InputPort | undefined>;
  literals?: Record<string, number>;
  stringLiterals?: Record<string, string>;
  autoLiterals?: boolean;
};

type Props = {
  node: InlineNode;
  emit: Emit;
  keys?: string[];
  labelFor?: (key: string, index: number) => string;
  titleFor?: (key: string) => string | undefined;
  /** Socket and label only: the value comes from a cable or an editor elsewhere on the card. */
  cableOnlyKeys?: ReadonlySet<string>;
  mathLabelKeys?: ReadonlySet<string>;
  /** Rendered as a native `<datalist>`, so typing offers matches but any value still commits. */
  suggest?: Record<string, readonly string[]>;
};

function MathLabel({ text }: { text: string }) {
  const render = useKatexRender();
  const html = useMemo(() => {
    if (!render) return null;
    try {
      return render(text, { throwOnError: false, displayMode: false });
    } catch {
      return null;
    }
  }, [text, render]);
  return html == null
    ? <span className="solenoid-node__io-label">{text}</span>
    : <span className="solenoid-node__io-label" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function InlineInputs({ node, emit, keys, labelFor, titleFor, cableOnlyKeys, mathLabelKeys, suggest }: Props) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});
  const suggestId = suggest ? `sol-suggest-${node.id}` : undefined;
  const suggestOptions = suggest ? Array.from(new Set(Object.values(suggest).flat())) : [];

  const entries: [string, InputPort][] = (keys ?? Object.keys(node.inputs))
    .map((k) => [k, node.inputs[k]] as [string, InputPort | undefined])
    .filter((e): e is [string, InputPort] => !!e[1]);

  const strLiterals = (node.stringLiterals ??= {});
  const pickerKeys = new Map(columnPickersOf(node).map((p) => [p.key, p.frameInput]));

  // A literal edit can move a derived socket type with no connection event ([[D16]] retypeReconciles).
  function settleTypes() {
    const ed = getOwningEditor(node.id);
    const ar = getOwningView(node.id);
    if (ed && ar) reconcileTypesAfterEdit(ed, ar);
  }

  async function set(key: string, v: number | undefined) {
    if (v === undefined) delete literals[key];
    else literals[key] = v;
    settleTypes();
    await processGraph(node.id);
  }

  async function setStr(key: string, v: string) {
    strLiterals[key] = v;
    settleTypes();
    await processGraph(node.id);
  }

  async function setAuto(key: string, v: AutoLiteral) {
    // Exactly one map holds a wildcard slot, so the reader never has to break a tie.
    delete literals[key];
    delete strLiterals[key];
    if (typeof v === "number") literals[key] = v;
    else if (typeof v === "string") strLiterals[key] = v;
    settleTypes();
    await processGraph(node.id);
  }

  if (collapsed) {
    if (entries.length >= 2) {
      return <CollapsedInputPill node={node} emit={emit} keys={entries.map(([k]) => k)} />;
    }
    return (
      <>
        {entries.map(([key, input]) => (
          <NodeSocket
            key={key}
            side="input"
            socketKey={key}
            nodeId={node.id}
            emit={emit}
            payload={input.socket}
          />
        ))}
      </>
    );
  }

  return (
    <>
      {entries.map(([key, input], i) => {
        const socket = input.socket;
        const dt = socket instanceof SolenoidSocket ? socket.dataType : undefined;
        const numlistCsv = dt === "numlist" && key in strLiterals;
        // A combo edits in place; it becomes a list only when a cable brings one.
        const isNumber = dt === "number" || (dt === "numlist" && !numlistCsv);
        const isStr    = dt === "string" || dt === "strcombo";
        const isCsvList = dt === "strlist" || dt === "datelist" || dt === "logicallist" || numlistCsv;
        const { label, placeholder } = splitDefaultLabel(labelFor ? labelFor(key, i) : (input.label || key));
        const isConn = connected.has(key);
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={socket}>
            {mathLabelKeys?.has(key)
              ? <MathLabel text={label} />
              : <span className="solenoid-node__io-label" title={titleFor?.(key)}>{label}</span>}
            {isConn ? (
              <span
                className="solenoid-node__io-wired"
                title="Driven by the incoming cable named here"
              >↩ {incoming.get(key)?.label || "wired"}</span>
            ) : cableOnlyKeys?.has(key) ? null
              : takesAutoLiteral(node, dt) ? (
              <InlineAutoField num={literals[key]} text={strLiterals[key]} onChange={(v) => void setAuto(key, v)} placeholder={placeholder} />
            ) : isNumber ? (
              <InlineNumberField value={literals[key]} onChange={(v) => set(key, v)} placeholder={placeholder} />
            ) : isStr ? (
              pickerKeys.has(key) ? (
                <ColumnPickerField nodeId={node.id} frameInput={pickerKeys.get(key)!} value={strLiterals[key]} onChange={(v) => setStr(key, v)} placeholder={placeholder} />
              ) : (
                <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} placeholder={placeholder} listId={suggest && key in suggest ? suggestId : undefined} />
              )
            ) : isCsvList ? (
              <InlineCsvField value={strLiterals[key]} onChange={(v) => setStr(key, v)} listId={suggest && key in suggest ? suggestId : undefined} />
            ) : null}
          </MeasuredSocketRow>
        );
      })}
      {suggestId && (
        <datalist id={suggestId}>
          {suggestOptions.map((o) => <option key={o} value={o} />)}
        </datalist>
      )}
    </>
  );
}

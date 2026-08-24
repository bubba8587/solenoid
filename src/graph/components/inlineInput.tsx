import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { useKatexRender } from "./katexLoader";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { SolenoidSocket } from "../sockets";
import { connectionVersionStore, processGraph, pushHistory } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { nodeName } from "../catalogUtils";
import { collapseStore } from "../collapseStore";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { CollapsedInputPill } from "./CollapsedInputPill";
import { stopDragStart } from "../coarse";

// Sizes nodes whose body grows by row count; socket PLACEMENT never uses it — each
// dot centers on its own row via CSS, immune to header height.
export const INPUT_ROW_PITCH = 28;

/** Input-socket keys with an incoming cable, derived at render time (never cached in
 *  state) so any re-render picks up current graph state with no stale snapshot. */
export function useConnectedInputs(nodeId: string): Set<string> {
  // getOwningEditor, not getEditor: a node inside a drill-in must read its own graph's
  // connections, or its wired rows render as unwired.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const conns = getOwningEditor(nodeId)?.getConnections() ?? [];
  const set = new Set<string>();
  for (const c of conns) {
    if (c.target === nodeId && typeof c.targetInput === "string") set.add(c.targetInput);
  }
  return set;
}

export type IncomingSource = { sourceId: string; sourceOutput: string; label: string };

/** Who drives each input, not just THAT it's driven; derived at render time because
 *  the source label changes on rename, not only on connection changes. */
export function useIncomingSources(nodeId: string): Map<string, IncomingSource> {
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const editor = getOwningEditor(nodeId); // own graph inside a drill-in (see above)
  const map = new Map<string, IncomingSource>();
  for (const c of editor?.getConnections() ?? []) {
    if (c.target !== nodeId || typeof c.targetInput !== "string") continue;
    const src = editor?.getNode(c.source);
    // An unlabeled source falls back to its catalog name, as its header placeholder does.
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

/** Commit-on-Enter/clickaway editing: typing NEVER propagates into the graph, and one
 *  undo entry per commit. `apply` owns the mirror + processGraph — never onChange. */
export function useDraftCommit<T>(
  committed: T,
  toText: (v: T) => string,
  parse: (text: string) => T | typeof INVALID_DRAFT,
  apply: (v: T) => void,
) {
  const [draft, setDraft] = useState(() => toText(committed));
  const canceled = useRef(false);
  // Resync when the committed value changes underneath us (undo, external edit).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(toText(committed)); }, [committed]);
  const onBlur = () => {
    if (canceled.current) { canceled.current = false; setDraft(toText(committed)); return; }
    const next = parse(draft);
    if (next === INVALID_DRAFT || Object.is(next, committed)) {
      setDraft(toText(committed)); // revert / normalize ("5." → "5")
      return;
    }
    apply(next);
    pushHistory(() => apply(committed), () => apply(next));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
    else if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
  };
  return { draft, setDraft, onBlur, onKeyDown };
}

const numToText = (v: number | undefined) => (v == null ? "" : String(v));
const parseNum = (t: string): number | undefined | typeof INVALID_DRAFT => {
  if (t.trim() === "") return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : INVALID_DRAFT;
};

// A gesture becomes a drag only past this threshold; under it pointerup is a no-op so
// a plain click still focuses and places a caret.
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
  // The Escape listener is window-level because a drag blurs the input, so it needs its
  // own ref to unbind when a drag is interrupted.
  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  useEffect(() => () => {
    if (escRef.current) window.removeEventListener("keydown", escRef.current);
    // On an unmount MID-DRAG endDrag never runs; gated on THIS field owning the drag so
    // an unrelated unmount can't strip the cursor class from an active scrub.
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
    if (!d || !d.dragging) return; // was a plain click — nothing to revert or commit
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
    const dy = d.startY - e.clientY; // up = increase
    if (!d.dragging) {
      if (Math.hypot(dx, dy) < SCRUB_MOVE_THRESHOLD) return;
      d.dragging = true;
      (document.activeElement as HTMLElement | null)?.blur();
      document.body.classList.add("solenoid-scrubbing");
    }
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    // Steps are counted first, THEN scaled — rounding the product would make Alt-fine a
    // slower integer scrub instead of a 0.1 one; fine steps snap to the 0.1 grid.
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
  /** Shown (muted) when the field is empty. */
  placeholder?: string;
}) {
  const field = useDraftCommit(value, numToText, parseNum, onChange);
  const scrub = useNumberScrub(
    value,
    (v) => field.setDraft(numToText(v)),
    (next) => {
      onChange(next);
      pushHistory(() => onChange(value), () => onChange(next));
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

/** A string-literal input framed by quote chrome — the `"` glyphs are decoration,
 *  never part of the value; display boxes drop them and use middots instead. */
export function QuotedTextInput(props: {
  value: string;
  onChange: (v: string) => void;
  variant?: "inline" | "value";
  autoFocus?: boolean;
  placeholder?: string;
  // When set, the field shows a resize grip.
  nodeId?: string;
}) {
  // The value variant is a MULTI-LINE textarea: a single-line <input> silently strips
  // newlines on paste, flattening a multi-line literal.
  return props.variant === "value"
    ? <QuotedValueTextarea value={props.value} onChange={props.onChange} autoFocus={props.autoFocus} />
    : <QuotedInlineInput value={props.value} onChange={props.onChange} autoFocus={props.autoFocus} placeholder={props.placeholder} />;
}

function QuotedInlineInput({ value, onChange, autoFocus, placeholder }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
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

// Max textarea height before it scrolls, so a big paste can't run the card off-screen.
const VALUE_TEXTAREA_MAX = 200;

function QuotedValueTextarea({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  const canceled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Resync when the committed value changes underneath (undo, external edit).
  useEffect(() => { setDraft(value); }, [value]);
  // Grow to content before paint, so there's no flicker.
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
    pushHistory(() => onChange(value), () => onChange(draft));
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") { canceled.current = true; e.currentTarget.blur(); }
  };
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--value solenoid-node__quoted--multiline">
      <span className="solenoid-node__quoted-field">
        <textarea
          ref={ref}
          className="solenoid-node__quoted-input solenoid-node__quoted-textarea"
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
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return <QuotedTextInput value={value ?? ""} onChange={onChange} placeholder={placeholder} />;
}

/** A wildcard slot's literal, kept in whichever of the two maps fits. `Number(t)` and
 *  not `parseFloat`, so "12abc" is TEXT rather than 12. */
export type AutoLiteral = number | string | undefined;
const autoToText = (v: AutoLiteral) => (v == null ? "" : String(v));
const parseAuto = (t: string): AutoLiteral => {
  const trimmed = t.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : t;
};

/** ONE field for a WILDCARD value slot, which can hold a number or text: a
 *  numeric-looking entry commits as a number and anything else as text, with the quote
 *  chrome showing which landed — a SWITCH case of `12` is not a case of `"12"`. */
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
  // Drag-to-scrub is kept for the NUMERIC state, so a wildcard slot holding a number
  // behaves like the number field it replaced.
  const scrub = useNumberScrub(
    num,
    (v) => field.setDraft(autoToText(v)),
    (next) => {
      onChange(next);
      pushHistory(() => onChange(num), () => onChange(next));
    },
  );
  // Kept `type="text"`: a number input refuses a non-numeric draft outright, which is
  // the whole point of this field.
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
  // The chrome only flips on COMMIT, when the field is already blurred, so the input
  // remounting here costs no focus.
  if (!quoted) return input;
  return (
    <span className="solenoid-node__quoted solenoid-node__quoted--inline">
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
      <span className="solenoid-node__quoted-field">{input}</span>
      <span className="solenoid-node__quote" aria-hidden="true">"</span>
    </span>
  );
}

/** Opted in by the VALUE SELECTORS, whose wildcard rows are value branches. A wildcard
 *  SINK or relay (Display, Cast, Report, Cube) leaves it off and stays wire-only. */
export interface AutoLiteralHost {
  autoLiterals?: boolean;
  stringLiterals?: Record<string, string>;
}

export function takesAutoLiteral(node: AutoLiteralHost, dt: string | undefined): boolean {
  return !!node.autoLiterals && (dt === "any" || dt === "trueany");
}

/** Split a `"Foo (default X)"` socket label into label + placeholder, so the default
 *  reads as a muted cue in the box rather than parenthetical prose. */
const DEFAULT_LABEL_RE = /^(.*?)\s*\(default\s+(.+?)\)\s*$/;
export function splitDefaultLabel(label: string): { label: string; placeholder?: string } {
  const m = DEFAULT_LABEL_RE.exec(label);
  if (!m) return { label };
  return { label: m[1], placeholder: m[2].replace(/^["']|["']$/g, "") };
}

/** Inline CSV editor for a 1-D LIST input — no quote chrome, which would signal a
 *  single string. coerceInputs parses the raw text per the socket's element type. */
export function InlineCsvField({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const field = useDraftCommit(value ?? "", (v) => v, (t) => t, onChange);
  return (
    <input
      type="text"
      className="solenoid-node__inline-input"
      value={field.draft}
      placeholder="a, b, c"
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
  /** See `takesAutoLiteral` — the value selectors set it. */
  autoLiterals?: boolean;
};

type Props = {
  node: InlineNode;
  emit: RenderEmit<ClassicScheme>;
  /** Restrict / reorder which input keys render. Defaults to all inputs. */
  keys?: string[];
  /** Override the row label for a key (e.g. Logical's per-op labels). */
  labelFor?: (key: string, index: number) => string;
  /** Optional hover tooltip per key (e.g. an Expression variable's description). */
  titleFor?: (key: string) => string | undefined;
  /** Input keys rendered socket+label only (no inline field) — the value comes
   *  from a cable, or an editor elsewhere in the node (e.g. a LAMBDA formula). */
  cableOnlyKeys?: ReadonlySet<string>;
  /** Input keys whose label is a math expression (e.g. a LAMBDA's `f(r,c)`),
   *  rendered with KaTeX so it reads as a proper function signature. */
  mathLabelKeys?: ReadonlySet<string>;
};

/** A row label rendered as math (KaTeX), falling back to plain text. */
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

/** Default renderer for a node's input rows; each dot centers on its own row, so rows
 *  can sit anywhere in the body with no fixed-offset assumption about the header. */
export function InlineInputs({ node, emit, keys, labelFor, titleFor, cableOnlyKeys, mathLabelKeys }: Props) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});

  const entries: [string, InputPort][] = (keys ?? Object.keys(node.inputs))
    .map((k) => [k, node.inputs[k]] as [string, InputPort | undefined])
    .filter((e): e is [string, InputPort] => !!e[1]);

  const strLiterals = (node.stringLiterals ??= {});

  // A literal can move a derived SOCKET type and no connection event fires on this
  // path, so the wildcard types must be re-settled after a literal edit.
  function settleTypes() {
    const ed = getOwningEditor(node.id);
    const ar = getOwningArea(node.id);
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

  // Collapsed: ≥2 inputs aggregate into one pill, or the dots spill past the small
  // node; a lone input centers on the display box, matching the output.
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
        // A numeric list keeps its single-number field unless the node OPTS IN by declaring
        // a stringLiterals key for it — then it types as a CSV list (Surface's Xs / Ys).
        const numlistCsv = dt === "numlist" && key in strLiterals;
        // A combo only becomes a list when a cable brings one in, so both edit in place.
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
              <InlineTextField value={strLiterals[key]} onChange={(v) => setStr(key, v)} placeholder={placeholder} />
            ) : isCsvList ? (
              <InlineCsvField value={strLiterals[key]} onChange={(v) => setStr(key, v)} />
            ) : null}
          </MeasuredSocketRow>
        );
      })}
    </>
  );
}

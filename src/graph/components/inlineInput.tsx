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

// Vertical pitch between input rows. Socket *placement* no longer uses a fixed
// top offset — each input dot centers on its own row via CSS (.solenoid-node__io-row
// sets --out-socket-top: 50%), so it's immune to header height. PITCH is still
// used to size nodes whose body grows by row count (e.g. Expression).
export const INPUT_ROW_PITCH = 28;

/**
 * Set of input-socket keys on `nodeId` that currently have an incoming
 * cable. Derived fresh on every render (cheap: one pass over connections);
 * the version subscription only forces a render the instant a cable lands
 * or leaves. Deriving at render time (not caching in state) means anything
 * else that re-renders the node — e.g. processGraph after a source-node
 * rename — also picks up current graph state, with no stale snapshot.
 */
export function useConnectedInputs(nodeId: string): Set<string> {
  // getOwningEditor, not getEditor: a node INSIDE a composite drill-in must read
  // its own graph's connections, or its wired rows render as unwired there.
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const conns = getOwningEditor(nodeId)?.getConnections() ?? [];
  const set = new Set<string>();
  for (const c of conns) {
    if (c.target === nodeId && typeof c.targetInput === "string") set.add(c.targetInput);
  }
  return set;
}

export type IncomingSource = { sourceId: string; sourceOutput: string; label: string };

/**
 * Per-input-key info about the cable feeding it — who drives this input, not
 * just THAT it's driven. The wired marker and the formula-override rows render
 * the source node's label from this so the connection is legible in place.
 * Derived at render time for the same reason as useConnectedInputs: the label
 * lives on the source node and changes on rename (which re-renders every node
 * via processGraph), not only on connection changes.
 */
export function useIncomingSources(nodeId: string): Map<string, IncomingSource> {
  useSyncExternalStore(connectionVersionStore.subscribe, connectionVersionStore.get);
  const editor = getOwningEditor(nodeId); // own graph inside a drill-in (see above)
  const map = new Map<string, IncomingSource>();
  for (const c of editor?.getConnections() ?? []) {
    if (c.target !== nodeId || typeof c.targetInput !== "string") continue;
    const src = editor?.getNode(c.source);
    // An unlabeled source shows its catalog name as its header PLACEHOLDER, so the
    // wire marker mirrors that (e.g. "↩ Expression") instead of a bare "wired".
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

/**
 * Commit-on-Enter/clickaway editing for a typed field — the project-wide rule:
 * typing NEVER propagates into the graph; the draft lives locally until Enter
 * or blur commits it (Escape reverts), like Excel's cell editing. One undo
 * entry per committed change. Wire the returned props onto the input and call
 * `apply` with the mirror-to-node + processGraph logic; don't call processGraph
 * from onChange.
 */
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

// Scrubbing: drag the field to move the value, without derailing a plain click
// (which must still focus + place a caret for typing). A gesture only becomes a
// "drag" once the pointer clears this threshold; under it, pointerup is a no-op
// and the native click/focus proceeds untouched.
const SCRUB_MOVE_THRESHOLD = 4; // px
const SCRUB_PX_PER_STEP = 6; // px of drag per unit step, at the unmodified rate

type ScrubState = { startX: number; startY: number; startValue: number; currentValue: number; dragging: boolean };

/** Pointer handlers for drag-to-scrub on a number field. Shared by the per-row
 *  inline literals AND the Number Input's main field (which shipped without
 *  scrub handlers at all — the "scrubber is bugged" report). `showValue` is the
 *  live draft preview (also called to revert on cancel); `commitValue` applies
 *  the final value and owns its undo entry. */
export function useNumberScrub(
  committed: number | undefined,
  showValue: (v: number | undefined) => void,
  commitValue: (next: number) => void,
) {
  const dragRef = useRef<ScrubState | null>(null);
  // The Escape listener is added imperatively (keydown during a drag isn't
  // guaranteed to land on the input — it's blurred the moment a drag engages),
  // so it needs its own ref to unbind on unmount if a drag is interrupted by
  // e.g. the node being deleted mid-scrub.
  const escRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  useEffect(() => () => {
    if (escRef.current) window.removeEventListener("keydown", escRef.current);
    // Unmount MID-DRAG (node deleted while scrubbing — dragging blurs focus, so
    // Delete reaches the canvas; also Undo/doc-switch): endDrag never runs, so
    // clear the drag state and the app-wide ns-resize cursor class here too.
    // Gated on THIS field owning a live drag, so an unrelated field unmounting
    // can't strip the class out from under another field's active scrub.
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
      // Mirrors useDraftCommit's onBlur commit sequence (apply → one undo entry),
      // just triggered by pointerup instead of blur/Enter.
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
    // Shift = coarse (10x), Alt = fine (0.1x), unmodified = 1 unit per
    // SCRUB_PX_PER_STEP px. Steps are counted first, THEN scaled: the old
    // Math.round(steps × mult) rounded the whole product to an integer, so
    // Alt-fine could never actually produce a 0.1 — it just made a slower
    // integer scrub. Fine steps snap to the 0.1 grid to avoid float dust.
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
  /** Shown (muted) when the field is empty. IFS/SWITCH pass "N/A" on their
   *  fallback box, so an unset Otherwise/Default reads as "no match → #N/A". */
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

/**
 * A string-literal input framed by static quote chrome. The `"` glyphs frame
 * the editable field (they are decoration, never part of the value), and the
 * input auto-sizes to its content so a lone or trailing space shows as the gap
 * before the closing quote — the Excel `" "` look, in the one place Excel uses
 * quotes (authoring a literal). Result/display boxes drop quotes entirely and
 * mark whitespace with middots instead (see ValueDisplay).
 */
export function QuotedTextInput(props: {
  value: string;
  onChange: (v: string) => void;
  variant?: "inline" | "value";
  autoFocus?: boolean;
  placeholder?: string;
  // When set, the field shows a resize grip (the main input on a node — not the
  // per-row inline literals, which don't pass this).
  nodeId?: string;
}) {
  // The main text field (value variant) is a MULTI-LINE textarea: a single-line
  // <input> silently strips newlines on paste, so a multi-line literal (a Mermaid
  // diagram, an address block, wrapped prose) collapsed to one line — and it grew
  // horizontally off the card instead of scaling. The per-row inline literals stay
  // single-line (they fill a fixed 22px row).
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

// Max textarea height before it scrolls — a big paste doesn't run the card off
// the bottom of the screen.
const VALUE_TEXTAREA_MAX = 200;

function QuotedValueTextarea({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(value);
  const canceled = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Resync when the committed value changes underneath (undo, external edit).
  useEffect(() => { setDraft(value); }, [value]);
  // Grow to content, capped then scroll (before paint, so no flicker).
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
  // Enter inserts a newline (this is multi-line); Escape reverts + blurs.
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

/** A `"Foo (default X)"` socket label documents its default. Split it into the
 *  bare label + `X` (surrounding quotes stripped) so the row renders "Foo" and the
 *  empty field shows `X` as a MUTED PLACEHOLDER — the default reads as a cue in the
 *  box, not parenthetical prose (the no-Captain-Obvious rule). Non-matching labels
 *  pass through unchanged (no placeholder). */
const DEFAULT_LABEL_RE = /^(.*?)\s*\(default\s+(.+?)\)\s*$/;
export function splitDefaultLabel(label: string): { label: string; placeholder?: string } {
  const m = DEFAULT_LABEL_RE.exec(label);
  if (!m) return { label };
  return { label: m[1], placeholder: m[2].replace(/^["']|["']$/g, "") };
}

/**
 * Inline editor for a 1-D LIST input: a plain comma-separated field ("a, b, c").
 * A 1-D list is just CSV, so a list socket is typeable in place exactly like a
 * scalar — no quote chrome (that signals a single string). The raw text lives in
 * the node's `stringLiterals[key]`; the engine boundary (coerceInputs) parses it
 * per the socket's element type (strings / date serials / TRUE-FALSE) and injects
 * it as the list when the input is unwired. A cable still overrides it.
 */
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

/** A row label rendered as math (KaTeX) — falls back to plain text on error or
 *  while katex is still loading. */
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

/**
 * Default renderer for a node's input rows. For every input it draws a
 * row containing the input's socket (on the card's left edge) plus a
 * label, and — when the socket is a number type with no incoming cable
 * — an editable literal field bound to `node.literals[key]`. A wired
 * input shows a muted marker instead; non-number inputs (e.g. list)
 * show just the socket + label.
 *
 * Each input dot centers on its own row (see .solenoid-node__io-row), so rows
 * can sit anywhere in the body — no fixed-offset assumption about the header.
 */
export function InlineInputs({ node, emit, keys, labelFor, titleFor, cableOnlyKeys, mathLabelKeys }: Props) {
  const connected = useConnectedInputs(node.id);
  const incoming = useIncomingSources(node.id);
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(node.id));
  const literals = (node.literals ??= {});

  const entries: [string, InputPort][] = (keys ?? Object.keys(node.inputs))
    .map((k) => [k, node.inputs[k]] as [string, InputPort | undefined])
    .filter((e): e is [string, InputPort] => !!e[1]);

  const strLiterals = (node.stringLiterals ??= {});

  // Editing one node's literal is a pure value change (no topology) → targeted
  // recompute: only this node + its downstream cone recompute and re-render. A literal
  // can still move a derived SOCKET type (INDEX's Column, and every frame verb's config
  // that feeds the static shape it reads), and no connection event fires on this path —
  // so re-settle the wildcard types too. No-op unless a type actually moved.
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

  // Collapsed: ≥2 inputs aggregate into a single pill (avoids dots
  // spilling past the small node); a lone input centers on the display
  // box (no explicit top → --out-socket-top), matching the output.
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
        // Scalar or the family's scalar-or-list COMBO — both edit as one value in
        // place (the combo only becomes a list when a cable brings one in).
        const isNumber = dt === "number" || dt === "numlist";
        const isStr    = dt === "string" || dt === "strcombo";
        // A 1-D non-numeric list is typeable as CSV in place (parsed at the engine
        // boundary). Numeric lists keep their single-number field for now.
        const isCsvList = dt === "strlist" || dt === "datelist" || dt === "logicallist";
        // Split a "(default X)" convention label → bare label + muted placeholder.
        const { label, placeholder } = splitDefaultLabel(labelFor ? labelFor(key, i) : (input.label || key));
        const isConn = connected.has(key);
        return (
          <MeasuredSocketRow key={key} side="input" socketKey={key} nodeId={node.id} emit={emit} payload={socket}>
            {mathLabelKeys?.has(key)
              ? <MathLabel text={label} />
              : <span className="solenoid-node__io-label" title={titleFor?.(key)}>{label}</span>}
            {isConn ? (
              // Name the driver, not just the fact: "↩ Rate" beats "↩ wired".
              // The tooltip stays structural — dynamic data lives in the text.
              <span
                className="solenoid-node__io-wired"
                title="Driven by the incoming cable named here"
              >↩ {incoming.get(key)?.label || "wired"}</span>
            ) : cableOnlyKeys?.has(key) ? null
              : isNumber ? (
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

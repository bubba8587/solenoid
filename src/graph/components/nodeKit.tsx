import { useCallback, useState, useRef, type ReactNode, useLayoutEffect, useContext, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { copyText } from "../clipboard";
import { commentStore, commentsPanelUi } from "../commentStore";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { processGraph } from "../process";
import { getOwningEditor } from "../activeGraph";
import { sharedAnnotationResolver } from "../unitFlow";
import { NodeCard } from "./NodeCard";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { useDraftCommit } from "./inlineInput";
import { describeNode, nodeName } from "../catalogUtils";
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { ResizeHandle } from "./ResizeHandle";
import { nodeResizable } from "../rete-nodes";
import { formatScalar } from "./format";
import { ArrayChip } from "./ArrayChip";
import { formatAnnotationStore, formatNumberWithAnnotation, applyTextCase, applyLogicalStyle, annotationRendersNegativeRed } from "../formatAnnotationStore";
import { nodeOutputIsDate, dateFormatDisplay, shouldRenderListInline, formatListCell, type DisplayValue } from "./valueDisplayFormat";
import { IS_COARSE } from "../coarse";
import { NodeFormatContext } from "./nodeContext";
import { describeValueKind } from "../valueKindLabel";
import "./nodeCard.css";

/**
 * Shared building blocks for standard node components. A typical node
 * goes from ~50 lines of socket-mapping / label-header / op-select /
 * value-display boilerplate down to ~12 lines:
 *
 *   export function FooComponent({ data, emit }: NodeProps<FooNode>) {
 *     const [op, setOp] = useNodeField(data, "op");
 *     return (
 *       <NodeShell node={data} emit={emit}>
 *         <InlineInputs node={data} emit={emit} />
 *         <OpSelect value={op} onChange={setOp} options={FOO_OPS} />
 *         <ValueDisplay value={data.cachedResult} />
 *       </NodeShell>
 *     );
 *   }
 */

/**
 * Render a string value with leading/trailing whitespace shown as middots and
 * an empty string as a dim placeholder, so spaces are never invisible. This is
 * display-only: the underlying value (and what gets copied) keeps its real
 * whitespace. Quotes are deliberately not used here — they belong to the
 * authoring context (input fields), not the result/display "cell" (Excel's
 * split: `=A1&" "` has quotes, the resulting cell does not).
 */
function renderTextValue(s: string): ReactNode {
  if (s === "") return <span className="solenoid-node__text-empty">(empty)</span>;
  const lead = /^\s+/.exec(s)?.[0] ?? "";
  const trail = s.length > lead.length ? (/\s+$/.exec(s)?.[0] ?? "") : "";
  const core = s.slice(lead.length, s.length - trail.length);
  return (
    <>
      {lead && <span className="solenoid-node__text-ws">{"·".repeat(lead.length)}</span>}
      {core}
      {trail && <span className="solenoid-node__text-ws">{"·".repeat(trail.length)}</span>}
    </>
  );
}

/**
 * Sanitized markdown → HTML for a text FC's "Markdown" advanced option. FULL
 * (block) parse so headers / lists / blockquotes render — `# heading` becomes a
 * real <h1>, which is the point (inline-only parse left `#` literal). The string
 * is untrusted (arrives in shared .solenoid files), so sanitize before injecting.
 */
export function renderTextMarkdownHtml(s: string): string {
  return DOMPurify.sanitize(marked.parse(s, { async: false, gfm: true, breaks: true }) as string);
}

type Port = { socket: ClassicPreset.Socket; label?: string };

/** Minimal structural shape NodeShell needs from a live node instance. */
export type ShellNode = {
  id: string;
  label: string;
  selected?: boolean;
  width: number;
  height: number;
  inputs: Record<string, Port | undefined>;
  outputs: Record<string, Port | undefined>;
};

/** Standard props every node component receives from the Rete preset. */
export type NodeProps<N> = {
  data: N & { width?: number; height?: number };
  emit: RenderEmit<ClassicScheme>;
};

export type Emit = RenderEmit<ClassicScheme>;

/**
 * Controlled local state mirrored onto `node[key]`, recomputing the graph
 * on every change. The local `useState` is the source of truth React
 * tracks for controlled inputs/selects (see CLAUDE.md — driving a
 * controlled `<select>` off a forceUpdate doesn't reliably re-apply the
 * value prop); `node[key]` is mirrored so the engine reads the latest.
 */
export function useNodeField<N extends object, K extends keyof N>(
  node: N,
  key: K,
): [N[K], (next: N[K]) => void] {
  const [val, setVal] = useState<N[K]>(node[key]);
  const onChange = useCallback(
    (next: N[K]) => {
      node[key] = next;
      setVal(next);
      void processGraph();
    },
    [node, key],
  );
  return [val, onChange];
}

/** Map a node's inputs or outputs to absolutely-positioned socket dots. */
export function PortSockets({
  node,
  emit,
  side,
}: {
  node: ShellNode;
  emit: Emit;
  side: "input" | "output";
}) {
  const ports = Object.entries(side === "input" ? node.inputs : node.outputs);
  return (
    <>
      {ports.map(([key, port]) =>
        port ? (
          <NodeSocket key={key} side={side} socketKey={key} nodeId={node.id} emit={emit} payload={port.socket} />
        ) : null,
      )}
    </>
  );
}

/**
 * The card chrome shared by every standard node: output sockets, an
 * editable label header, and a body wrapper. Body content (InlineInputs,
 * any op-select / controls, a ValueDisplay) goes in `children`.
 *
 * `leading` renders before the output sockets — used by pass-through
 * nodes (e.g. Display) that draw bare input sockets at the top instead
 * of routing them through InlineInputs.
 */
// ─── Multi-output rows ────────────────────────────────────────────────────────

// A row's value: scalar (number / logical), a list of them (rendered as a short
// preview), an error, or blank. Lists/logicals arrived with the Equation node's
// per-variable outputs; plain numeric rows are unaffected.
export type OutputRowValue = number | boolean | (number | boolean | SolError | null)[] | SolError | null;

export type OutputRowDef = {
  key: string;
  label: string;
  value: OutputRowValue;
};

function formatRowCell(v: number | boolean | SolError | null): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isSolError(v)) return v.code;
  return formatScalar(v);
}

function formatRowValue(v: Exclude<OutputRowValue, SolError>): string {
  if (Array.isArray(v)) {
    const head = v.slice(0, 3).map(formatRowCell).join(", ");
    return v.length > 3 ? `${head}, …` : head || "—";
  }
  return formatRowCell(v);
}

/**
 * Renders a labelled row for each output with the socket dot measured-centered
 * on the row (see MeasuredSocketRow) — immune to label height, padding, and
 * header height.
 */
function MeasuredOutputRow({
  rowKey, label, value, node, emit,
}: {
  rowKey: string;
  label: string;
  value: OutputRowValue;
  node: ShellNode;
  emit: Emit;
}) {
  const port = node.outputs[rowKey];
  if (!port) return null;
  // A SolError reaching an output row renders as its red #CODE! badge (not
  // formatScalar, which would print "[object Object]").
  return (
    <MeasuredSocketRow side="output" socketKey={rowKey} nodeId={node.id} emit={emit} payload={port.socket}>
      <span className="solenoid-node__io-label">{label}</span>
      {isSolError(value) ? (
        <span
          className={`solenoid-node__output-value solenoid-node__display-value--error${value.origin ? " sol-error-chip--clickable" : ""}`}
          title={errorTip(value)}
          onClick={value.origin ? () => flyToNode(value.origin!.nodeId) : undefined}
          onPointerDown={value.origin ? (e) => e.stopPropagation() : undefined}
          onMouseDown={value.origin ? (e) => e.stopPropagation() : undefined}
        >{value.code}</span>
      ) : (
        <span className="solenoid-node__output-value">
          {formatRowValue(value)}
        </span>
      )}
    </MeasuredSocketRow>
  );
}

export function InlineOutputRows({
  node,
  emit,
  rows,
}: {
  node: ShellNode;
  emit: Emit;
  rows: OutputRowDef[];
}) {
  return (
    <>
      {rows.map((r) => (
        <MeasuredOutputRow
          key={r.key}
          rowKey={r.key}
          label={r.label}
          value={r.value}
          node={node}
          emit={emit}
        />
      ))}
    </>
  );
}

// Max height for the label textarea: 4 lines (4 × 13px line) + 6px symmetric
// padding = 58, with a couple px buffer. Must match the display div's 4-line
// clamp (.solenoid-node__label-display) so editing and static title agree.
const LABEL_MAX_HEIGHT = 60;

/** Derive a short type label from the node's class name for the hover hint. */
function typeHint(node: ShellNode): string {
  return (node as unknown as { constructor: { name: string } }).constructor.name
    .replace(/Node$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toUpperCase();
}

// Lucide "message-square" — matches NodeContextMenu's Add-comment icon.
const CommentDot = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

/** The small corner indicator every node gets automatically when it has a
 *  comment thread (#14) — reuses the ErrorChip-style pill treatment (a quiet
 *  round badge) and points back to the Comments panel on click. Mounted
 *  unconditionally by NodeShell (so every node type gets it for free, no
 *  per-component wiring) but renders nothing for the common case (no thread). */
function CommentIndicator({ nodeId }: { nodeId: string }) {
  const hasThread = useSyncExternalStore(commentStore.subscribe, () => commentStore.hasAny(nodeId));
  if (!hasThread) return null;
  const unresolved = commentStore.hasUnresolved(nodeId);
  return (
    <button
      type="button"
      className={`solenoid-node__comment-badge${unresolved ? "" : " solenoid-node__comment-badge--resolved"}`}
      title={`${commentStore.forNode(nodeId).length} comment${commentStore.forNode(nodeId).length === 1 ? "" : "s"}. Click to open.`}
      onClick={(e) => { e.stopPropagation(); commentsPanelUi.openFor(nodeId); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <CommentDot />
    </button>
  );
}

export function NodeShell({
  node,
  emit,
  children,
  leading,
  cornerBadge,
  labelPlaceholder,
  hideOutputSockets = false,
  collapsible = true,
  squareCollapse = false,
  className,
}: {
  node: ShellNode;
  emit: Emit;
  children: ReactNode;
  leading?: ReactNode;
  /** A small mark pinned to the card's top-right corner (e.g. a lock on a
   *  pack-preset node). Sits over the body, clear of the header label. */
  cornerBadge?: ReactNode;
  labelPlaceholder?: string;
  hideOutputSockets?: boolean;
  /** Forwarded to NodeCard — false hides the collapse chevron (see NodeCard). */
  collapsible?: boolean;
  /** Forwarded to NodeCard — collapse to a headerless square (Sparkline). */
  squareCollapse?: boolean;
  /** Extra class on the card (e.g. a node-specific width override). */
  className?: string;
}) {
  // Title edits commit on Enter/clickaway (Escape reverts), NOT per keystroke —
  // a committed rename propagates (processGraph re-renders consumers' wired
  // markers), and that ripple must not run mid-typing.
  const labelField = useDraftCommit<string>(
    node.label ?? "",
    (v) => v,
    (t) => t,
    (v) => { node.label = v; void processGraph(); },
  );
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  // Every node gets a header placeholder: an explicit prop wins, else the node's
  // catalog name. So a cleared title still reads as the node's name AND the header
  // never collapses to a zero-height sliver (was a bug with blank labels).
  const effectivePlaceholder = labelPlaceholder ?? nodeName(node) ?? undefined;

  // Auto-size the textarea to content, capped at 4 lines (edit mode only).
  // useLayoutEffect (not useEffect): the height must settle BEFORE paint, in the
  // same frame NodeCard measures the output socket (--out-socket-top tracks the
  // result box, which the header height pushes down). A passive effect resized the
  // textarea AFTER the socket was measured and painted, so the socket visibly
  // slid a frame late on every keystroke that changed the header height.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LABEL_MAX_HEIGHT)}px`;
  }, [labelField.draft, editing]);

  // A corner badge sits just below the header, but the header's height changes
  // with the title (it clamps to 2 lines). The badge can't anchor to the body (it
  // can't be a positioning context — see NodeSocket), so publish the measured
  // header height as a CSS var on the card and let the badge offset by it.
  // Measured only when a badge is present, so plain nodes pay nothing.
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!cornerBadge || !header) return;
    const card = header.parentElement;
    if (!card) return;
    const apply = () => card.style.setProperty("--header-h", `${header.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(header);
    return () => ro.disconnect();
  }, [cornerBadge, labelField.draft, editing]);

  return (
    <NodeFormatContext.Provider value={node.id}>
      <NodeCard selected={node.selected} node={node} collapsible={collapsible} squareCollapse={squareCollapse} className={className}>
        {/* Header hover = the node's catalog one-liner (incl. Excel equivalent)
            — the self-documentation rule. The label display's own title (the
            untruncated label) wins inside its bounds. */}
        <div className="solenoid-node__header" ref={headerRef} title={describeNode(node) ?? undefined}>
          {editing ? (
            // A textarea can't ellipsize, so it's only mounted while editing;
            // otherwise a clamped (2-line, ellipsis) display element stands in.
            <textarea
              ref={taRef}
              className="solenoid-node__label-input"
              value={labelField.draft}
              placeholder={effectivePlaceholder}
              rows={1}
              autoFocus
              onBlur={() => { setEditing(false); labelField.onBlur(); }}
              onKeyDown={labelField.onKeyDown}
              onChange={(e) => labelField.setDraft(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              spellCheck={false}
            />
          ) : (
            <div
              className="solenoid-node__label-display"
              title={node.label}
              onClick={() => setEditing(true)}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {node.label || effectivePlaceholder || ""}
            </div>
          )}
          <span className="solenoid-node__type-hint" aria-hidden="true">
            {typeHint(node)}
          </span>
        </div>
        {cornerBadge && (
          <div className="solenoid-node__corner-badge">{cornerBadge}</div>
        )}
        <CommentIndicator nodeId={node.id} />
        {/* Everything BELOW the header lives in this wrapper, which is the socket
            positioning context (position: relative). Sockets + the value box it
            aligns them to are both inside it, so every socket `top` is measured
            relative to the body — independent of the header's height. When the
            header grows (e.g. a 2-line title), the wrapper slides down and the
            browser carries the sockets with it; nothing re-measures, and rete adds
            the wrapper's offset back for cable endpoints. See the socket invariant
            in CLAUDE.md / subsystem-invariants. */}
        <div className="solenoid-node__content">
          {leading}
          {!hideOutputSockets && <PortSockets node={node} emit={emit} side="output" />}
          <div className="solenoid-node__body">{children}</div>
          {/* One universal resizer per resizable node, at the body's bottom-right —
              not per value-box type. Drags the card width + the body height
              (--box-h); the body's content fills/scrolls. Hidden when collapsed. */}
          {nodeResizable(node as unknown as ClassicPreset.Node) && <ResizeHandle nodeId={node.id} />}
        </div>
        {/* Semantic-zoom simplified view: at far-overview zoom the body detail is
            hidden (nodeCard.css) and this draws the node's NAME large + centered so a
            card still reads as an identifiable block, not a blank rectangle. Only
            visible under html.solenoid-semantic-zoom; transparent so the socket dots
            still show; aria-hidden + pointer-events:none so it's purely decorative. */}
        <div className="solenoid-node__semantic" aria-hidden="true">
          <span>{node.label || effectivePlaceholder || ""}</span>
        </div>
      </NodeCard>
    </NodeFormatContext.Provider>
  );
}

/** A `<select>` that stops drag-starting pointer events (see CLAUDE.md). */
export type OpOption<T extends string> = { value: T; label: string; group?: string };

function opGrouped<T extends string>(options: ReadonlyArray<OpOption<T>>) {
  const order: string[] = [];
  const byGroup = new Map<string, Array<OpOption<T>>>();
  for (const o of options) {
    const g = o.group ?? "";
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g)!.push(o);
  }
  return order.flatMap((g) => {
    const items = byGroup.get(g)!.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ));
    return g === "" ? items : [<optgroup key={g} label={g}>{items}</optgroup>];
  });
}

export function OpSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<OpOption<T>>;
}) {
  const hasGroups = options.some((o) => o.group != null);
  return (
    <select
      className="solenoid-node__op-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasGroups
        ? opGrouped(options)
        : options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
      }
    </select>
  );
}

export function ClipboardIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 16 17" fill="currentColor" stroke="currentColor" strokeWidth="0.85" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
      <path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h1v1a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1v1H2z"/>
    </svg>
  );
}

/**
 * The result/display box. Handles the three universal states — null
 * (empty), a list (preview + smaller font), or a scalar (formatScalar) —
 * so components don't re-derive the className/style/format dance.
 *
 * `empty` overrides the placeholder (Match/XLookup show "not found").
 * `render` overrides scalar formatting (Comparison → true/false, Display → value + unit suffix).
 * `toClipboard` overrides what gets written to the clipboard (defaults to formatScalar / list join).
 */
export function ValueDisplay({
  value: rawValue,
  empty = "—",
  render,
  toClipboard,
  full,
}: {
  value: DisplayValue;
  empty?: ReactNode;
  render?: (v: number) => ReactNode;
  toClipboard?: (v: number) => string;
  /** Show a list in full (all values, joined) instead of a chip — the Display
   *  node, whose box scrolls/wraps when resized. */
  full?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // These two hooks must run UNCONDITIONALLY, BEFORE the object-kind early return
  // below — the value can flip between a scalar (falls through) and an object kind
  // like a frame (returns early), and a hook AFTER the early return changes the
  // per-render hook count → React error #300 ("rendered fewer hooks than expected"),
  // which crashes and unmounts the node (e.g. an Expect fed a frame: null on the
  // first render, then the frame). Used only in the non-object path, but declared here.
  const ctxNodeId = useContext(NodeFormatContext);
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  // Safety net: an object-valued kind (chart/frame/cube/diagram/image/lambda) can
  // slip in through an `any`/casted value. It must NOT reach the number/string
  // path below (→ "[object Object]" or a .toFixed crash). Surfaces that want the
  // RICH form (Display, Input Switch) branch on the kind before calling this; here
  // we show a compact label so nothing ever reads as "[object Object]".
  const kindLabel = describeValueKind(rawValue);
  if (kindLabel != null) {
    return <div className="solenoid-node__display-value">{kindLabel}</div>;
  }

  // Local-display formatting: if a Format Controller is docked to this node,
  // render the value through its annotation. Only kicks in when the component
  // doesn't already supply its own `render` (custom displays keep theirs).
  let ann = ctxNodeId ? formatAnnotationStore.getForNode(ctxNodeId) : undefined;
  // With no DIRECT annotation, a node that merely PASSES the value along (Display)
  // or SELECTS it (IF/CHOOSE/SWITCH/IFS) carries the locked format/unit on its
  // output — so its own value box shows it, exactly like a downstream Display.
  // Guarded to those nodes so sources/transforms (which carry nothing) stay raw and
  // never pay the graph walk; the resolver returns undefined for them anyway.
  if (!ann && ctxNodeId) {
    // Owning editor, not main: a node rendered inside a Composite drill-in lives in
    // the internal editor, so resolve its docked/carried FC there (see getOwningEditor).
    const editor = getOwningEditor(ctxNodeId);
    const node = editor?.getNode(ctxNodeId) as
      (Record<string, unknown> & { outputs?: Record<string, unknown> }) | undefined;
    const carries = !!node && (node.passesUnitThrough === true || typeof node.unitPassInputs === "function");
    if (editor && node && carries) {
      const resolver = sharedAnnotationResolver(editor);
      for (const k of Object.keys(node.outputs ?? {})) {
        const a = resolver.outAnnotation(ctxNodeId, k);
        if (a) { ann = a; break; }
      }
    }
  }

  // Date serials → date strings when this node's OUTPUT socket is a date type,
  // so every date-producing node formats dates in its box (scalar AND list)
  // without an ad-hoc `render`. Deferred to the FC when one is docked (it owns
  // date patterns then). After this, a date value is a string / string[] and
  // flows through the normal text / chip rendering below.
  const value = dateFormatDisplay(rawValue, nodeOutputIsDate(ctxNodeId), !!ann);

  // An empty array (a 0-element list/matrix — e.g. a filter that matched nothing, or
  // Split Frame with no columns of the chosen type) is "nothing to show", same as no
  // input: render the faded "—" placeholder at standard height instead of an empty
  // string, which has no line box and collapses the card below its min height.
  const isEmpty = value === null || (Array.isArray(value) && value.length === 0);
  const isString = typeof value === "string";
  const isLogical = typeof value === "boolean"; // renders TRUE/FALSE (Excel form)
  const isList = Array.isArray(value);
  // A list of text (strlist nodes) vs a list of numbers — both get a chip, but
  // their clipboard / annotated-fallback formatting differs.
  const listIsString = isList && typeof (value as unknown[])[0] === "string";

  // Joined-text vs. chip for a list (collapse-to-chip must win over a docked FC —
  // see shouldRenderListInline).
  const listInline = shouldRenderListInline(full, !!ann);

  const fmtScalar = (v: number): string =>
    ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v);

  // Text-socket display options (case + bold/italic/size) when the FC annotates
  // a string node. Non-destructive: the underlying value is unchanged.
  const textStyle: React.CSSProperties | undefined = ann && isString ? {
    fontWeight: ann.bold ? 700 : undefined,
    fontStyle: ann.italic ? "italic" : "normal",
    fontSize: ann.textScale ? `${ann.textScale}px` : undefined,
    // Monospace opt-in overrides the span's default sans face (advanced tier).
    // Only emit the key when ON — a `fontFamily: undefined` in the spread would
    // clobber the span's base `var(--font-sans)` and fall back to the container's
    // mono, forcing mono on every FC-annotated text value.
    ...(ann.textMono ? { fontFamily: "var(--font-mono)" } : {}),
  } : undefined;
  const cased = (s: string): string => (ann ? applyTextCase(s, ann.textCase) : s);

  // Error values render as a red Excel-style code badge with the structural
  // explanation in the tooltip. Errors propagate, so the chain of red boxes
  // leads back to the source — the Excel trace model. (After the hooks above:
  // the value can flip between error and not across renders.)
  if (isSolError(value)) {
    // Shared error treatment: red #CODE! badge, hover surfaces the producer
    // message + the general explanation/fix (errorTip) — same everywhere.
    return (
      <div
        className={`solenoid-node__display-value solenoid-node__display-value--error${value.origin ? " sol-error-chip--clickable" : ""}`}
        title={errorTip(value)}
        onClick={value.origin ? () => flyToNode(value.origin!.nodeId) : undefined}
        onPointerDown={value.origin ? (e) => e.stopPropagation() : undefined}
        onMouseDown={value.origin ? (e) => e.stopPropagation() : undefined}
      >
        {value.code}
      </div>
    );
  }

  function getClipboardText(): string {
    if (isEmpty) return "";
    if (isString) return cased(value as string);
    if (isLogical) return applyLogicalStyle(value as boolean, ann?.logicalStyle);
    if (listIsString) return (value as (string | null)[]).map((v) => (v === null ? "null" : cased(v))).join(", ");
    // A Format Controller annotation overrides a node's own custom render.
    // null/error cells aren't FC-formattable, so they take the literal cell form.
    if (isList) return (value as (number | null | SolError)[]).map((v) =>
      (toClipboard && !ann && typeof v === "number") ? toClipboard(v) : formatListCell(v, fmtScalar)
    ).join(", ");
    return toClipboard && !ann ? toClipboard(value as number) : fmtScalar(value as number);
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    const text = getClipboardText();
    if (!text) return;
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 1200);
    });
  }

  return (
    <div
      className={
        isEmpty
          ? "solenoid-node__display-value solenoid-node__display-value--empty"
          : "solenoid-node__display-value"
      }
      style={{
        position: "relative",
        ...(isList ? { fontSize: full ? 14 : 13 } : {}),
        // Text alignment override (advanced tier); the box is right-aligned by default.
        ...(isString && ann?.textAlign ? { textAlign: ann.textAlign } : {}),
        // Desktop selects text to copy; touch pans across it instead (the copy
        // button covers copying), so don't let a drag grab a text selection.
        userSelect: IS_COARSE ? "none" : "text",
        cursor: isEmpty ? undefined : "text",
        paddingLeft: isEmpty ? undefined : 26,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isEmpty ? empty
        : isString ? (
            ann?.textMarkdown ? (
              // Block markdown renders as its own styled container (a <div> can't
              // live inside the text <span>); font attrs still apply, headers/lists
              // set their own sizes relative to it.
              <div
                className="solenoid-node__md"
                style={{
                  width: "100%",
                  fontFamily: ann.textMono ? "var(--font-mono)" : "var(--font-sans)",
                  fontWeight: ann.bold ? 700 : undefined,
                  fontStyle: ann.italic ? "italic" : undefined,
                  fontSize: ann.textScale ? `${ann.textScale}px` : undefined,
                }}
                dangerouslySetInnerHTML={{ __html: renderTextMarkdownHtml(cased(value as string)) }}
              />
            ) : (
              <span style={{ fontFamily: "var(--font-sans)", ...(textStyle ?? {}) }}>
                {renderTextValue(cased(value as string))}
              </span>
            )
          )
        : isLogical ? applyLogicalStyle(value as boolean, ann?.logicalStyle)
        : listIsString ? (listInline ? (value as (string | null)[]).map((v) => (v === null ? "null" : cased(v))).join(", ") : <ArrayChip value={value as string[]} />)
        : isList ? (listInline ? (value as (number | null | SolError)[]).map((v) => formatListCell(v, fmtScalar)).join(", ") : <ArrayChip value={value as number[] | number[][]} />)
        : typeof value === "number" && Number.isNaN(value) ? (
            // A residual NaN is dirty DATA, not an error (an error is a tagged
            // SolError, rendered red above). Quiet muted affordance + a structural
            // tooltip — not error-red, not plain-number, not an ArrayChip.
            <span className="solenoid-node__nan" title="Not a number: an undefined value in the data">NaN</span>
          )
        : annotationRendersNegativeRed(ann, value) ? (
            // The FC's red negative style — the string already carries the
            // minus/parens; the color rides on top (format-model advanced tier).
            <span style={{ color: "var(--sol-error)" }}>{fmtScalar(value as number)}</span>
          )
        : render && !ann ? render(value as number)
        : fmtScalar(value as number)}
      {!isEmpty && (
        <button
          onClick={handleCopy}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          title={copied ? "Copied!" : "Copy value"}
          style={{
            position: "absolute",
            left: 6,
            top: "50%",
            transform: "translateY(-50%)",
            background: "none",
            border: "none",
            padding: 2,
            cursor: "pointer",
            color: copied ? "var(--accent)" : "var(--text-dim)",
            opacity: copied ? 1 : hovered ? 0.9 : 0.45,
            transition: "opacity 0.15s, color 0.15s",
          }}
        >
          <ClipboardIcon />
        </button>
      )}
    </div>
  );
}

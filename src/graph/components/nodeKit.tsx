import { useCallback, useState, useRef, type ReactNode, useLayoutEffect, useContext, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { copyText } from "../clipboard";
import { isPassthroughNode } from "../nodes/passthrough";
import { commentStore, commentsPanelUi } from "../commentStore";
import { settingsStore } from "../settingsStore";
import type { ClassicPreset } from "rete";
import type { ClassicScheme, RenderEmit } from "rete-react-plugin";
import { processGraph } from "../process";
import { getOwningEditor, getOwningArea } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { sharedAnnotationResolver } from "../unitFlow";
import { formatCx, isCx, type Cx } from "../cxValue";
import { NodeCard, HEADER_TAP_SLOP, useHeaderHeightVar } from "./NodeCard";
import { LazySelect } from "./LazySelect";
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
import { formatAnnotationStore, formatNumberWithAnnotation, applyTextCase, applyLogicalStyle, annotationRendersNegativeRed, formatCxWithAnnotation } from "../formatAnnotationStore";
import { nodeOutputElemFamily, dateFormatDisplay, shouldRenderListInline, formatListCell, unwrapUnitCells, type DisplayValue } from "./valueDisplayFormat";
import { IS_COARSE, stopDragStart } from "../coarse";
import { NodeFormatContext } from "./nodeContext";
import { describeValueKind } from "../valueKindLabel";
import { valueChipFor } from "./ValueChip";
import "./nodeCard.css";

/** Shared building blocks for standard node components: socket mapping, the
 *  label header, op selects, and the value display box. */

/** Render a string with leading/trailing whitespace as middots and "" as a dim
 *  placeholder — display only; the value and what's copied keep real whitespace. */
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

/** Sanitized markdown → HTML for a text FC's "Markdown" option — the string is
 *  untrusted (it arrives in shared .solenoid files), so sanitize before injecting. */
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

/** Controlled local state mirrored onto `node[key]`, recomputing the graph on
 *  change — the `useState` is what React tracks for controlled inputs/selects. */
export function useNodeField<N extends object, K extends keyof N>(
  node: N,
  key: K,
): [N[K], (next: N[K]) => void] {
  const [val, setVal] = useState<N[K]>(node[key]);
  const onChange = useCallback(
    (next: N[K]) => {
      node[key] = next;
      setVal(next);
      // Some config feeds a DERIVED socket type (a Group By aggregate decides a
      // resulting column's type), and no connection event fires here.
      const id = (node as { id?: string }).id;
      const ed = id ? getOwningEditor(id) : null;
      const ar = id ? getOwningArea(id) : null;
      if (ed && ar) reconcileTypesAfterEdit(ed, ar);
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

// ─── Multi-output rows ────────────────────────────────────────────────────────

// A Cx rides RAW rather than pre-formatted: the display layer owns formatting,
// so a docked FC's style/precision/unit can reach it.
export type OutputRowValue = number | boolean | string | Cx | (number | boolean | string | Cx | SolError | null)[] | SolError | null;

export type OutputRowDef = {
  key: string;
  label: string;
  value: OutputRowValue;
};

function formatRowCell(v: number | boolean | string | Cx | SolError | null): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return v;
  if (isCx(v)) return formatCx(v); // unannotated fallback; the box annotates first
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

// Must match the display div's 4-line clamp (.solenoid-node__label-display) so
// the editing textarea and the static title agree.
const LABEL_MAX_HEIGHT = 60;

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

/** The corner indicator shown when a node has a comment thread. Mounted
 *  unconditionally by NodeShell; renders nothing when there is no thread. */
function CommentIndicator({ nodeId }: { nodeId: string }) {
  const hasThread = useSyncExternalStore(commentStore.subscribe, () => commentStore.hasAny(nodeId));
  if (!hasThread) return null;
  const unresolved = commentStore.hasUnresolved(nodeId);
  return (
    <button
      type="button"
      className={`solenoid-node__comment-badge${unresolved ? "" : " solenoid-node__comment-badge--resolved"}`}
      title={`${commentStore.forNode(nodeId).length} comment${commentStore.forNode(nodeId).length === 1 ? "" : "s"}. Open.`}
      onClick={(e) => { e.stopPropagation(); commentsPanelUi.openFor(nodeId); }}
      onPointerDown={stopDragStart}
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
  accentOverride,
}: {
  node: ShellNode;
  emit: Emit;
  children: ReactNode;
  leading?: ReactNode;
  /** A small mark pinned to the card's top-right corner, clear of the header. */
  cornerBadge?: ReactNode;
  labelPlaceholder?: string;
  hideOutputSockets?: boolean;
  /** Forwarded to NodeCard — false hides the collapse chevron (see NodeCard). */
  collapsible?: boolean;
  /** Forwarded to NodeCard — collapse to a headerless square (Sparkline). */
  squareCollapse?: boolean;
  /** Extra class on the card (e.g. a node-specific width override). */
  className?: string;
  /** Forwarded to NodeCard — a header accent replacing the kind color. */
  accentOverride?: string;
}) {
  // Title edits commit on Enter/clickaway, never per keystroke — a committed
  // rename ripples through processGraph, and that must not run mid-typing.
  const labelField = useDraftCommit<string>(
    node.label ?? "",
    (v) => v,
    (t) => t,
    (v) => { node.label = v; void processGraph(); },
  );
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // Pointer-down position on the title label, to tell a tap (→ edit) from a
  // drag (→ move the node) in the click handler below.
  const labelDownPos = useRef<{ x: number; y: number } | null>(null);

  // An explicit placeholder wins, else the catalog name — so a cleared title
  // never collapses the header to a zero-height sliver.
  const effectivePlaceholder = labelPlaceholder ?? nodeName(node) ?? undefined;

  // The SETTING, not the zoom state — changes only on a Settings click, so the
  // full-graph re-render it triggers is fine; see the semantic div below.
  const semanticZoomSetting = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("semanticZoom"));

  // useLayoutEffect (not useEffect): the height must settle BEFORE paint, in the
  // same frame NodeCard measures --out-socket-top.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LABEL_MAX_HEIGHT)}px`;
  }, [labelField.draft, editing]);

  // Publish the header height as --header-h on every card (the frame SVG clips
  // its accent cap + divider to it; the corner badge offsets by it).
  useHeaderHeightVar(headerRef);

  return (
    <NodeFormatContext.Provider value={node.id}>
      <NodeCard selected={node.selected} node={node} collapsible={collapsible} squareCollapse={squareCollapse} className={className} accentOverride={accentOverride}>
        {/* The label display's own title (the untruncated label) wins inside its
            own bounds. */}
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
              // Don't stop propagation — the whole header is rete's drag handle;
              // edit mode opens only on a stationary tap (< HEADER_TAP_SLOP).
              onPointerDown={(e) => { labelDownPos.current = { x: e.clientX, y: e.clientY }; }}
              onClick={(e) => {
                const d = labelDownPos.current;
                if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > HEADER_TAP_SLOP) return;
                setEditing(true);
              }}
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
        {/* The socket positioning context: sockets and the box they align to are
            both inside, so every socket `top` is header-independent. */}
        <div className="solenoid-node__content">
          {leading}
          {!hideOutputSockets && <PortSockets node={node} emit={emit} side="output" />}
          <div className="solenoid-node__body">{children}</div>
          {/* One universal resizer per resizable node — drags the card width and
              the body height (--box-h); the body's content fills/scrolls. */}
          {nodeResizable(node as unknown as ClassicPreset.Node) && <ResizeHandle nodeId={node.id} />}
        </div>
        {/* Semantic-zoom simplified view, mounted only while the Settings toggle is
            on; the per-zoom-crossing swap stays pure CSS via the root class, so
            nodes never subscribe to zoom. */}
        {semanticZoomSetting && (
          <div className="solenoid-node__semantic" aria-hidden="true">
            <span>{node.label || effectivePlaceholder || ""}</span>
          </div>
        )}
      </NodeCard>
    </NodeFormatContext.Provider>
  );
}

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
  arg,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<OpOption<T>>;
  /** A selector that is NOT the family's op selector. Two consumers read it: the
   *  operation accent edge (data-op-kind) skips arg selects, and the VAL-12 source
   *  scan requires every NON-arg OpSelect to bind a field named `op`. */
  arg?: boolean;
}) {
  const hasGroups = options.some((o) => o.group != null);
  return (
    <LazySelect
      className="solenoid-node__op-select"
      data-op-arg={arg ? "" : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasGroups
        ? opGrouped(options)
        : options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
      }
    </LazySelect>
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
 * The result/display box — null (empty), a list (preview), or a scalar.
 * `empty` overrides the placeholder; `render` overrides scalar formatting;
 * `toClipboard` overrides what gets copied.
 */
export function ValueDisplay({
  value: rawValue,
  empty = "—",
  render,
  toClipboard,
  full,
  socketKey,
}: {
  value: DisplayValue;
  empty?: ReactNode;
  render?: (v: number) => ReactNode;
  toClipboard?: (v: number) => string;
  /** Show a list in full (all values, joined) instead of a chip — the Display
   *  node, whose box scrolls/wraps when resized. */
  full?: boolean;
  /** The OUTPUT socket this box displays — set on multi-box cards so an FC wired
   *  to ONE output formats only that box; single-box cards omit it. */
  socketKey?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // These hooks must run UNCONDITIONALLY, BEFORE the object-kind early return
  // below: the value can flip between scalar and object across renders, and a
  // hook after the return changes the hook count → React #300 unmounts the node.
  const ctxNodeId = useContext(NodeFormatContext);
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  // Safety net: an object-valued kind can slip in through an `any`/cast, and must
  // NOT reach the number/string path below (→ "[object Object]" or a .toFixed crash).
  const kindChip = valueChipFor(rawValue, { size: "sm" });
  if (kindChip != null) {
    return (
      <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}>
        {kindChip}
      </div>
    );
  }
  const kindLabel = describeValueKind(rawValue);
  if (kindLabel != null) {
    return <div className="solenoid-node__display-value">{kindLabel}</div>;
  }

  // A multi-box card names its socket so an FC on one hero row can't smear over
  // its siblings; single-box cards keep the any-socket read.
  let ann = ctxNodeId
    ? (socketKey ? formatAnnotationStore.get(ctxNodeId, socketKey) : formatAnnotationStore.getForNode(ctxNodeId))
    : undefined;
  // With no DIRECT annotation, a node that PASSES or SELECTS the value carries the
  // locked format on its output; guarded to those nodes (plus a socketKey'd box's
  // own output) so sources/transforms never pay the graph walk.
  if (!ann && ctxNodeId) {
    // Owning editor, not main: a node inside a Composite drill-in lives in the
    // internal editor, so its docked/carried FC must resolve there.
    const editor = getOwningEditor(ctxNodeId);
    const node = editor?.getNode(ctxNodeId) as
      (Record<string, unknown> & { outputs?: Record<string, unknown> }) | undefined;
    const carries = !!node && isPassthroughNode(node);
    if (editor && node && socketKey && typeof node.annotationFor === "function") {
      ann = sharedAnnotationResolver(editor).outAnnotation(ctxNodeId, socketKey);
    } else if (editor && node && carries) {
      const resolver = sharedAnnotationResolver(editor);
      for (const k of Object.keys(node.outputs ?? {})) {
        const a = resolver.outAnnotation(ctxNodeId, k);
        if (a) { ann = a; break; }
      }
    }
  }

  // The DECLARED element family, never a cell scan — a scan can't see a date (a
  // serial looks numeric) or an all-null list, so it would fall back to "numeric".
  const elemFam = nodeOutputElemFamily(ctxNodeId);
  const isDate = elemFam === "date";
  // A complex must resolve to a string HERE — after `ann`, before everything else
  // — so box, chip and clipboard alike keep working and honour the FC.
  const cxFmt = (c: Cx): string => (ann ? formatCxWithAnnotation(c, ann) : formatCx(c));
  // Typed off rawValue, not OutputRowValue: the raw box value also carries
  // UnitCells (unwrapped on the next line), and a Cx never survives past here.
  const cxResolved: Exclude<typeof rawValue, Cx> = isCx(rawValue)
    ? cxFmt(rawValue)
    : Array.isArray(rawValue) && rawValue.some(isCx)
      ? (rawValue as unknown[]).map((c) => (isCx(c) ? cxFmt(c) : c)) as Exclude<typeof rawValue, Cx>
      : rawValue as Exclude<typeof rawValue, Cx>;
  const value = dateFormatDisplay(unwrapUnitCells(cxResolved, ann), isDate, !!ann);

  // An empty array is "nothing to show": render the faded placeholder, not an
  // empty string — which has no line box and collapses the card below min height.
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
    // Only emit the key when mono is ON — a `fontFamily: undefined` in the spread
    // would clobber the span's base sans and force mono on every annotated value.
    ...(ann.textMono ? { fontFamily: "var(--font-mono)" } : {}),
  } : undefined;
  const cased = (s: string): string => (ann ? applyTextCase(s, ann.textCase) : s);

  // Errors render as a red #CODE! badge and propagate, so the chain of red boxes
  // leads back to the source — the Excel trace model.
  if (isSolError(value)) {
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
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isEmpty ? empty
        : isString ? (
            ann?.textMarkdown ? (
              // Block markdown needs its own container — a <div> can't live inside
              // the text <span>.
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
        : listIsString ? (listInline ? (value as (string | null)[]).map((v) => (v === null ? "null" : cased(v))).join(", ")
            // `elem` matters MOST here: dateFormatDisplay turned a date list's
            // serials into STRINGS, so the chip would otherwise sniff "text".
            : <ArrayChip value={value as string[]} elem={elemFam} />)
        : isList ? (listInline ? (value as (number | null | SolError)[]).map((v) => formatListCell(v, fmtScalar)).join(", ") : <ArrayChip value={value as number[] | number[][]} elem={elemFam} />)
        : typeof value === "number" && Number.isNaN(value) ? (
            // A residual NaN is dirty DATA, not an error — a quiet muted
            // affordance, never error-red.
            <span className="solenoid-node__nan" title="Not a number: an undefined value in the data">NaN</span>
          )
        : annotationRendersNegativeRed(ann, value) ? (
            // The FC's red negative style — the string already carries the
            // minus/parens; only the color rides on top.
            <span style={{ color: "var(--sol-error)" }}>{fmtScalar(value as number)}</span>
          )
        : render && !ann ? render(value as number)
        : fmtScalar(value as number)}
      {!isEmpty && (
        <button
          onClick={handleCopy}
          onPointerDown={stopDragStart}
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

import { useCallback, useState, useRef, type ReactNode, useLayoutEffect, useContext, useSyncExternalStore } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { copyText } from "../clipboard";
import { commentStore, commentsPanelUi } from "../commentStore";
import { settingsStore } from "../settingsStore";
import type { ClassicPreset } from "rete";
import { processGraph } from "../process";
import { getOwningEditor, getOwningView } from "../activeGraph";
import { reconcileTypesAfterEdit } from "../fcReconcile";
import { formatCxDisplay, isCx, type Cx } from "../cxValue";
import { NodeCard, HEADER_TAP_SLOP } from "./NodeCard";
import { useHeaderHeightVar } from "./useHeaderHeightVar";
import { LazySelect } from "./LazySelect";
import { NodeSocket, MeasuredSocketRow } from "./NodeSocket";
import { useDraftCommit } from "./inlineInput";
import { describeNode, nodeName, nodeTypeName } from "../catalogUtils";
import { descriptionText } from "../descriptionMd";

function headerTooltip(node: object): string | undefined {
  const d = describeNode(node);
  return d ? descriptionText(d) : undefined;
}
import { isSolError, type SolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { flyToNode } from "../flyToNode";
import { ResizeHandle } from "./ResizeHandle";
import { nodeSizeStore } from "../nodeSizeStore";
import { nodeResizable } from "../rete-nodes";
import { formatScalar } from "./format";
import { ArrayChip } from "./ArrayChip";
import { CategoryChip } from "./CategoryChip";
import { categoryColorIndex } from "../categoryColor";
import { formatAnnotationStore, formatNumberWithAnnotation, applyTextCase, applyLogicalStyle, annotationRendersNegativeRed, formatCxWithAnnotation } from "../formatAnnotationStore";
import { nodeOutputElemFamily, dateFormatDisplay, shouldRenderListInline, formatListCell, unwrapUnitCells, formatRowValue, resolveDisplayAnnotation, annotationForValue, type DisplayValue } from "./valueDisplayFormat";
import { IS_COARSE, stopDragStart } from "../coarse";
import { NodeFormatContext } from "./nodeContext";
import { describeValueKind } from "../valueKindLabel";
import { valueChipFor } from "./ValueChip";
import "./nodeCard.css";


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

// The string is untrusted (it arrives in shared .solenoid files), so it is sanitized before injection.
export function renderTextMarkdownHtml(s: string): string {
  return DOMPurify.sanitize(marked.parse(s, { async: false, gfm: true, breaks: true }) as string);
}

type Port = { socket: ClassicPreset.Socket; label?: string };

export type ShellNode = {
  id: string;
  label: string;
  selected?: boolean;
  width: number;
  height: number;
  inputs: Record<string, Port | undefined>;
  outputs: Record<string, Port | undefined>;
};

export type NodeProps<N> = {
  data: N & { width?: number; height?: number };
  emit: Emit;
};

export type Emit = (ctx: unknown) => void;

export function useNodeField<N extends object, K extends keyof N>(
  node: N,
  key: K,
): [N[K], (next: N[K]) => void] {
  const [val, setVal] = useState<N[K]>(node[key]);
  const onChange = useCallback(
    (next: N[K]) => {
      node[key] = next;
      setVal(next);
      // Config can feed a derived socket type (a GROUPBY aggregate's column type), and no connection event fires here.
      const id = (node as { id?: string }).id;
      const ed = id ? getOwningEditor(id) : null;
      const ar = id ? getOwningView(id) : null;
      if (ed && ar) reconcileTypesAfterEdit(ed, ar);
      void processGraph();
    },
    [node, key],
  );
  return [val, onChange];
}

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

// A Cx rides raw so a docked FC's style, precision and unit reach it in the display layer.
export type OutputRowValue = number | boolean | string | Cx | (number | boolean | string | Cx | SolError | null)[] | SolError | null;

export type OutputRowDef = {
  key: string;
  label: string;
  value: OutputRowValue;
};

function MeasuredOutputRow({
  rowKey, label, value, node, emit,
}: {
  rowKey: string;
  label: string;
  value: OutputRowValue;
  node: ShellNode;
  emit: Emit;
}) {
  // Per socket, like a socketKey'd ValueDisplay; a hook, so it runs before the early return.
  const ann = useSyncExternalStore(formatAnnotationStore.subscribe, () => resolveDisplayAnnotation(node.id, rowKey));
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
          {formatRowValue(value, ann)}
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

/** Null when the point isn't over `root`'s text. */
function textOffsetAtPoint(root: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let hit: { node: Node; offset: number } | null = null;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) hit = { node: p.offsetNode, offset: p.offset };
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) hit = { node: r.startContainer, offset: r.startOffset };
  }
  if (!hit || !root.contains(hit.node)) return null;
  let acc = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (t === hit.node) return acc + hit.offset;
    acc += t.textContent?.length ?? 0;
  }
  return null;
}

// Must match the 4-line clamp on .solenoid-node__label-display.
const LABEL_MAX_HEIGHT = 60;

function typeHint(node: ShellNode): string {
  return nodeTypeName(node as { constructor: { name: string } });
}

const CommentDot = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

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
  nonScrollingBody = false,
}: {
  node: ShellNode;
  emit: Emit;
  children: ReactNode;
  leading?: ReactNode;
  cornerBadge?: ReactNode;
  labelPlaceholder?: string;
  hideOutputSockets?: boolean;
  collapsible?: boolean;
  squareCollapse?: boolean;
  className?: string;
  accentOverride?: string;
  /** A figure body scales rather than scrolls, so a sized card must not trap the wheel (`nowheel`). */
  nonScrollingBody?: boolean;
}) {
  const labelField = useDraftCommit<string>(
    node.label ?? "",
    (v) => v,
    (t) => t,
    (v) => { node.label = v; void processGraph(); },
  );
  const [editing, setEditing] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const labelDownPos = useRef<{ x: number; y: number } | null>(null);
  // Applied once the textarea mounts; autoFocus alone parks the caret at the start.
  const pendingCaret = useRef<number | null>(null);

  const effectivePlaceholder = labelPlaceholder ?? nodeName(node) ?? undefined;

  // The setting, not the zoom state: the zoom crossing is pure CSS on the root class, so nodes never subscribe to zoom.
  const semanticZoomSetting = useSyncExternalStore(settingsStore.subscribe, () => settingsStore.get("semanticZoom"));
  const sized = useSyncExternalStore(nodeSizeStore.subscribe, () => nodeSizeStore.get(node.id) !== undefined);

  // useLayoutEffect: the height must settle before paint, in the frame NodeCard measures --out-socket-top.
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LABEL_MAX_HEIGHT)}px`;
  }, [labelField.draft, editing]);
  useLayoutEffect(() => {
    if (!editing) return;
    const el = taRef.current, at = pendingCaret.current;
    pendingCaret.current = null;
    if (!el || at == null) return;
    const p = Math.min(at, el.value.length);
    el.setSelectionRange(p, p);
  }, [editing]);

  useHeaderHeightVar(headerRef);

  return (
    <NodeFormatContext.Provider value={node.id}>
      <NodeCard selected={node.selected} node={node} collapsible={collapsible} squareCollapse={squareCollapse} className={className} accentOverride={accentOverride}>
        <div className="solenoid-node__header" ref={headerRef} title={headerTooltip(node)}>
          {editing ? (
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
              // No stopPropagation: the whole header is the drag handle.
              onPointerDown={(e) => { labelDownPos.current = { x: e.clientX, y: e.clientY }; }}
              onClick={(e) => {
                const d = labelDownPos.current;
                if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > HEADER_TAP_SLOP) return;
                pendingCaret.current = node.label ? textOffsetAtPoint(e.currentTarget, e.clientX, e.clientY) : 0;
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
        <div className="solenoid-node__content">
          {leading}
          {!hideOutputSockets && <PortSockets node={node} emit={emit} side="output" />}
          <div className={sized && !nonScrollingBody ? "solenoid-node__body nowheel" : "solenoid-node__body"}>{children}</div>
          {nodeResizable(node as unknown as ClassicPreset.Node) && <ResizeHandle nodeId={node.id} />}
        </div>
        {semanticZoomSetting && (
          <div className="solenoid-node__semantic" aria-hidden="true">
            <span>{node.label || effectivePlaceholder || ""}</span>
          </div>
        )}
      </NodeCard>
    </NodeFormatContext.Provider>
  );
}

export type OpOption<T extends string> = { value: T; label: string; group?: string; title?: string };

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
      <option key={o.value} value={o.value} title={o.title}>{o.label}</option>
    ));
    return g === "" ? items : [<optgroup key={g} label={g}>{items}</optgroup>];
  });
}

type PickProps<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<OpOption<T>>;
};

function PickSelect<T extends string>({ value, onChange, options, className }: PickProps<T> & { className: string }) {
  const hasGroups = options.some((o) => o.group != null);
  return (
    <LazySelect
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {hasGroups
        ? opGrouped(options)
        : options.map((o) => <option key={o.value} value={o.value} title={o.title}>{o.label}</option>)
      }
    </LazySelect>
  );
}

/** The family's OP picker (DESIGN.md § Op pickers); an argument uses ArgSelect. */
export function OpSelect<T extends string>(props: PickProps<T>) {
  return <PickSelect {...props} className="solenoid-node__select solenoid-node__select--op" />;
}

/** An argument picker; its field is never named `op` ([[C26]] opArgDistinct). */
export function ArgSelect<T extends string>(props: PickProps<T>) {
  return <PickSelect {...props} className="solenoid-node__select" />;
}


function ChipList({ items, cased }: { items: (string | null | SolError)[]; cased: (s: string) => string }) {
  const idx = categoryColorIndex(items.map((v) => (v === null || isSolError(v) ? null : v)));
  return (
    <span className="solenoid-node__chiplist">
      {items.map((v, i) =>
        v === null ? <span key={i} className="solenoid-node__chip-blank">null</span>
        : isSolError(v) ? <span key={i} className="solenoid-node__chip-blank">{v.code}</span>
        : <CategoryChip key={i} value={cased(v)} index={idx.get(v) ?? 0} />)}
    </span>
  );
}

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
  /** Show a list in full (values joined) instead of a chip: the Display node. */
  full?: boolean;
  /** The output socket this box displays, so an FC wired to one output formats only its box. */
  socketKey?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hooks before the object-kind early return: the value can flip kind across renders, and a changed hook count unmounts the node.
  const ctxNodeId = useContext(NodeFormatContext);
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);

  // An object value that slipped in through `any` must not reach the number and string path below.
  const kindChip = valueChipFor(rawValue, { size: "sm" });
  if (kindChip != null) {
    return (
      <div className="solenoid-node__display-value solenoid-node__display-value--chip">
        {kindChip}
      </div>
    );
  }
  const kindLabel = describeValueKind(rawValue);
  if (kindLabel != null) {
    return <div className="solenoid-node__display-value">{kindLabel}</div>;
  }

  const ann = annotationForValue(rawValue, resolveDisplayAnnotation(ctxNodeId, socketKey));

  // The declared element family, never a cell scan: a date serial looks numeric and an all-null list has no cells.
  const elemFam = nodeOutputElemFamily(ctxNodeId);
  const isDate = elemFam === "date";
  // Resolve a complex to a string here, after `ann`, so box, chip and clipboard all honor the FC.
  const cxFmt = (c: Cx): string => (ann ? formatCxWithAnnotation(c, ann) : formatCxDisplay(c));
  const cxResolved: Exclude<typeof rawValue, Cx> = isCx(rawValue)
    ? cxFmt(rawValue)
    : Array.isArray(rawValue) && rawValue.some(isCx)
      ? (rawValue as unknown[]).map((c) => (isCx(c) ? cxFmt(c) : c)) as Exclude<typeof rawValue, Cx>
      : rawValue as Exclude<typeof rawValue, Cx>;
  const value = dateFormatDisplay(unwrapUnitCells(cxResolved, ann), isDate, !!ann);

  // An empty string has no line box and collapses the card below its min height, so an empty array shows the placeholder.
  const isEmpty = value === null || (Array.isArray(value) && value.length === 0);
  const isString = typeof value === "string";
  const isLogical = typeof value === "boolean";
  const isList = Array.isArray(value);
  const listIsString = isList && typeof (value as unknown[])[0] === "string";

  const listInline = shouldRenderListInline(full, !!ann);

  const fmtScalar = (v: number): string =>
    ann ? formatNumberWithAnnotation(v, ann) : formatScalar(v);

  const textStyle: React.CSSProperties | undefined = ann && isString ? {
    fontWeight: ann.bold ? 700 : undefined,
    fontStyle: ann.italic ? "italic" : "normal",
    fontSize: ann.textScale ? `${ann.textScale}px` : undefined,
    // Only when on: a `fontFamily: undefined` in the spread would clobber the span's base sans.
    ...(ann.textMono ? { fontFamily: "var(--font-mono)" } : {}),
  } : undefined;
  const cased = (s: string): string => (ann ? applyTextCase(s, ann.textCase) : s);

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
    if (listIsString) return (value as (string | null | SolError)[]).map((v) => (v === null ? "null" : isSolError(v) ? v.code : cased(v))).join(", ");
    if (isList) return (value as (number | null | SolError)[]).map((v) =>
      (toClipboard && !ann && typeof v === "number") ? toClipboard(v) : formatListCell(v, fmtScalar, ann)
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
        ...(isDate && !isList ? { fontSize: 15 } : {}),
        ...(isString && ann?.textAlign ? { textAlign: ann.textAlign } : {}),
        userSelect: IS_COARSE ? "none" : "text",
        cursor: isEmpty ? undefined : "text",
        paddingLeft: isEmpty ? undefined : 26,
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isEmpty ? empty
        : isString ? (
            ann?.chip ? (
              <CategoryChip value={cased(value as string)} index={0} />
            ) : ann?.textMarkdown ? (
              // A <div> can't live inside the text <span>.
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
        : listIsString ? (
            ann?.chip ? <ChipList items={value as (string | null | SolError)[]} cased={cased} />
            : listInline ? (value as (string | null | SolError)[]).map((v) => (v === null ? "null" : isSolError(v) ? v.code : cased(v))).join(", ")
            // dateFormatDisplay turned a date list's serials into strings, so without `elem` the chip would read "text".
            : <ArrayChip value={value as string[]} elem={elemFam} />)
        : isList ? (listInline ? (value as (number | null | SolError)[]).map((v) => formatListCell(v, fmtScalar, ann)).join(", ") : <ArrayChip value={value as number[] | number[][]} elem={elemFam} />)
        : typeof value === "number" && Number.isNaN(value) ? (
            <span className="solenoid-node__nan" title="Not a number: an undefined value in the data">NaN</span>
          )
        : annotationRendersNegativeRed(ann, value) ? (
            <span style={{ color: "var(--sol-error)" }}>{fmtScalar(value as number)}</span>
          )
        : render && !ann ? render(value as number)
        : fmtScalar(value as number)}
      {!isEmpty && (
        <button
          className="sol-copy-icon"
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
        />
      )}
    </div>
  );
}

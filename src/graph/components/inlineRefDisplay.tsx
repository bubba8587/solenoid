import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ClassicPreset } from "rete";
import type { RenderEmit, ClassicScheme } from "rete-react-plugin";
import { getEditor } from "../process";
import { formatAnnotationStore, formatNumberWithAnnotation, type FormatAnnotation } from "../formatAnnotationStore";
import { sharedAnnotationResolver } from "../unitFlow";
import { formatScalar } from "./format";
import katex from "katex";
import "katex/dist/katex.min.css";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue, type ChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { MermaidView } from "./MermaidView";
import { isLambdaValue, type LambdaValue } from "../nodes/lambda";
import { formulaToLatex } from "../excelFormula";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { ChartView, toSeries } from "./chartView";
import { isSolError } from "../errorValue";
import { errorTip } from "./ErrorChip";
import { NodeSocket } from "./NodeSocket";

// ─── Inline-ref live rendering — shared by NoteNode and the Report document ────
// Both mint `any`-typed INPUT sockets from `` `=name` `` spans in a markdown body
// (noteInlineRefs.ts's extractInlineRefs) on a node exposing `refValue(key)`. This
// module is the ONE rendering path for "show the connected value in place of the
// span" — a Note card and the standalone Report overlay both call InlineRefBody so
// a ref renders identically (same resolver stack, same formatting, same no-pill
// Quiet-Accent styling) wherever it appears.

/** Any node whose inline refs this module can render — NoteNode and ReportNode
 *  both implement this (see nodes/annotation.ts / nodes/report.ts). */
export interface RefValueHost {
  refValue(key: string): unknown;
}

// Matches marked's rendering of a `` `=name` `` inline-ref span AFTER sanitization
// (DOMPurify keeps a bare <code> tag untouched) — used to find + swap those spans
// for a live value in the rendered DOM. Mirrors noteInlineRefs.ts's identifier
// grammar; kept in sync by inspection (both are simple `[A-Za-z_][A-Za-z0-9_]*`).
const INLINE_REF_TEXT_RE = /^=([A-Za-z_][A-Za-z0-9_]*)$/;

/** An FC docked directly to this ref input, else one reachable UPSTREAM through
 *  passthroughs (the DisplayComponent resolution order, minus `downstreamAnnotation`
 *  — a ref is a terminal consumer, not a passthrough with an "out" side). Plain
 *  function (no hook) so non-React callers — the static HTML export — can freeze
 *  the same formatting without a component tree. */
export function resolveRefAnnotation(nodeId: string, refKey: string): FormatAnnotation | undefined {
  const editor = getEditor();
  const resolver = editor ? sharedAnnotationResolver(editor) : undefined;
  return formatAnnotationStore.get(nodeId, refKey) ?? resolver?.inAnnotation(nodeId, refKey);
}

/** React subscription wrapper around resolveRefAnnotation, for components. */
export function useRefAnnotation(nodeId: string, refKey: string): FormatAnnotation | undefined {
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  return resolveRefAnnotation(nodeId, refKey);
}

/** A short text preview of any ref value — mirrors NoteNode's frontmatter
 *  previewValue scalar/list handling. Frame/cube collapse to a word here (the
 *  inline prose span shows the real compact table — see InlineRefValue). */
export function refPreview(value: unknown, ann: FormatAnnotation | undefined): string {
  if (value === null || value === undefined) return "—";
  if (isSolError(value)) return value.code;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return ann ? formatNumberWithAnnotation(value, ann) : formatScalar(value);
  if (typeof value === "string") return value;
  if (isLambdaValue(value)) return lambdaText(value);
  if (isMermaidValue(value)) return value.title || "diagram";
  if (isChartValue(value)) return value.title || "chart";
  if (isFrameValue(value)) return "frame";
  if (isCubeValue(value)) return "cube";
  if (Array.isArray(value)) {
    const shown = value.slice(0, 4).map((v) => refPreview(v, ann));
    return `[${shown.join(", ")}${value.length > 4 ? ", …" : ""}]`;
  }
  return String(value);
}

/**
 * The live value swapped in for a `` `=name` `` span in rendered prose (see
 * InlineRefBody). A frame/cube renders as the shared compact table preview
 * (capped rows/cols, `full={false}`) — the one place this reuses the node-card
 * display components, since a table is legitimately block-level. Everything else
 * renders as PLAIN TEXT in the Value face (no box/pill/fill — DESIGN.md's Quiet
 * Accent Rule: a decorative chip mid-sentence would read as a hero-metric, which
 * this system explicitly rejects).
 */
/** Plain-text form of a lambda — the inline preview + the KaTeX fallback. */
function lambdaText(v: LambdaValue): string {
  const sig = `λ(${v.params.join(", ")})`;
  const expr = (v.expr ?? "").trim();
  return expr ? `${sig} = ${expr}` : sig;
}

/** Render a wired lambda as its formula: `f(params) = body` typeset with KaTeX
 *  (reusing formulaToLatex — the same path the formula fields use). Falls back to
 *  plain text if the body doesn't parse (a half-typed lambda). Block display, so
 *  it reads as an equation in the report, not a mid-sentence chip. */
function LambdaFormula({ value }: { value: LambdaValue }) {
  const params = value.params.map((p) => p.replace(/[\\{}]/g, "")).join(",\\,");
  const expr = (value.expr ?? "").trim();
  const bodyTex = expr ? formulaToLatex(expr) : null;
  const html = (() => {
    if (!bodyTex) return null;
    try {
      return katex.renderToString(`f(${params}) = ${bodyTex}`, { throwOnError: false, displayMode: true });
    } catch { return null; }
  })();
  if (!html) return <span className="solenoid-ref-inline">{lambdaText(value)}</span>;
  return <span className="solenoid-ref-figure solenoid-ref-formula" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A wired chart's plot, sized to its CONTAINER (the report's content width,
 *  inside its side padding), never a fixed pixel width — a fixed 360px chart
 *  overflowed a narrow/mobile report by a few px and scrolled sideways for no
 *  reason. Capped so it doesn't stretch comically wide on a big report. Renders
 *  the plot ONLY (no caption); the caller supplies the title/collapse bar. */
function ChartBody({ value }: { value: ChartValue }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const series = toSeries(value.values);
  const width = Math.min(w, 640);
  return (
    <span className="solenoid-ref-chartbody" ref={ref}>
      {series.length === 0
        ? <span className="solenoid-ref-inline solenoid-ref-inline--empty">—</span>
        : width > 0
          ? <ChartView op={value.op} series={series} width={width} height={200} axes opts={value.options} />
          : null}
    </span>
  );
}

/** A collapsible block embed for the Report: a header bar (chevron + title) over
 *  the figure, click to fold it away. Every Report embed — chart, table, diagram,
 *  embedded note — gets one so a long report stays skimmable. Open by default. */
export function CollapsibleFigure({ title, children, defaultOpen = true }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <span className="solenoid-ref-embed">
      <button
        type="button"
        className="solenoid-ref-embed__bar"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`solenoid-ref-embed__chev${open ? " solenoid-ref-embed__chev--open" : ""}`}>▸</span>
        <span className="solenoid-ref-embed__title">{title}</span>
      </button>
      {open && <span className="solenoid-ref-embed__body">{children}</span>}
    </span>
  );
}

/** A figure-class ref value (chart / diagram / table / cube) → its title + body.
 *  `rich` (the Report) shows a tall, scrollable frame with more rows/cols; the
 *  compact form (a Note card) keeps the 3×3 preview. Non-figure values → null. */
function figureFor(
  value: unknown,
  refKey: string,
  rich: boolean,
): { title: string; caption: ReactNode; body: ReactNode } | null {
  if (isChartValue(value)) {
    return {
      title: value.title || refKey,
      caption: value.title ? <span className="solenoid-ref-figure__title">{value.title}</span> : null,
      body: <ChartBody value={value} />,
    };
  }
  if (isMermaidValue(value)) {
    return {
      title: value.title || refKey,
      caption: value.title ? <span className="solenoid-ref-figure__title">{value.title}</span> : null,
      body: <MermaidView source={value.source} />,
    };
  }
  if (isFrameValue(value)) {
    return {
      title: refKey,
      caption: null,
      // A document isn't a cramped node box: show many rows in a scrollable box.
      body: <FrameDisplay frame={value} label={refKey} previewRows={rich ? 25 : 3} previewCols={rich ? 12 : 3} scroll={rich} />,
    };
  }
  if (isCubeValue(value)) {
    return { title: refKey, caption: null, body: <CubeDisplay cube={value} label={refKey} full={false} /> };
  }
  return null;
}

export function InlineRefValue({ nodeId, refKey, collapsible }: { nodeId: string; refKey: string; collapsible?: boolean }) {
  const editor = getEditor();
  const node = editor?.getNode(nodeId) as unknown as RefValueHost | undefined;
  const value = node?.refValue(refKey);
  const ann = useRefAnnotation(nodeId, refKey);

  const fig = figureFor(value, refKey, !!collapsible);
  if (fig) {
    // In the Report (collapsible), each figure folds under a titled bar; in a Note
    // card it renders as the plain captioned figure.
    return collapsible
      ? <CollapsibleFigure title={fig.title}>{fig.body}</CollapsibleFigure>
      : <span className="solenoid-ref-figure">{fig.caption}{fig.body}</span>;
  }
  if (isLambdaValue(value)) return <LambdaFormula value={value} />;
  if (isSolError(value)) {
    return (
      <span className="solenoid-ref-inline solenoid-ref-inline--error" title={errorTip(value)}>
        {value.code}
      </span>
    );
  }
  return <span className="solenoid-ref-inline">{refPreview(value, ann)}</span>;
}

/**
 * One inline-ref INPUT row: an `any`-typed socket dot (straddling the LEFT edge),
 * the ref name, and a short value preview. Always `any` — a bare name has no
 * re-typeable field, unlike a Note's frontmatter key. Shared by NoteNode's
 * `.solenoid-note__ref-row` and ReportNode's `.solenoid-report__ref-row` — pass
 * the row class so each keeps its own straddle geometry (the row is the socket's
 * positioning context, and the two cards aren't the same width).
 */
export function RefInputRow({
  nodeId, emit, refKey, value, socket, rowClassName, keyClassName, valClassName,
}: {
  nodeId: string;
  emit: RenderEmit<ClassicScheme>;
  refKey: string;
  value: unknown;
  socket: ClassicPreset.Socket;
  rowClassName: string;
  keyClassName: string;
  valClassName: string;
}) {
  const ann = useRefAnnotation(nodeId, refKey);
  const preview = refPreview(value, ann);
  return (
    <div className={rowClassName}>
      <NodeSocket side="input" socketKey={refKey} nodeId={nodeId} emit={emit} payload={socket} />
      <span className={keyClassName} title={refKey}>{refKey}</span>
      <span className={valClassName} title={preview}>{preview}</span>
    </div>
  );
}

/**
 * Renders a markdown body's sanitized HTML, then swaps every `` `=name` `` code
 * span (found by DOM query AFTER the HTML is parsed, not by string-splitting the
 * HTML — keeps marked's paragraph/list nesting intact) for the matching inline-ref
 * input's live value, via a React portal into the DOM node marked's `<code>`
 * became. Re-scans whenever the rendered HTML changes (a body edit; a ref's own
 * value/format changing doesn't re-run this — InlineRefValue itself subscribes).
 */
export function InlineRefBody({
  nodeId, bodyHtml, className, renderEmbed, collapsibleEmbeds, onClick, onPointerDown, onMouseDown,
}: {
  nodeId: string;
  bodyHtml: string;
  className: string;
  /** Report only: render an embedded block for an `![[Name]]` token found in
   *  the body (Note cards pass nothing — they don't embed). */
  renderEmbed?: (name: string) => ReactNode;
  /** Report only: figure-class refs (chart/table/diagram) fold under a titled
   *  bar, and frames show a taller scrollable preview. A Note card renders them
   *  compact and inline. */
  collapsibleEmbeds?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}) {
  const htmlRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<{ el: HTMLElement; name: string }[]>([]);
  const [embedSlots, setEmbedSlots] = useState<{ el: HTMLElement; name: string; i: number }[]>([]);

  // Set the rendered HTML IMPERATIVELY (not via dangerouslySetInnerHTML) so
  // React never "owns" these children. The previous version passed the HTML as
  // a prop, then the code→span swap below mutated React-owned DOM — and the
  // setSlots re-render made React re-apply the prop, restoring the raw
  // `<code>=name</code>` and orphaning the portals. Net effect: NO ref ever
  // rendered its value in a Note or the Report. Imperative innerHTML keeps the
  // swap stable across re-renders (the whole reason Report refs looked dead).
  useLayoutEffect(() => {
    const root = htmlRef.current;
    if (!root) return;
    root.innerHTML = bodyHtml;
    const found: { el: HTMLElement; name: string }[] = [];
    root.querySelectorAll("code").forEach((codeEl) => {
      const m = INLINE_REF_TEXT_RE.exec(codeEl.textContent ?? "");
      if (!m) return;
      const span = document.createElement("span");
      codeEl.replaceWith(span);
      found.push({ el: span, name: m[1] });
    });
    setSlots(found);
    // Embed tokens (`![[Name]]`, pre-processed to a data-embed marker) — portal
    // an embed block into each. Report-only; NoteNode passes no renderEmbed.
    const embeds: { el: HTMLElement; name: string; i: number }[] = [];
    if (renderEmbed) {
      root.querySelectorAll<HTMLElement>("[data-embed]").forEach((el, i) => {
        embeds.push({ el, name: el.dataset.embed ?? "", i });
      });
    }
    setEmbedSlots(embeds);
  }, [bodyHtml, renderEmbed]);

  return (
    <div className={className} onClick={onClick} onPointerDown={onPointerDown} onMouseDown={onMouseDown}>
      <div ref={htmlRef} />
      {slots.map((s) => createPortal(<InlineRefValue key={s.name} nodeId={nodeId} refKey={s.name} collapsible={collapsibleEmbeds} />, s.el))}
      {renderEmbed && embedSlots.map((s) => createPortal(
        <span key={`${s.name}:${s.i}`}>{renderEmbed(s.name)}</span>, s.el,
      ))}
    </div>
  );
}

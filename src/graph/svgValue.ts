// ─── SVG as a first-class figure value ───────────────────────────────────────
// A sibling of ImageValue / MermaidValue / ChartValue: a self-describing picture
// that rides the `chart` object socket (the green "Special" family — identity-only
// + `any`) and renders wherever a chart does — inline in a Report where its
// `=name` ref sits. The SVG Picker node emits one, carrying the inlined SVG markup
// plus the currently-picked layer (so the embed can highlight the same selection
// the node shows) and the highlight color.
//
// Unlike ImageValue this carries the SVG *markup* (not a URL / data URL): the
// picker needs the live DOM to hover + click inner elements, so the source is
// inlined, and it persists as plain text (like Mermaid's source) — no bundling.

export interface SvgValue {
  __svg: true;
  /** The inlined SVG markup — never a URL (the picker needs the live DOM). */
  source: string;
  /** The currently-picked layer name, if any — so a Report render highlights it. */
  selected?: string | null;
  /** Highlight color (hex) — so a Report render matches the node's pick. */
  hoverColor?: string;
  /** Rendered height in px (the SVG Picker node's `height`); width fills. */
  height: number;
  /** Display title — the node label (a quiet caption above the figure). */
  title?: string;
}

/** Duck-typed brand check — svg values cross `any` sockets and React roots. */
export function isSvgValue(v: unknown): v is SvgValue {
  return typeof v === "object" && v !== null && (v as { __svg?: unknown }).__svg === true;
}

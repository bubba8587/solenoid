// A mermaid diagram as a first-class figure value — a sibling of ChartValue that
// rides the `chart` object socket and renders wherever a chart does.
//
// Kept flat + JSON-safe (just the source text + a title) so it serializes and
// crosses cables / React roots like any other value. The SVG is rendered lazily
// by MermaidView (mermaid.js is dynamically imported only when a diagram is on
// screen).

export interface MermaidValue {
  __mermaid: true;
  /** The mermaid diagram source (e.g. `graph TD; A-->B`). */
  source: string;
  /** Display title — the node label (a quiet caption above the figure). */
  title?: string;
}

/** Duck-typed brand check — mermaid values cross `any` sockets and React roots. */
export function isMermaidValue(v: unknown): v is MermaidValue {
  return typeof v === "object" && v !== null && (v as { __mermaid?: unknown }).__mermaid === true;
}

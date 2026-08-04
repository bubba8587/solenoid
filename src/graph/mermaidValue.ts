// A sibling of ChartValue riding the `chart` socket. Kept flat + JSON-safe so it
// crosses cables and React roots; MermaidView renders the SVG lazily.

export interface MermaidValue {
  __mermaid: true;
  /** e.g. `graph TD; A-->B`. */
  source: string;
  /** A quiet caption above the figure. */
  title?: string;
}

/** Duck-typed: these cross `any` sockets and React roots. */
export function isMermaidValue(v: unknown): v is MermaidValue {
  return typeof v === "object" && v !== null && (v as { __mermaid?: unknown }).__mermaid === true;
}

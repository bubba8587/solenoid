// [[C100]] chartIsAValue
// A sibling of ChartValue on the chart socket, flat and JSON-safe; MermaidView renders the SVG lazily.

export interface MermaidValue {
  __mermaid: true;
  /** e.g. `graph TD; A-->B`. */
  source: string;
  title?: string;
}

export function isMermaidValue(v: unknown): v is MermaidValue {
  return typeof v === "object" && v !== null && (v as { __mermaid?: unknown }).__mermaid === true;
}

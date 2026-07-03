// ─── Mermaid diagram as a first-class figure value ───────────────────────────
// A sibling of ChartValue (chartValue.ts): a self-describing figure that rides
// the `chart` object socket (the green "Special" family — identity-only + `any`)
// and renders wherever a chart does — inline in a Report where its `=name` ref
// sits, and on the producing node's own card. Per the standing rule (see
// dev-notes 2026-07-03): rich visual content is produced by NODES and flows as a
// chart-family value; a Report stays plain text + embeds and is never made
// first-class for a content type. So Mermaid is a node whose output IS a figure,
// not a Report markdown feature.
//
// Kept flat + JSON-safe (just the source text + a title) so it serializes and
// crosses cables / React roots like any other value. The actual SVG is rendered
// lazily by MermaidView (mermaid.js is a heavy dep, dynamically imported only
// when a diagram is on screen).

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

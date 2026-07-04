// ─── Image as a first-class figure value ─────────────────────────────────────
// A sibling of ChartValue / MermaidValue: a self-describing picture that rides the
// `chart` object socket (the green "Special" family — identity-only + `any`) and
// renders wherever a chart does — inline in a Report where its `=name` ref sits.
// The Image node emits one, carrying its `src` and the node's `height` (and, as the
// Image node grows transforms — crop, fit, filters — those ride here too). Kept
// flat + JSON-safe so it crosses cables / React roots like any other value.
//
// `src` may be a web URL (persisted) or a session-only data: URL (a locally
// attached file — same persistence limit as the Image node itself).

export interface ImageValue {
  __image: true;
  /** The image source — a web URL or a data: URL. */
  src: string;
  /** Rendered height in px (the Image node's `height`); width follows aspect. */
  height: number;
  /** Alt / caption text — the node label. */
  alt?: string;
  /** Display title — the node label (a quiet caption above the figure). */
  title?: string;
}

/** Duck-typed brand check — image values cross `any` sockets and React roots. */
export function isImageValue(v: unknown): v is ImageValue {
  return typeof v === "object" && v !== null && (v as { __image?: unknown }).__image === true;
}

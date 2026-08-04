// A sibling of ChartValue: rides the `chart` object socket and renders wherever a
// chart does. Flat + JSON-safe, so it crosses cables and React roots.

export interface ImageValue {
  __image: true;
  /** A web URL (persisted) or a session-only data: URL. */
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

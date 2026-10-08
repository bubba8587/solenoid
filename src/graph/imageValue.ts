// [[C100]] chartIsAValue (a sibling value on the chart socket)
// A sibling of ChartValue on the chart socket. Flat and JSON-safe, so it crosses cables and React roots.

export interface ImageValue {
  __image: true;
  /** A web URL (persisted) or a session-only data: URL. */
  src: string;
  /** Pixels; width follows the aspect ratio. */
  height: number;
  alt?: string;
  title?: string;
}

export function isImageValue(v: unknown): v is ImageValue {
  return typeof v === "object" && v !== null && (v as { __image?: unknown }).__image === true;
}

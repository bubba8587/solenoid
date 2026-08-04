// Carries SVG *markup*, never a URL — the picker hovers/clicks inner elements, so
// the source must be inlined (and persists as plain text, no bundling).

export interface SvgValue {
  __svg: true;
  source: string;
  /** Picked layer name — carried so a Report render highlights the same one. */
  selected?: string | null;
  /** Highlight color (hex). */
  hoverColor?: string;
  /** Rendered height in px; width fills. */
  height: number;
  title?: string;
}

/** Duck-typed brand check — svg values cross `any` sockets and React roots. */
export function isSvgValue(v: unknown): v is SvgValue {
  return typeof v === "object" && v !== null && (v as { __svg?: unknown }).__svg === true;
}

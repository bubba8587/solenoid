// [[C100]] chartIsAValue (a sibling value on the chart socket)
// Carries SVG markup, never a URL: the picker hovers and clicks inner elements, so the source must be inline.

export interface SvgValue {
  __svg: true;
  source: string;
  /** Carried so a Report render highlights the same layer. */
  selected?: string | null;
  hoverColor?: string;
  height: number;
  title?: string;
}

export function isSvgValue(v: unknown): v is SvgValue {
  return typeof v === "object" && v !== null && (v as { __svg?: unknown }).__svg === true;
}

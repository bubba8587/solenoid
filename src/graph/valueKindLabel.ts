import { isChartValue } from "./chartValue";
import { isMermaidValue } from "./mermaidValue";
import { isImageValue } from "./imageValue";
import { isSvgValue } from "./svgValue";
import { isFrameValue, isCubeValue } from "./frame";
import { isLambdaValue, formatLambda } from "./nodes/lambda";
import { isUncertain, type UncertainNumber } from "./valueKinds";
import { formatScalar } from "./components/format";

/** "12.3 ± 1.5" — an uncertain number's compact readout (value ± 1σ), each part
 *  through the app's standard scalar formatter. Shared by every value surface via
 *  describeValueKind so the wrapper object never stringifies to "[object Object]". */
export function formatUncertain(v: UncertainNumber): string {
  return `${formatScalar(v.value)} ± ${formatScalar(v.error)}`;
}

/**
 * A short human label for an OBJECT-valued kind (chart, diagram, image, lambda,
 * frame, cube) that would otherwise stringify to "[object Object]" in a compact
 * text readout or a scalar value box. Returns null for plain values (scalars,
 * lists, null, errors) — the caller formats those itself.
 *
 * This is the safety net behind every value-rendering surface: a rich surface
 * (Display node, Input Switch) branches on the kind FIRST to draw the real
 * figure/grid; anything that falls through to a text/number path calls this so a
 * casted `any` object never reads as "[object Object]". Keep the kinds in sync
 * with the Display node's branches.
 */
export function describeValueKind(v: unknown): string | null {
  if (isChartValue(v)) return "Chart";
  if (isMermaidValue(v)) return "Diagram";
  if (isImageValue(v)) return "Image";
  if (isSvgValue(v)) return "SVG";
  if (isLambdaValue(v)) return formatLambda(v);
  if (isUncertain(v)) return formatUncertain(v);
  if (isFrameValue(v)) {
    const cols = v.columns.length;
    const rows = v.__totalRows ?? v.columns[0]?.values.length ?? 0;
    return `${rows}×${cols}`;
  }
  if (isCubeValue(v)) return "Cube";
  return null;
}

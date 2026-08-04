import { isChartValue } from "./chartValue";
import { isMermaidValue } from "./mermaidValue";
import { isImageValue } from "./imageValue";
import { isSvgValue } from "./svgValue";
import { isDocumentValue } from "./documentValue";
import { isFrameValue, isCubeValue } from "./frame";
import { isLambdaValue, formatLambda } from "./nodes/lambda";
import { isUncertain, type UncertainNumber } from "./valueKinds";
import { formatScalar } from "./components/format";

/** "12.3 ± 1.5" (value ± 1σ), each part through the standard scalar formatter, so the
 *  wrapper object never stringifies to "[object Object]". */
export function formatUncertain(v: UncertainNumber): string {
  return `${formatScalar(v.value)} ± ${formatScalar(v.error)}`;
}

/** A short label for an OBJECT-valued kind; null for plain values, which the caller
 *  formats itself. Keep the kinds in sync with the Display node's branches. */
export function describeValueKind(v: unknown): string | null {
  if (isChartValue(v)) return "Chart";
  if (isMermaidValue(v)) return "Diagram";
  if (isImageValue(v)) return "Image";
  if (isSvgValue(v)) return "SVG";
  if (isDocumentValue(v)) return "Document";
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

import type { ReactElement } from "react";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isDocumentValue } from "../documentValue";
import { FrameChip } from "./FrameChip";
import { CubeChip } from "./CubeChip";
import { ChartChip } from "./ChartChip";
import { DocumentChip } from "./DocumentChip";

/** The ONE chip registry for object kinds with a click affordance; null for
 *  everything else. describeValueKind is the TEXT net behind it for chip-less
 *  kinds — keep the two in sync when adding a kind. */
export function valueChipFor(
  value: unknown,
  opts: { label?: string; pinNodeId?: string; size: "sm" | "md" },
): ReactElement | null {
  const { label, pinNodeId, size } = opts;
  if (isFrameValue(value)) return <FrameChip value={value} label={label} pinNodeId={pinNodeId} size={size} />;
  if (isCubeValue(value)) return <CubeChip value={value} label={label} pinNodeId={pinNodeId} size={size} />;
  if (isChartValue(value)) return <ChartChip value={value} label={label} pinNodeId={pinNodeId} size={size} />;
  if (isDocumentValue(value)) return <DocumentChip value={value} size={size} />;
  return null;
}

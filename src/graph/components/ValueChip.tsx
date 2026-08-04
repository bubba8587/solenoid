import type { ReactElement } from "react";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isDocumentValue } from "../documentValue";
import { FrameChip } from "./FrameChip";
import { CubeChip } from "./CubeChip";
import { ChartChip } from "./ChartChip";
import { DocumentChip } from "./DocumentChip";

/**
 * The ONE chip registry for OBJECT-valued kinds with a real click affordance
 * (frame → grid popup, cube → cube popup, chart → chart popup, document → its
 * source Report/Note). Returns null for everything else — plain values, and
 * object kinds with no chip (mermaid/svg/image/lambda render figures or labels).
 *
 * Every chip surface goes through here, so a NEW kind added here lands on all of
 * them at once at a consistent per-surface size. describeValueKind
 * (valueKindLabel.ts) is the TEXT net behind this for chip-less kinds and
 * text-only surfaces; keep the two in sync when adding a kind.
 */
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

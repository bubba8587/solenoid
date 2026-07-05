import { useSyncExternalStore } from "react";
import type { DisplayNode as DisplayNodeType } from "../rete-nodes";
import { formatWithUnit } from "../unitFormat";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { sharedAnnotationResolver } from "../unitFlow";
import { getEditor } from "../process";
import { collapseStore } from "../collapseStore";
import { NodeShell, PortSockets, ValueDisplay, type NodeProps } from "./nodeKit";
import { TableDisplay } from "./TableDisplay";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { MermaidView } from "./MermaidView";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isLambdaValue, formatLambda } from "../nodes/lambda";
import { isSolError } from "../errorValue";

export function DisplayComponent({ data, emit }: NodeProps<DisplayNodeType>) {
  // Re-render when any Format Controller annotation changes.
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  // Expanded → show the full value; collapsed → fall back to the compact preview,
  // which is the form that collapses cleanly to just a chip (list/table/frame).
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const full = !collapsed;

  // Honor an FC docked to EITHER of the Display's sockets (in or out), not
  // just "in" — the FC keys the annotation to whichever socket it snapped to.
  // With no direct annotation, resolve the FC's lock in EITHER direction (a
  // Display is a passthrough, so the same value rides through it unchanged):
  //   • inAnnotation — an FC UPSTREAM, its lock riding the value down into here.
  //   • downstreamAnnotation — an FC DOWNSTREAM, reachable through a run of
  //     passthroughs; the value reaches it unchanged, so this earlier Display in
  //     the same segment shows the same lock (`…→Disp1→Disp2→FC` formats Disp1 too).
  // Both break at a transform. A direct (docked / trailing-FC) annotation wins.
  const editor = getEditor();
  const resolver = editor ? sharedAnnotationResolver(editor) : undefined;
  const ann =
    formatAnnotationStore.getForNode(data.id) ??
    resolver?.inAnnotation(data.id, "in") ??
    resolver?.downstreamAnnotation(data.id, "out");

  function fmt(v: number): string {
    // Backstop: the kind-branches below keep objects out of here, but never let a
    // stray non-number reach formatWithUnit (.toFixed) and crash the node.
    if (typeof v !== "number") return String(v);
    if (ann) return formatNumberWithAnnotation(v, ann);
    return formatWithUnit(v, data.unitSuffix);
  }

  const v = data.cachedValue;
  const isError = isSolError(v);
  const isFrame = isFrameValue(v);
  const isCube = isCubeValue(v);
  // Object-valued figures/values that must NOT reach the number formatter (fmt
  // calls .toFixed) — that crashed the whole Display node off the canvas when a
  // Chart (or Mermaid / lambda) was wired in. Render each by kind instead.
  const isChart = isChartValue(v);
  const isMermaid = isMermaidValue(v);
  const isLambda = isLambdaValue(v);
  const isTable = Array.isArray(v) && Array.isArray((v as unknown[])[0]);
  // 2D data (frame/cube/table) and a figure (chart/diagram) grow the card to fit;
  // a SCALAR grows to fit a long number/string (capped, then ellipsizes) instead of
  // clipping in the fixed card. Lists wrap as text.
  const grow = full && (isFrame || isCube || isTable || isChart || isMermaid);
  const growScalar = full && !grow && !isError && !isLambda && v != null && !Array.isArray(v) && typeof v !== "object";
  const growClass = grow ? "solenoid-node--display-grow" : growScalar ? "solenoid-node--display-grow-scalar" : undefined;

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Display" className={growClass} leading={<PortSockets node={data} emit={emit} side="input" />}>
      {isError ? (
        <ValueDisplay value={v} full={full} />
      ) : isFrame ? (
        <FrameDisplay frame={v} label={data.label} full={full} />
      ) : isCube ? (
        <CubeDisplay cube={v} label={data.label} full={full} />
      ) : isChart ? (
        // Collapsed → the [Chart] chip in the hero box (matching how a frame/table
        // collapses to its chip); expanded → the full figure.
        full ? <ChartFigure value={v} width={210} height={130} />
             : <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><ChartChip value={v} /></div>
      ) : isMermaid ? (
        <MermaidView source={v.source} />
      ) : isLambda ? (
        <div className="solenoid-node__display-value">{formatLambda(v)}</div>
      ) : isTable ? (
        <TableDisplay table={v as number[][]} label={data.label} full={full} />
      ) : (
        <ValueDisplay
          value={v as number | number[] | string | string[] | null}
          render={fmt}
          toClipboard={fmt}
          full={full}
        />
      )}
    </NodeShell>
  );
}

import { useSyncExternalStore } from "react";
import type { DisplayNode as DisplayNodeType } from "../rete-nodes";
import { formatWithUnit } from "../unitFormat";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { makeAnnotationResolver } from "../unitFlow";
import { getEditor } from "../process";
import { collapseStore } from "../collapseStore";
import { NodeShell, PortSockets, ValueDisplay, type NodeProps } from "./nodeKit";
import { TableDisplay } from "./TableDisplay";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { isFrameValue, isCubeValue } from "../frame";
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
  const resolver = editor ? makeAnnotationResolver(editor) : undefined;
  const ann =
    formatAnnotationStore.getForNode(data.id) ??
    resolver?.inAnnotation(data.id, "in") ??
    resolver?.downstreamAnnotation(data.id, "out");

  function fmt(v: number): string {
    if (ann) return formatNumberWithAnnotation(v, ann);
    return formatWithUnit(v, data.unitSuffix);
  }

  const v = data.cachedValue;
  const isError = isSolError(v);
  const isFrame = isFrameValue(v);
  const isCube = isCubeValue(v);
  const isTable = Array.isArray(v) && Array.isArray((v as unknown[])[0]);
  // 2D data (frame/cube/table) grows the card to fit its columns; a SCALAR grows to
  // fit a long number/string (capped, then ellipsizes) instead of clipping in the
  // fixed card. Lists wrap as text.
  const grow = full && (isFrame || isCube || isTable);
  const growScalar = full && !grow && !isError && v != null && !Array.isArray(v);
  const growClass = grow ? "solenoid-node--display-grow" : growScalar ? "solenoid-node--display-grow-scalar" : undefined;

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Display" className={growClass} leading={<PortSockets node={data} emit={emit} side="input" />}>
      {isError ? (
        <ValueDisplay value={v} full={full} />
      ) : isFrame ? (
        <FrameDisplay frame={v} label={data.label} full={full} />
      ) : isCube ? (
        <CubeDisplay cube={v} label={data.label} full={full} />
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

import { useSyncExternalStore, useLayoutEffect, useRef, useState } from "react";
import type { DisplayNode as DisplayNodeType } from "../rete-nodes";
import { formatWithUnit } from "../unitFormat";
import { formatAnnotationStore, formatNumberWithAnnotation } from "../formatAnnotationStore";
import { sharedAnnotationResolver } from "../unitFlow";
import { getOwningEditor } from "../activeGraph";
import { collapseStore } from "../collapseStore";
import { NodeShell, PortSockets, ValueDisplay, type NodeProps } from "./nodeKit";
import { TableDisplay } from "./TableDisplay";
import { nodeOutputElemFamily } from "./valueDisplayFormat";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { MermaidView } from "./MermaidView";
import { SvgFigure } from "./SvgFigure";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue, type ChartValue } from "../chartValue";
import { nodeSizeStore } from "../nodeSizeStore";
import { isMermaidValue } from "../mermaidValue";
import { isSvgValue } from "../svgValue";
import { isLambdaValue } from "../nodes/lambda";
import { LambdaValueView } from "./LambdaView";
import { isSolError } from "../errorValue";
import { recordNavTarget, stepRecordRow } from "./recordNav";

// Only for a Display with a DEFINITE size — measuring a content-driven card feeds
// back (chart size → card size → …) and oscillates; overflow stays hidden for it.
function MeasuredChart({ value, fontScale, recordNav }: { value: ChartValue; fontScale?: number; recordNav?: (delta: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 210, h: 130 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(120, Math.round(el.clientWidth));
      const h = Math.max(90, Math.round(el.clientHeight));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <ChartFigure value={value} width={size.w} height={size.h} fontScale={fontScale} recordNav={recordNav} />
    </div>
  );
}

export function DisplayComponent({ data, emit }: NodeProps<DisplayNodeType>) {
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  // Collapsed falls back to the compact preview — the form that reduces to a chip.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const full = !collapsed;
  // The hook must run UNCONDITIONALLY — guarding it behind `!collapsed` changes the
  // per-render hook count with collapse (React #310).
  const manualSize = useSyncExternalStore(nodeSizeStore.subscribe, () => nodeSizeStore.get(data.id));
  const sized = !collapsed && !!manualSize;

  // A direct (docked) annotation wins; otherwise resolve the FC's lock in EITHER
  // direction, both breaking at a transform:
  //   • inAnnotation — an FC UPSTREAM, its lock riding the value down into here.
  //   • downstreamAnnotation — an FC DOWNSTREAM through a run of passthroughs, so
  //     `…→Disp1→Disp2→FC` formats Disp1 too.
  const editor = getOwningEditor(data.id); // internal drill-in nodes resolve their FC in the internal editor
  const resolver = editor ? sharedAnnotationResolver(editor) : undefined;
  const ann =
    formatAnnotationStore.getForNode(data.id) ??
    resolver?.inAnnotation(data.id, "in") ??
    resolver?.downstreamAnnotation(data.id, "out");

  function fmt(v: number): string {
    // Backstop: a stray non-number reaching formatWithUnit (.toFixed) crashes the node.
    if (typeof v !== "number") return String(v);
    if (ann) return formatNumberWithAnnotation(v, ann);
    return formatWithUnit(v, data.unitSuffix);
  }

  const v = data.cachedValue;
  const isError = isSolError(v);
  // The drawn record card carries its own pager when this Display can reach a
  // steppable Record upstream (unwired Row, card view) — recordNav.ts.
  const recordId = isChartValue(v) && v.op === "record" ? recordNavTarget(data.id) : null;
  const recordStep = recordId ? (delta: number) => { void stepRecordRow(recordId, delta); } : undefined;
  const isFrame = isFrameValue(v);
  const isCube = isCubeValue(v);
  // Object-valued figures must NOT reach the number formatter (fmt calls .toFixed).
  const isChart = isChartValue(v);
  const isMermaid = isMermaidValue(v);
  const isSvg = isSvgValue(v);
  const isLambda = isLambdaValue(v);
  const isTable = Array.isArray(v) && Array.isArray((v as unknown[])[0]);
  // 2-D data and figures grow the card to fit; a scalar grows (capped) rather than
  // clipping, and lists wrap as text.
  const grow = full && (isFrame || isCube || isTable || isChart || isMermaid || isSvg);
  const growScalar = full && !grow && !isError && !isLambda && v != null && !Array.isArray(v) && typeof v !== "object";
  const growClass = grow ? "solenoid-node--display-grow" : growScalar ? "solenoid-node--display-grow-scalar" : undefined;

  // The resize floor for THIS content type; the grip reads it to clamp.
  const minSize = isChart ? { w: 230, h: 150 }
    : isMermaid ? { w: 200, h: 120 }
    : isSvg ? { w: 200, h: 120 }
    : (isFrame || isCube || isTable) ? { w: 200, h: 90 }
    : { w: 140, h: 40 };
  useLayoutEffect(() => {
    nodeSizeStore.setMin(data.id, minSize);
    return () => nodeSizeStore.setMin(data.id, undefined);
  }, [data.id, minSize.w, minSize.h]);

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Display" className={growClass} leading={<PortSockets node={data} emit={emit} side="input" />}>
      {isError ? (
        <ValueDisplay value={v} full={full} />
      ) : isFrame ? (
        <FrameDisplay frame={v} label={data.label} full={full} />
      ) : isCube ? (
        <CubeDisplay cube={v} label={data.label} full={full} />
      ) : isChart ? (
        !full ? <div className="solenoid-node__display-value" style={{ display: "flex", justifyContent: "flex-end" }}><ChartChip value={v} /></div>
              : sized ? <MeasuredChart value={v} fontScale={ann?.chartFontScale} recordNav={recordStep} />
              : <ChartFigure value={v} width={210} height={130} fontScale={ann?.chartFontScale} recordNav={recordStep} />
      ) : isMermaid ? (
        <MermaidView source={v.source} />
      ) : isSvg ? (
        <SvgFigure value={v} height={full ? 200 : 120} />
      ) : isLambda ? (
        <LambdaValueView value={v} view={ann?.lambdaView} />
      ) : isTable ? (
        <TableDisplay table={v as number[][]} label={data.label} full={full} elem={nodeOutputElemFamily(data.id)} />
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

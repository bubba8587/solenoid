import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import type { ConditionalRegionsNode as ConditionalRegionsNodeType, RegionsMode, RegionsResult } from "../nodeClasses";
import { REGIONS_MODE_META, REGIONS_RESULT_META } from "../nodes/visual";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import { ErrorChip } from "./ErrorChip";
import { useSeriesColors, regionLabelColor } from "./chartCore";
import { dropInputCables } from "./cablePrune";
import { collapseStore } from "../collapseStore";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { getOwningView } from "../activeGraph";
import { processGraph } from "../process";

const RegionsFigure = lazy(() => import("./chartRender").then((m) => ({ default: m.RegionsFigure })));

// Fills the wide card (240) minus body padding, as Chart does.
const W = 218;
const H = 170;

const options = <T extends string>(meta: Record<T, { label: string; description: string }>) =>
  (Object.keys(meta) as T[]).map((value) => ({ value, label: meta[value].label, title: meta[value].description }));
const MODE_OPTIONS = options<RegionsMode>(REGIONS_MODE_META);
const RESULT_OPTIONS = options<RegionsResult>(REGIONS_RESULT_META);

/** A Bool region cycles unmarked, TRUE, FALSE. */
function nextMark(marks: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...marks };
  if (!(key in next)) next[key] = true;
  else if (next[key]) next[key] = false;
  else delete next[key];
  return next;
}

/** A Text region cycles unmarked, then each label in turn. */
function nextLabel(marks: Record<string, number>, key: string, count: number): Record<string, number> {
  const next = { ...marks };
  const at = key in next ? next[key] + 1 : 0;
  if (at < count) next[key] = at;
  else delete next[key];
  return next;
}

export function ConditionalRegionsComponent({ data, emit }: NodeProps<ConditionalRegionsNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = formatAnnotationStore.getForNode(data.id)?.chartFontScale;
  const colors = useSeriesColors();
  const [mode, setMode] = useState<RegionsMode>(data.mode);
  const [result, setResult] = useState<RegionsResult>(data.resultAs);
  const [marks, setMarks] = useState(data.regionMarks);
  const [labelMarks, setLabelMarks] = useState(data.regionLabels);

  const recompute = () => { data.edited(); void processGraph(); };
  const pickMode = (m: RegionsMode) => { data.mode = m; setMode(m); recompute(); };
  async function pickResult(next: RegionsResult) {
    if (next === data.resultAs) return;
    if (next === "bool") await dropInputCables(data.id, ["labels"]);
    data.setResultAs(next);
    setResult(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    recompute();
  }
  const text = result === "text";
  const labels = text ? data.cachedLabels ?? [] : null;
  const toggle = (key: string) => {
    if (labels) {
      if (!labels.length) return;
      data.regionLabels = nextLabel(data.regionLabels, key, labels.length);
      setLabelMarks(data.regionLabels);
    } else {
      data.regionMarks = nextMark(data.regionMarks, key);
      setMarks(data.regionMarks);
    }
    recompute();
  };

  const chart = data.cachedChart;
  const err = data.cachedError;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={text ? ["chart", "points", "labels"] : ["chart", "points"]} />
      <div className="solenoid-node__field-row">
        <SegToggle value={result} options={RESULT_OPTIONS} onChange={(r) => void pickResult(r)} />
        <SegToggle value={mode} options={MODE_OPTIONS} onChange={pickMode} />
      </div>
      <div className="solenoid-node__figure solenoid-node__regions" style={{ position: "relative", marginTop: 4, height: H }}>
        {err ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--chip"><ErrorChip err={err} /></div>
        ) : !chart || !data.cachedCuts ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <Suspense fallback={<div style={{ width: W, height: H }} />}>
            <RegionsFigure chart={chart} cuts={data.cachedCuts} points={data.cachedPoints ?? []} marks={text ? labelMarks : marks}
              labels={labels} width={W} height={H} fontScale={fontScale} onToggle={toggle} />
          </Suspense>
        )}
      </div>
      {labels && labels.length > 0 && !collapsed && (
        <div className="solenoid-node__region-legend">
          {labels.map((l, i) => (
            <span key={i} className="solenoid-node__region-chip">
              <span className="solenoid-node__region-swatch" style={{ background: regionLabelColor(colors, i) }} />
              {l}
            </span>
          ))}
        </div>
      )}
    </NodeShell>
  );
}

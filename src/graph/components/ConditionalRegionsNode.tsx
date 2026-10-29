import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import type { ConditionalRegionsNode as ConditionalRegionsNodeType, RegionsMode, RegionsOp } from "../nodeClasses";
import { REGIONS_MODE_META, REGIONS_OP_META } from "../nodes/visual";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle, OpToggle } from "./SegToggle";
import { TypeIcon } from "./TypeIcon";
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

const MODE_OPTIONS = (Object.keys(REGIONS_MODE_META) as RegionsMode[])
  .map((value) => ({ value, label: REGIONS_MODE_META[value].label, title: REGIONS_MODE_META[value].description }));
const OP_OPTIONS = (["bool", "text"] as const satisfies readonly RegionsOp[])
  .map((value) => ({ value, label: <TypeIcon type={value === "bool" ? "logical" : "text"} />, title: REGIONS_OP_META[value].label }));

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
  const [op, setOpState] = useState<RegionsOp>(data.op);
  const [marks, setMarks] = useState(data.regionMarks);
  const [labelMarks, setLabelMarks] = useState(data.regionLabels);

  const recompute = () => { data.edited(); void processGraph(); };
  const pickMode = (m: RegionsMode) => { data.mode = m; setMode(m); recompute(); };
  async function pickOp(next: RegionsOp) {
    if (next === data.op) return;
    if (next === "bool") await dropInputCables(data.id, ["labels"]);
    data.setOp(next);
    setOpState(next);
    await getOwningView(data.id)?.rerenderNode(data.id);
    recompute();
  }
  const text = op === "text";
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
      <OpToggle value={op} options={OP_OPTIONS} onChange={(o) => void pickOp(o)} />
      <InlineInputs node={data} emit={emit} keys={text ? ["chart", "points", "labels"] : ["chart", "points"]} />
      <SegToggle value={mode} options={MODE_OPTIONS} onChange={pickMode} />
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

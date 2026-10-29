import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import type { ConditionalRegionsNode as ConditionalRegionsNodeType, RegionsMode } from "../nodeClasses";
import { REGIONS_MODE_META } from "../nodes/visual";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { SegToggle } from "./SegToggle";
import { ErrorChip } from "./ErrorChip";
import { collapseStore } from "../collapseStore";
import { formatAnnotationStore } from "../formatAnnotationStore";
import { processGraph } from "../process";

const RegionsFigure = lazy(() => import("./chartRender").then((m) => ({ default: m.RegionsFigure })));

// Fills the wide card (240) minus body padding, as Chart does.
const W = 218;
const H = 170;

const MODE_OPTIONS = (Object.keys(REGIONS_MODE_META) as RegionsMode[])
  .map((value) => ({ value, label: REGIONS_MODE_META[value].label, title: REGIONS_MODE_META[value].description }));

/** A region cycles unmarked, TRUE, FALSE. */
function nextMarks(marks: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...marks };
  if (!(key in next)) next[key] = true;
  else if (next[key]) next[key] = false;
  else delete next[key];
  return next;
}

export function ConditionalRegionsComponent({ data, emit }: NodeProps<ConditionalRegionsNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  useSyncExternalStore(formatAnnotationStore.subscribe, formatAnnotationStore.version);
  const fontScale = formatAnnotationStore.getForNode(data.id)?.chartFontScale;
  const [mode, setMode] = useState<RegionsMode>(data.mode);
  const [marks, setMarks] = useState(data.regionMarks);

  const recompute = () => { data.edited(); void processGraph(); };
  const pickMode = (m: RegionsMode) => { data.mode = m; setMode(m); recompute(); };
  const toggle = (key: string) => {
    data.regionMarks = nextMarks(data.regionMarks, key);
    setMarks(data.regionMarks);
    recompute();
  };

  const chart = data.cachedChart;
  const err = data.cachedError;
  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["chart", "points"]} />
      <div className="solenoid-node__field-row">
        <SegToggle value={mode} options={MODE_OPTIONS} onChange={pickMode} />
      </div>
      <div className="solenoid-node__figure" style={{ position: "relative", marginTop: 4, height: H }}>
        {err ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--chip"><ErrorChip err={err} /></div>
        ) : !chart || !data.cachedCuts ? (
          <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>
        ) : !collapsed && (
          <Suspense fallback={<div style={{ width: W, height: H }} />}>
            <RegionsFigure chart={chart} cuts={data.cachedCuts} points={data.cachedPoints ?? []} marks={marks}
              width={W} height={H} fontScale={fontScale} onToggle={toggle} />
          </Suspense>
        )}
      </div>
    </NodeShell>
  );
}

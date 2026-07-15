import { useState, useSyncExternalStore } from "react";
import type { TornadoNode as TornadoNodeType } from "../rete-nodes";
import { NodeShell, ValueDisplay, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { useChartColors, TornadoBars } from "./chartView";
import { collapseStore } from "../collapseStore";
import { runTornado } from "../tornadoRun";
import { processGraph } from "../process";

// The watched value only makes sense wired (Tornado perturbs UPSTREAM of it) —
// no literal field.
const TORNADO_CABLE_ONLY = new Set(["value"]);

export function TornadoComponent({ data, emit }: NodeProps<TornadoNodeType>) {
  const [busy, setBusy] = useState(false);
  const { grid, axis } = useChartColors();
  // Collapsed → the body (recharts bars) is CSS-hidden and only the hero value
  // box shows, so drop the whole TornadoBars tree instead of leaving it mounted
  // (a full BarChart per sensitivity row). Same pattern as Chart/Histogram.
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));

  async function onRun() {
    setBusy(true);
    try {
      data.results = await runTornado(data);
    } finally {
      setBusy(false);
      void processGraph(data.id);
    }
  }

  const results = data.results ?? [];
  // The chart floor/ceiling come from the FINITE swings only; a diverged leaf
  // has no finite low/high to contribute (and would poison the min/max).
  const finiteRs = results.filter((r) => !r.diverged);
  const starts = finiteRs.map((r) => Math.min(r.low, r.high));
  const ends = finiteRs.map((r) => Math.max(r.low, r.high));
  const floor = starts.length ? Math.min(...starts) : 0;
  const ceil = ends.length ? Math.max(...ends) : floor + 1;
  const fullSpan = ceil - floor || 1;
  // recharts stacks from 0, so the "offset" spacer starts every row at the SAME
  // floor, with `range` the visible swing. A diverged row spans the full extent
  // (a muted full-width bar — "off the chart"), carrying the raw values for the
  // basis-marker tooltip.
  const normalized = results.map((r) => {
    const common = {
      label: r.label, outLow: r.low, outHigh: r.high,
      inLow: r.inputLow, inHigh: r.inputHigh, basis: r.basis,
    };
    if (r.diverged) return { ...common, offset: 0, range: fullSpan, rising: true, diverged: true };
    const start = Math.min(r.low, r.high);
    const end = Math.max(r.low, r.high);
    return { ...common, offset: start - floor, range: end - start, rising: r.high >= r.low, diverged: false };
  });

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} keys={["value"]} cableOnlyKeys={TORNADO_CABLE_ONLY} />
      {!collapsed && (
        <>
          <button
            type="button"
            className="solenoid-node__inline-input"
            disabled={busy}
            style={{ width: "100%", cursor: busy ? "default" : "pointer", textAlign: "center", opacity: busy ? 0.6 : 1 }}
            onClick={onRun}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {busy ? "Running…" : "Run sensitivity"}
          </button>
          {results.length === 0 ? (
            <div className="solenoid-node__text-empty" style={{ padding: "6px 2px" }}>
              {busy ? "perturbing upstream inputs…" : "no upstream Number/Slider inputs found yet"}
            </div>
          ) : (
            <TornadoBars data={normalized} grid={grid} axis={axis} />
          )}
        </>
      )}
      <ValueDisplay value={data.cachedResult} />
    </NodeShell>
  );
}

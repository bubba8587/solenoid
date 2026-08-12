import { useEffect, useState, useSyncExternalStore } from "react";
import type { CompositeNode as CompositeNodeType, CompositeInputNode as CompositeInputNodeType, CompositeOutputNode as CompositeOutputNodeType, CompositeRunMode } from "../rete-nodes";
import { CompositeInputNode, type CompositeStopOp } from "../nodes/composite";
import { isSolError } from "../errorValue";
import { formatScalar } from "./format";
import { isUncertain } from "../valueKinds";
import { histogram, type DistributionKind } from "../monteCarlo";
import { InlineInputs, InlineNumberField, useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, PortSockets, type NodeProps, type OpOption } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { MeasuredSocketRow } from "./NodeSocket";
import type { DisplayValue } from "./valueDisplayFormat";
import { processGraph } from "../process";
import { compositeEditorStore } from "../compositeEditorStore";
import { compositeStaleStore } from "../compositeStaleStore";
import { stopDragStart } from "../coarse";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isSvgValue } from "../svgValue";
import { isLambdaValue, formatLambda } from "../nodes/lambda";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { ChartFigure } from "./chartView";
import { MermaidView } from "./MermaidView";
import { SvgFigure } from "./SvgFigure";

/** A boundary value renders by its KIND, never stringified. */
function CompositeBoundaryValue({ value, label }: { value: unknown; label: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} full={false} />;
  if (isCubeValue(value)) return <CubeDisplay cube={value} label={label} full={false} />;
  if (isChartValue(value)) return <ChartFigure value={value} width={200} height={110} />;
  if (isMermaidValue(value)) return <MermaidView source={value.source} />;
  if (isSvgValue(value)) return <SvgFigure value={value} height={110} />;
  if (isLambdaValue(value)) return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
  return <ValueDisplay value={value as DisplayValue} />;
}

// Only modes with a real data() branch appear here — this list grows in lockstep
// with the driver, never ahead of it.
export const RUN_MODE_OPTIONS: OpOption<CompositeRunMode>[] = [
  { value: "single", label: "Single run" },
  { value: "manual", label: "Manual refresh" },
  { value: "scenarios", label: "Scenarios" },
  { value: "data-table", label: "Data table" },
  { value: "simulation", label: "Simulation" },
  { value: "goal-seek", label: "Goal seek" },
  { value: "montecarlo", label: "Monte Carlo" },
  { value: "by-row", label: "By row" },
];

// The FC's chip-foot expander pattern; open state is local, not persisted.
function AdvancedFoot({ open, onToggle, title, children }: { open: boolean; onToggle: () => void; title: string; children: React.ReactNode }) {
  return (
    <>
      {open && <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>}
      <div className="solenoid-fc__more-row">
        <button
          type="button"
          className="solenoid-fc__more"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          title={title}
          aria-expanded={open}
        >
          <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"
               style={{ display: "block", transform: open ? "rotate(180deg)" : undefined }}>
            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </>
  );
}

/** "" → undefined, which CLEARS the override back to the port's wired/default value.
 *  Scenario cells are untyped scalar overrides — ports are `any` end to end. */
function parseOverride(text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

function overrideToText(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

function ScenarioTable({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const recompute = () => { void processGraph(node.id); };
  const cols = `minmax(0,1.2fr) repeat(${exposed.length}, minmax(0,1fr)) auto`;

  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
      {exposed.length === 0 ? (
        <div className="solenoid-node__text-empty">expose an input to give scenarios something to vary</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted, #9aa0a6)" }}>
            <span>Scenario</span>
            {exposed.map((p) => <span key={p.id} title={p.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>)}
            <span />
          </div>
          {node.scenarios.map((s) => (
            <div key={s.id} style={{ display: "grid", gridTemplateColumns: cols, gap: 6, alignItems: "center" }}>
              <input
                className="solenoid-node__inline-input"
                value={s.name}
                onChange={(e) => { node.renameScenario(s.id, e.target.value); recompute(); }}
                onPointerDown={stopDragStart}
                onMouseDown={(e) => e.stopPropagation()}
                spellCheck={false}
              />
              {exposed.map((p) => (
                <input
                  key={p.id}
                  className="solenoid-node__inline-input"
                  defaultValue={overrideToText(s.overrides[p.id])}
                  placeholder="—"
                  onBlur={(e) => { node.setScenarioOverride(s.id, p.id, parseOverride(e.target.value)); recompute(); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onPointerDown={stopDragStart}
                  onMouseDown={(e) => e.stopPropagation()}
                  spellCheck={false}
                />
              ))}
              <button
                type="button"
                className="solenoid-node__row-remove"
                title="Remove scenario"
                onClick={(e) => { e.stopPropagation(); node.removeScenario(s.id); recompute(); }}
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}
      <button
        type="button"
        className="solenoid-node__add-input"
        onClick={(e) => { e.stopPropagation(); node.addScenario(); recompute(); }}
      >
        + Scenario
      </button>
    </div>
  );
}

/** "2, 4, 6.5, hot" → [2, 4, 6.5, "hot"] — one number-or-string per cell. */
function parseCsvValues(text: string): unknown[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  });
}

function valuesToCsv(values: unknown[] | undefined): string {
  return (values ?? []).join(", ");
}

// One row per exposed input port; a blank field means that port doesn't vary, so
// the sweep is a full-factorial grid over whichever ports DO carry a list.
function DataTableEditor({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const recompute = () => { void processGraph(node.id); };

  if (exposed.length === 0) {
    return <div className="solenoid-node__text-empty">expose an input to sweep it</div>;
  }
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
      {exposed.map((p) => (
        <div key={p.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.6fr)", gap: 6, alignItems: "center" }}>
          <span className="solenoid-node__io-label" title={p.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
          <input
            className="solenoid-node__inline-input"
            defaultValue={valuesToCsv(node.dataTableValues[p.id])}
            placeholder="e.g. 1, 2, 3"
            onBlur={(e) => { node.setDataTableValues(p.id, parseCsvValues(e.target.value)); recompute(); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            onPointerDown={stopDragStart}
            onMouseDown={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        </div>
      ))}
    </div>
  );
}

const STOP_OPS: ReadonlyArray<{ value: CompositeStopOp; label: string }> = [
  { value: "ge", label: "≥" },
  { value: "le", label: "≤" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
];

// Output markers are trueany and ADOPT the wired type, so the PICKER is filtered by
// the adopted socket type; unresolved wildcards stay in (a guardrail, not a gate).
const STOP_COMPARABLE = new Set(["number", "numlist", "logical", "logicalcombo", "any", "trueany"]);
function outputComparable(node: CompositeNodeType, portId: string): boolean {
  const dt = (node.outputs[portId]?.socket as { dataType?: string } | undefined)?.dataType;
  return dt === undefined || STOP_COMPARABLE.has(dt);
}

// With a stop condition the step count becomes a CAP; a logical output compares as 1/0.
function SimulationEditor({ node }: { node: CompositeNodeType }) {
  const hasStop = !!node.stopWhenPortId;
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  // Keep the current pick even if its type drifted, so the choice never vanishes.
  const candidates = node.outputPorts.filter((p) => outputComparable(node, p.id) || p.id === node.stopWhenPortId);
  return (
    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
      <span className="solenoid-node__io-label">{hasStop ? "Max steps" : "Steps"}</span>
      <InlineNumberField
        value={node.simulationSteps}
        onChange={(v) => { node.simulationSteps = v ?? 10; void processGraph(node.id); }}
      />
      {candidates.length > 0 && (
        <>
          <span className="solenoid-node__io-label">Stop when</span>
          <select
            className="solenoid-node__inline-input"
            value={node.stopWhenPortId}
            onChange={(e) => { node.stopWhenPortId = e.target.value; void processGraph(node.id); }}
            {...stop}
          >
            <option value="">— none</option>
            {candidates.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          {hasStop && (
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, alignItems: "center" }}>
              <select
                className="solenoid-node__inline-input"
                style={{ flex: "0 0 auto", width: 52 }}
                value={node.stopWhenOp}
                onChange={(e) => { node.stopWhenOp = e.target.value as CompositeStopOp; void processGraph(node.id); }}
                {...stop}
              >
                {STOP_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <InlineNumberField
                value={node.stopWhenValue}
                onChange={(v) => { node.stopWhenValue = v ?? 0; void processGraph(node.id); }}
              />
            </div>
          )}
          {/* Did the condition converge, or did it run out of steps? */}
          {hasStop && node.simLastSteps != null && (
            <div style={{ gridColumn: "1 / -1", fontSize: 10, color: "var(--text-muted)" }}>
              {node.simLastSteps < node.simulationSteps
                ? `stopped at step ${node.simLastSteps}`
                : `ran all ${node.simulationSteps} steps (never met)`}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ByRowEditor({ node }: { node: CompositeNodeType }) {
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  if (exposed.length === 0) {
    return <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>— expose an input to iterate</div>;
  }
  return (
    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
      <span className="solenoid-node__io-label">For each row of</span>
      <select
        className="solenoid-node__inline-input"
        value={node.byRowPortId}
        onChange={(e) => { node.byRowPortId = e.target.value; void processGraph(node.id); }}
        {...stop}
      >
        <option value="">— none</option>
        {exposed.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </div>
  );
}

const DIST_OPTIONS: ReadonlyArray<{ value: DistributionKind; label: string; title: string }> = [
  { value: "normal", label: "Normal", title: "Gaussian — the ± is a standard deviation (1σ)" },
  { value: "uniform", label: "Uniform", title: "Flat — the ± is a half-width around the value" },
];

function MiniHistogram({ samples }: { samples: readonly number[] }) {
  const { counts } = histogram(samples, 16);
  const peak = Math.max(1, ...counts);
  const W = 200, H = 44, n = counts.length;
  const bw = W / n;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", marginTop: 2 }}>
      {counts.map((c, i) => {
        const h = (c / peak) * (H - 2);
        return <rect key={i} x={i * bw + 0.5} y={H - h} width={Math.max(0.5, bw - 1)} height={h} fill="var(--accent)" opacity={0.75} />;
      })}
    </svg>
  );
}

function MiniSparkline({ series }: { series: readonly number[] }) {
  const nums = series.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length < 2) return null;
  const W = 200, H = 40;
  let min = Infinity, max = -Infinity;
  for (const v of nums) { if (v < min) min = v; if (v > max) max = v; }
  const span = max - min || 1;
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (W - 2) + 1;
    const y = H - 1 - ((v - min) / span) * (H - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block", marginBottom: 2 }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A plain numeric series earns a sparkline; uncertain / frame / string lists don't. */
function isNumericSeries(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

// The ± spread lives on each exposed input's drill-in marker; the seed is fixed so
// the draws are reproducible.
function MonteCarloEditor({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const [advanced, setAdvanced] = useState(false);
  const recompute = () => { void processGraph(node.id); };
  // Ensure a config exists so the advanced defaults show real numbers.
  useEffect(() => { if (!node.monteCarlo) { node.setMonteCarlo({}); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const mc = node.monteCarlo;

  if (exposed.length === 0) {
    return <div className="solenoid-node__text-empty">expose an input to give it an error bar</div>;
  }
  const markerOf = (portInternalId: string) =>
    node.internalEditor.getNode(portInternalId) as CompositeInputNode | undefined;
  const row = { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,0.9fr) auto", gap: 6, alignItems: "center" } as const;

  const distSamples = (() => {
    for (const p of node.outputPorts) {
      const v = node.cachedOutputs[p.id];
      if (isUncertain(v) && v.samples && v.samples.length > 1) return v.samples;
    }
    return null;
  })();

  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
      {exposed.map((p) => {
        const m = markerOf(p.internalNodeId);
        return (
          <div key={p.id} style={row}>
            <span className="solenoid-node__io-label" title={p.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.label}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ color: "var(--text-muted, #9aa0a6)" }}>±</span>
              <InlineNumberField
                value={m?.uncertainty ?? 0}
                onChange={(v) => { if (m) m.uncertainty = v && v > 0 ? v : null; recompute(); }}
              />
            </div>
            <SegToggle<DistributionKind> arg
              value={m?.distribution ?? "normal"}
              onChange={(d) => { if (m) m.distribution = d; recompute(); }}
              options={DIST_OPTIONS}
            />
          </div>
        );
      })}
      {distSamples && <MiniHistogram samples={distSamples} />}
      <AdvancedFoot open={advanced} onToggle={() => setAdvanced((o) => !o)} title="Sampling options">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
          <span className="solenoid-node__io-label">Samples</span>
          <InlineNumberField value={mc?.samples ?? 500} onChange={(v) => { node.setMonteCarlo({ samples: v && v >= 1 ? Math.round(v) : 500 }); recompute(); }} />
          <span className="solenoid-node__io-label">Seed</span>
          <InlineNumberField value={mc?.seed ?? 1} onChange={(v) => { node.setMonteCarlo({ seed: v != null ? Math.round(v) : 1 }); recompute(); }} />
        </div>
      </AdvancedFoot>
    </div>
  );
}

function GoalSeekEditor({ node, emit }: { node: CompositeNodeType; emit?: NodeProps<CompositeNodeType>["emit"] }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const outputs = node.outputPorts;
  const [advanced, setAdvanced] = useState(false);
  const recompute = () => { void processGraph(node.id); };
  // Initialize the config the first time the mode is entered so it solves immediately.
  useEffect(() => {
    if (!node.goalSeek && exposed.length > 0 && outputs.length > 0) { node.setGoalSeek({}); recompute(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (exposed.length === 0 || outputs.length === 0) {
    return <div className="solenoid-node__text-empty">expose a numeric input and output to goal-seek</div>;
  }
  const gs = node.goalSeek;
  const inputId = gs?.inputPortId || exposed[0].id;
  const outputId = gs?.outputPortId || outputs[0].id;
  const result = node.goalSeekResult;
  const row = { display: "grid", gridTemplateColumns: "minmax(0,0.8fr) minmax(0,1.4fr)", gap: 6, alignItems: "center" } as const;
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };
  return (
    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={row}>
        <span className="solenoid-node__io-label">Set</span>
        <select className="solenoid-node__inline-input" value={outputId} onChange={(e) => { node.setGoalSeek({ outputPortId: e.target.value }); recompute(); }} {...stop}>
          {outputs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div style={row}>
        <span className="solenoid-node__io-label">To value</span>
        <InlineNumberField value={gs?.target ?? 0} onChange={(v) => { node.setGoalSeek({ target: v ?? 0 }); recompute(); }} />
      </div>
      <div style={row}>
        <span className="solenoid-node__io-label">By changing</span>
        <select className="solenoid-node__inline-input" value={inputId} onChange={(e) => { node.setGoalSeek({ inputPortId: e.target.value }); recompute(); }} {...stop}>
          {exposed.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <AdvancedFoot open={advanced} onToggle={() => setAdvanced((o) => !o)} title="Solver options">
        <div style={row}>
          <span className="solenoid-node__io-label">Max iters</span>
          <InlineNumberField value={gs?.maxIterations ?? 80} onChange={(v) => { node.setGoalSeek({ maxIterations: v && v >= 1 ? Math.round(v) : undefined }); recompute(); }} />
        </div>
        <div style={row}>
          <span className="solenoid-node__io-label">Tolerance</span>
          <InlineNumberField value={gs?.tolerance ?? 0} placeholder="1e-7" onChange={(v) => { node.setGoalSeek({ tolerance: v && v > 0 ? v : undefined }); recompute(); }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,0.8fr) minmax(0,0.6fr) minmax(0,0.6fr)", gap: 6, alignItems: "center" }}>
          <span className="solenoid-node__io-label">Bounds</span>
          <InlineNumberField value={gs?.boundsLo ?? undefined} placeholder="lo" onChange={(v) => { node.setGoalSeek({ boundsLo: v ?? undefined }); recompute(); }} />
          <InlineNumberField value={gs?.boundsHi ?? undefined} placeholder="hi" onChange={(v) => { node.setGoalSeek({ boundsHi: v ?? undefined }); recompute(); }} />
        </div>
      </AdvancedFoot>
      {result != null && node.outputs[outputId] && (
        <div className="solenoid-composite__output" style={{ marginTop: 4 }}>
          <span className="solenoid-node__io-label">
            Solution: {exposed.find((p) => p.id === inputId)?.label ?? "input"}
          </span>
          {/* On the OUTER card (emit) the Solution carries the target port's
              output socket (wireable); inside the drill-in (no emit) it's a plain
              display — the socket belongs to the outer node, not this editor. */}
          {emit ? (
            <MeasuredSocketRow side="output" socketKey={outputId} nodeId={node.id} emit={emit} payload={node.outputs[outputId]!.socket}>
              <ValueDisplay value={result} />
            </MeasuredSocketRow>
          ) : (
            <ValueDisplay value={result} />
          )}
        </div>
      )}
    </div>
  );
}

// An SVG circle, not a CSS box — a small CSS box reads as an oval in the flex row.
function StatusDot({ state }: { state: "stale" | "failed" | "ok" }) {
  const color = state === "stale" ? "#d9822b" : state === "failed" ? "var(--sol-error)" : "var(--sock-lambda)";
  const title = state === "stale" ? "Stale" : state === "failed" ? "No solution" : "Up to date";
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" style={{ flexShrink: 0, display: "block" }}>
      <title>{title}</title>
      <circle cx="5.5" cy="5.5" r="4" fill={state === "stale" ? "none" : color} stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// Lucide "play".
const SolveSvg = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" style={{ display: "block" }}>
    <path d="M6 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 6 4.5z" />
  </svg>
);

// Lucide "refresh-cw".
const RefreshSvg = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

// Lucide "pencil".
const EditSvg = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </svg>
);

/** Shared by the outer Composite card AND the drill-in overlay; `emit` is present
 *  only outside, where the goal-seek Solution's output socket anchors. */
export function CompositeRunControls({ node, emit, insideOnly = false }: { node: CompositeNodeType; emit?: NodeProps<CompositeNodeType>["emit"]; insideOnly?: boolean }) {
  const [runMode, setRunMode] = useNodeField(node, "runMode");
  // A held composite's output doesn't change, so processGraph won't re-render it.
  useSyncExternalStore(compositeStaleStore.subscribe, compositeStaleStore.getVersion);
  const heavy = node.isHeavyMode();
  const stale = compositeStaleStore.isStale(node.id);
  const failed = heavy && runMode === "goal-seek" && isSolError(node.goalSeekResult);
  return (
    <>
      {(node.inputPorts.length > 0 || node.outputPorts.length > 0) && (
        <OpSelect arg value={runMode} options={RUN_MODE_OPTIONS} onChange={setRunMode} />
      )}
      {heavy && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
          <button
            type="button"
            className="solenoid-node__inline-input"
            style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
            onClick={(e) => { e.stopPropagation(); node.requestSolve(insideOnly); void processGraph(node.id); }}
            onPointerDown={stopDragStart}
            onMouseDown={stopDragStart}
          >
            {runMode === "manual" ? <RefreshSvg /> : <SolveSvg />}
            {runMode === "manual" ? "Refresh" : "Solve"}
          </button>
          <StatusDot state={stale ? "stale" : failed ? "failed" : "ok"} />
        </div>
      )}
      {runMode === "scenarios" && <ScenarioTable node={node} />}
      {runMode === "data-table" && <DataTableEditor node={node} />}
      {runMode === "simulation" && <SimulationEditor node={node} />}
      {runMode === "goal-seek" && <GoalSeekEditor node={node} emit={emit} />}
      {runMode === "montecarlo" && <MonteCarloEditor node={node} />}
      {runMode === "by-row" && <ByRowEditor node={node} />}
    </>
  );
}

export function CompositeComponent({ data: node, emit }: NodeProps<CompositeNodeType>) {
  const [runMode] = useNodeField(node, "runMode");

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Composite" hideOutputSockets>
      <button
        type="button"
        className="solenoid-node__inline-input"
        style={{ width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        // Open a fresh level from the canvas, drill one deeper when already editing.
        onClick={(e) => {
          e.stopPropagation();
          if (compositeEditorStore.isOpen()) compositeEditorStore.drillInto(node);
          else compositeEditorStore.open(node);
        }}
        onPointerDown={stopDragStart}
        onMouseDown={stopDragStart}
      >
        <EditSvg />
        Edit contents
      </button>
      {/* The goal-seek DRIVER shows too: its field or cable is how you feed the
          solver's SEED — the marker inside the subgraph is only a boundary. */}
      <InlineInputs node={node} emit={emit} />
      <CompositeRunControls node={node} emit={emit} />
      {/* Goal-seek's achieved output just equals the target, so its box is suppressed
          — the GoalSeekEditor owns the one hero box. */}
      {runMode !== "goal-seek" && node.outputPorts.map((p) => {
        const port = node.outputs[p.id];
        if (!port) return null;
        const value = node.cachedOutputs[p.id] ?? null;
        // MeasuredSocketRow wraps only the box, so the output dot centers on the
        // box rather than the label above it.
        return (
          <div key={p.id} className="solenoid-composite__output">
            <span className="solenoid-node__io-label">{p.label}</span>
            <MeasuredSocketRow side="output" socketKey={p.id} nodeId={node.id} emit={emit} payload={port.socket}>
              {isNumericSeries(value) && <MiniSparkline series={value} />}
              <CompositeBoundaryValue value={value} label={p.label} />
            </MeasuredSocketRow>
          </div>
        );
      })}
      {node.inputPorts.length === 0 && node.outputPorts.length === 0 && (
        <div className="solenoid-node__text-empty">no ports</div>
      )}
    </NodeShell>
  );
}

// Boundary markers render ONLY inside the drill-in editor's own rete root.

function MarkerNote({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{tag}</span>
      <span style={{ fontFamily: "var(--font-mono, var(--font-sans))", fontSize: 12 }}>{children}</span>
    </div>
  );
}

export function CompositeInputMarkerComponent({ data, emit }: NodeProps<CompositeInputNodeType>) {
  // The value this input carries when the port isn't externally wired (and the
  // goal-seek seed); a wired value or a solve overrides it.
  const field = useDraftCommit<number>(
    data.defaultValue ?? 0,
    String,
    (t) => {
      if (t.trim() === "") return 0;
      const n = Number(t);
      return Number.isFinite(n) ? n : INVALID_DRAFT;
    },
    (v) => { data.defaultValue = v; void processGraph(); },
  );
  return (
    <NodeShell node={data} emit={emit} collapsible={false} labelPlaceholder="Input" className="solenoid-node--composite-marker">
      {data.externallyWired ? (
        // Fed from outside — a number field can't represent a wired list/frame.
        <CompositeBoundaryValue value={data.value} label={data.label} />
      ) : (
        <input
          className="solenoid-node__value-input"
          type="number"
          value={field.draft}
          onChange={(e) => field.setDraft(e.target.value)}
          onBlur={field.onBlur}
          onKeyDown={field.onKeyDown}
          step="any"
        />
      )}
      {/* The solver's answer shows here rather than overwriting the seed above. */}
      {data.goalDriver && (
        <MarkerNote tag="solves to">
          {data.solvedValue == null ? <span style={{ color: "var(--text-muted)" }}>—</span>
            : isSolError(data.solvedValue) ? <span style={{ color: "var(--sol-error)" }}>no solution</span>
            : <b>{formatScalar(data.solvedValue)}</b>}
        </MarkerNote>
      )}
      {data.modeNote && <MarkerNote tag={data.modeNote.tag}>{data.modeNote.text}</MarkerNote>}
    </NodeShell>
  );
}

export function CompositeOutputMarkerComponent({ data, emit }: NodeProps<CompositeOutputNodeType>) {
  return (
    <NodeShell
      node={data}
      emit={emit}
      collapsible={false}
      labelPlaceholder="Output"
      className="solenoid-node--composite-marker"
      leading={<PortSockets node={data} emit={emit} side="input" />}
    >
      {isNumericSeries(data.cachedResult) && <MiniSparkline series={data.cachedResult} />}
      <CompositeBoundaryValue value={data.cachedResult} label={data.label} />
      {data.goalTarget != null && <MarkerNote tag="target">{formatScalar(data.goalTarget)}</MarkerNote>}
    </NodeShell>
  );
}

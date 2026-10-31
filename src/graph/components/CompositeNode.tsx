// [[C77]] compositeIsSubgraph. Mechanics: tree/specs/canvas/composite-drill-in-mount-lifecycle.md.
import { useEffect, useSyncExternalStore } from "react";
import type { CompositeNode as CompositeNodeType, CompositeInputNode as CompositeInputNodeType, CompositeOutputNode as CompositeOutputNodeType, CompositeRunMode } from "../nodeClasses";
import { CompositeInputNode, type CompositeStopOp } from "../nodes/composite";
import { isSolError } from "../errorValue";
import { formatScalar } from "./format";
import { isUncertain } from "../valueKinds";
import { histogram, type DistributionKind } from "../monteCarlo";
import { InlineInputs, InlineNumberField, useDraftCommit, INVALID_DRAFT } from "./inlineInput";
import { NodeShell, ValueDisplay, ArgSelect, useNodeField, PortSockets, type NodeProps, type OpOption } from "./nodeKit";
import { SegToggle } from "./SegToggle";
import { CardSection } from "./CardSection";
import { MeasuredSocketRow } from "./NodeSocket";
import type { DisplayValue } from "./valueDisplayFormat";
import { processGraph } from "../process";
import { compositeEditorStore } from "../compositeEditorStore";
import { compositeStaleStore } from "../compositeStaleStore";
import { connectionStore } from "../connectionStore";
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
import { nodeDisplayName } from "../catalogUtils";

function CompositeBoundaryValue({ value, label }: { value: unknown; label: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} full={false} />;
  if (isCubeValue(value)) return <CubeDisplay cube={value} label={label} full={false} />;
  if (isChartValue(value)) return <ChartFigure value={value} width={200} height={110} />;
  if (isMermaidValue(value)) return <MermaidView source={value.source} />;
  if (isSvgValue(value)) return <SvgFigure value={value} height={110} />;
  if (isLambdaValue(value)) return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
  return <ValueDisplay value={value as DisplayValue} />;
}

// Only modes with a real data() branch; this list grows in lockstep with the driver, never ahead of it.
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

/** "" gives undefined, which clears the override back to the port's wired or default value. */
function parseOverride(text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

function overrideToText(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

function DraftField({ value, placeholder, toText, parse, apply, text = false }: {
  value: unknown;
  placeholder?: string;
  text?: boolean;
  toText: (v: unknown) => string;
  parse: (t: string) => unknown;
  apply: (v: unknown) => void;
}) {
  const field = useDraftCommit(value, toText, parse, apply);
  return (
    <input
      className={`solenoid-node__inline-input${text ? " solenoid-composite__text" : ""}`}
      value={field.draft}
      placeholder={placeholder}
      onChange={(e) => field.setDraft(e.target.value)}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
      spellCheck={false}
    />
  );
}

function ScenarioTable({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const recompute = () => { void processGraph(node.id); };
  const cols = `minmax(0,1.2fr) repeat(${exposed.length}, minmax(0,1fr)) auto`;

  return (
    <div className="solenoid-composite__editor">
      {exposed.length === 0 ? (
        <div className="solenoid-node__text-empty">expose an input to give scenarios something to vary</div>
      ) : (
        <>
          <div className="solenoid-composite__grid solenoid-composite__colheads" style={{ gridTemplateColumns: cols }}>
            <span>Scenario</span>
            {exposed.map((p) => <span key={p.id} title={p.label}>{p.label}</span>)}
            <span />
          </div>
          {node.scenarios.map((s) => (
            <div key={s.id} className="solenoid-composite__grid" style={{ gridTemplateColumns: cols }}>
              <DraftField
                text
                value={s.name}
                toText={(v) => String(v ?? "")}
                parse={(t) => t}
                apply={(v) => { node.renameScenario(s.id, String(v)); recompute(); }}
              />
              {exposed.map((p) => (
                <DraftField
                  key={p.id}
                  value={s.overrides[p.id]}
                  placeholder="—"
                  toText={overrideToText}
                  parse={parseOverride}
                  apply={(v) => { node.setScenarioOverride(s.id, p.id, v); recompute(); }}
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
        onPointerDown={stopDragStart}
      >
        Add Scenario
      </button>
    </div>
  );
}

function parseCsvValues(text: string): unknown[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  });
}

function valuesToCsv(values: unknown[] | undefined): string {
  return (values ?? []).join(", ");
}

function DataTableEditor({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const recompute = () => { void processGraph(node.id); };

  if (exposed.length === 0) {
    return <div className="solenoid-node__text-empty">expose an input to sweep it</div>;
  }
  return (
    <div className="solenoid-composite__editor">
      {exposed.map((p) => (
        <div key={p.id} className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label" title={p.label}>{p.label}</span>
          <input
            className="solenoid-node__inline-input"
            defaultValue={valuesToCsv(node.dataTableValues[p.id])}
            placeholder="for example, 1, 2, 3"
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

// Output markers adopt the wired type, so the picker filters by it; unresolved wildcards stay in (a guardrail, not a gate).
const STOP_COMPARABLE = new Set(["number", "numlist", "logical", "logicalcombo", "any", "trueany"]);
function outputComparable(node: CompositeNodeType, portId: string): boolean {
  const dt = (node.outputs[portId]?.socket as { dataType?: string } | undefined)?.dataType;
  return dt === undefined || STOP_COMPARABLE.has(dt);
}

function SimulationEditor({ node }: { node: CompositeNodeType }) {
  const hasStop = !!node.stopWhenPortId;
  // Keep the current pick even if its type drifted, so the choice never vanishes.
  const candidates = node.outputPorts.filter((p) => outputComparable(node, p.id) || p.id === node.stopWhenPortId);
  const stopOptions: OpOption<string>[] = [{ value: "", label: "None" }, ...candidates.map((p) => ({ value: p.id, label: p.label }))];
  return (
    <div className="solenoid-composite__editor">
      <div className="solenoid-node__field-row solenoid-composite__row">
        <span className="solenoid-node__field-label">{hasStop ? "Max steps" : "Steps"}</span>
        <InlineNumberField
          value={node.simulationSteps}
          onChange={(v) => { node.simulationSteps = v ?? 10; void processGraph(node.id); }}
        />
      </div>
      {candidates.length > 0 && (
        <>
          <div className="solenoid-node__field-row solenoid-composite__row">
            <span className="solenoid-node__field-label">Stop when</span>
            <ArgSelect value={node.stopWhenPortId} options={stopOptions} onChange={(v) => { node.stopWhenPortId = v; void processGraph(node.id); }} />
          </div>
          {hasStop && (
            <div className="solenoid-node__field-row solenoid-composite__row">
              <span className="solenoid-composite__op">
                <ArgSelect<CompositeStopOp> value={node.stopWhenOp} options={STOP_OPS} onChange={(v) => { node.stopWhenOp = v; void processGraph(node.id); }} />
              </span>
              <InlineNumberField
                value={node.stopWhenValue}
                onChange={(v) => { node.stopWhenValue = v ?? 0; void processGraph(node.id); }}
              />
            </div>
          )}
          {hasStop && node.simLastSteps != null && (
            <div className="solenoid-composite__note">
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
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  if (exposed.length === 0) {
    return <div className="solenoid-node__text-empty">expose an input to iterate</div>;
  }
  const options: OpOption<string>[] = [{ value: "", label: "None" }, ...exposed.map((p) => ({ value: p.id, label: p.label }))];
  return (
    <div className="solenoid-composite__editor">
      <div className="solenoid-node__field-row solenoid-composite__row">
        <span className="solenoid-node__field-label">For each row of</span>
        <ArgSelect value={node.byRowPortId} options={options} onChange={(v) => { node.byRowPortId = v; void processGraph(node.id); }} />
      </div>
    </div>
  );
}

const DIST_OPTIONS: ReadonlyArray<{ value: DistributionKind; label: string; title: string }> = [
  { value: "normal", label: "Normal", title: "Gaussian: the ± is one standard deviation (1σ)" },
  { value: "uniform", label: "Uniform", title: "Flat: the ± is a half-width around the value" },
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
        return <rect key={i} x={i * bw + 0.5} y={H - h} width={Math.max(0.5, bw - 1)} height={h} fill="var(--node-accent, var(--accent))" opacity={0.75} />;
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
      <polyline points={pts} fill="none" stroke="var(--node-accent, var(--accent))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function isNumericSeries(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

function MonteCarloEditor({ node }: { node: CompositeNodeType }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const recompute = () => { void processGraph(node.id); };
  useEffect(() => { if (!node.monteCarlo) { node.setMonteCarlo({}); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const mc = node.monteCarlo;

  if (exposed.length === 0) {
    return <div className="solenoid-node__text-empty">expose an input to give it an error bar</div>;
  }
  const markerOf = (portInternalId: string) =>
    node.internalEditor.getNode(portInternalId) as CompositeInputNode | undefined;

  const distSamples = (() => {
    for (const p of node.outputPorts) {
      const v = node.cachedOutputs[p.id];
      if (isUncertain(v) && v.samples && v.samples.length > 1) return v.samples;
    }
    return null;
  })();
  const dropped = node.outputPorts.reduce((m, p) => {
    const v = node.cachedOutputs[p.id];
    return isUncertain(v) && v.dropped ? Math.max(m, v.dropped) : m;
  }, 0);
  const drawCount = Math.max(1, Math.round(mc?.samples ?? 0));

  const sampled = (mc?.samples ?? 500) !== 500 || (mc?.seed ?? 1) !== 1 || !!mc?.correlations;
  return (
    <div className="solenoid-composite__editor">
      {dropped > 0 && (
        <div className="solenoid-node__text-empty">{drawCount - dropped} of {drawCount} draws</div>
      )}
      {exposed.map((p) => {
        const m = markerOf(p.internalNodeId);
        return (
          <div key={p.id} className="solenoid-composite__mc-input">
            <div className="solenoid-node__field-row solenoid-composite__row">
              <span className="solenoid-node__field-label" title={p.label}>{p.label}</span>
              <span className="solenoid-composite__pm" aria-hidden="true">±</span>
              <InlineNumberField
                value={m?.uncertainty ?? 0}
                onChange={(v) => { if (m) m.uncertainty = v && v > 0 ? v : null; recompute(); }}
              />
            </div>
            <SegToggle<DistributionKind>
              value={m?.distribution ?? "normal"}
              onChange={(d) => { if (m) m.distribution = d; recompute(); }}
              options={DIST_OPTIONS}
            />
          </div>
        );
      })}
      {distSamples && <MiniHistogram samples={distSamples} />}
      <CardSection label="Sampling" collapsible defaultOpen={sampled}>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label">Samples</span>
          <InlineNumberField value={mc?.samples ?? 500} onChange={(v) => { node.setMonteCarlo({ samples: v && v >= 1 ? Math.round(v) : 500 }); recompute(); }} />
        </div>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label">Seed</span>
          <InlineNumberField value={mc?.seed ?? 1} onChange={(v) => { node.setMonteCarlo({ seed: v != null ? Math.round(v) : 1 }); recompute(); }} />
        </div>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label" title="Correlate inputs with a Gaussian copula: label ~ label = ρ, several separated by semicolons. Each input keeps its own ± and shape; only the dependence changes.">Correlations</span>
          <DraftField
            text
            value={mc?.correlations ?? ""}
            toText={(v) => String(v ?? "")}
            parse={(t) => t}
            apply={(v) => { node.setMonteCarlo({ correlations: String(v) }); recompute(); }}
            placeholder={exposed.length >= 2 ? `${exposed[0].label} ~ ${exposed[1].label} = 0.7` : "a ~ b = 0.7"}
          />
        </div>
      </CardSection>
    </div>
  );
}

function GoalSeekEditor({ node, emit }: { node: CompositeNodeType; emit?: NodeProps<CompositeNodeType>["emit"] }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const outputs = node.outputPorts;
  const recompute = () => { void processGraph(node.id); };
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
  const tuned = gs?.maxIterations != null || gs?.tolerance != null || gs?.boundsLo != null || gs?.boundsHi != null;
  return (
    <div className="solenoid-composite__editor">
      <div className="solenoid-node__field-row solenoid-composite__row">
        <span className="solenoid-node__field-label">Set</span>
        <ArgSelect value={outputId} options={outputs.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => { node.setGoalSeek({ outputPortId: v }); recompute(); }} />
      </div>
      <div className="solenoid-node__field-row solenoid-composite__row">
        <span className="solenoid-node__field-label">To value</span>
        <InlineNumberField value={gs?.target ?? 0} onChange={(v) => { node.setGoalSeek({ target: v ?? 0 }); recompute(); }} />
      </div>
      <div className="solenoid-node__field-row solenoid-composite__row">
        <span className="solenoid-node__field-label">By changing</span>
        <ArgSelect value={inputId} options={exposed.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => { node.setGoalSeek({ inputPortId: v }); recompute(); }} />
      </div>
      <CardSection label="Solver" collapsible defaultOpen={tuned}>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label">Max iters</span>
          <InlineNumberField value={gs?.maxIterations ?? 80} onChange={(v) => { node.setGoalSeek({ maxIterations: v && v >= 1 ? Math.round(v) : undefined }); recompute(); }} />
        </div>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label">Tolerance</span>
          <InlineNumberField value={gs?.tolerance ?? 0} placeholder="1e-7" onChange={(v) => { node.setGoalSeek({ tolerance: v && v > 0 ? v : undefined }); recompute(); }} />
        </div>
        <div className="solenoid-node__field-row solenoid-composite__row">
          <span className="solenoid-node__field-label">Bounds</span>
          <InlineNumberField value={gs?.boundsLo ?? undefined} placeholder="lo" onChange={(v) => { node.setGoalSeek({ boundsLo: v ?? undefined }); recompute(); }} />
          <InlineNumberField value={gs?.boundsHi ?? undefined} placeholder="hi" onChange={(v) => { node.setGoalSeek({ boundsHi: v ?? undefined }); recompute(); }} />
        </div>
      </CardSection>
      {result != null && node.outputs[outputId] && (
        <div className="solenoid-composite__output solenoid-node__io-row--output">
          <span className="solenoid-node__io-label">
            Solution: {exposed.find((p) => p.id === inputId)?.label ?? "input"}
          </span>
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

function formatRunTime(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

// An SVG circle: a small CSS box reads as an oval in the flex row.
function StatusDot({ state }: { state: "stale" | "failed" | "ok" }) {
  const color = state === "stale" ? "var(--sol-warn)" : state === "failed" ? "var(--sol-error)" : "var(--sol-ok)";
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

export function CompositeRunControls({ node, emit, insideOnly = false }: { node: CompositeNodeType; emit?: NodeProps<CompositeNodeType>["emit"]; insideOnly?: boolean }) {
  const [runMode, setRunMode] = useNodeField(node, "runMode");
  // A held composite's output doesn't change, so processGraph won't re-render it.
  useSyncExternalStore(compositeStaleStore.subscribe, compositeStaleStore.getVersion);
  useSyncExternalStore(connectionStore.subscribe, connectionStore.version);
  const heavy = node.isHeavyMode();
  const gated = heavy && node.gatedInside();
  const stale = compositeStaleStore.isStale(node.id);
  const failed = heavy && runMode === "goal-seek" && isSolError(node.goalSeekResult);
  const lastRunMs = compositeStaleStore.lastRunMs(node.id);
  return (
    <>
      {(node.inputPorts.length > 0 || node.outputPorts.length > 0) && (
        <ArgSelect value={runMode} options={RUN_MODE_OPTIONS} onChange={setRunMode} />
      )}
      {heavy && (
        <div className="solenoid-composite__solve">
          <button
            type="button"
            className="solenoid-node__recalc-btn"
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
      {heavy && lastRunMs !== null && (
        <div className="solenoid-composite__note">last run {formatRunTime(lastRunMs)}</div>
      )}
      {gated && (
        <div className="sol-conn__status-text" style={{ marginTop: 4 }} title="Waiting for permission. Allow this document to connect in Settings ▸ Data.">
          Waiting for permission
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
    <NodeShell node={node} emit={emit} hideOutputSockets>
      <button
        type="button"
        className="solenoid-node__recalc-btn solenoid-composite__edit"
        onClick={(e) => {
          e.stopPropagation();
          if (compositeEditorStore.isOpen()) compositeEditorStore.drillInto(node);
          else compositeEditorStore.open(node);
        }}
        onPointerDown={stopDragStart}
        onMouseDown={stopDragStart}
      >
        <EditSvg />
        Edit Contents
      </button>
      <InlineInputs node={node} emit={emit} />
      <CompositeRunControls node={node} emit={emit} />
      {runMode !== "goal-seek" && node.outputPorts.map((p) => {
        const port = node.outputs[p.id];
        if (!port) return null;
        const value = node.cachedOutputs[p.id] ?? null;
        // MeasuredSocketRow wraps only the box, so the output dot centers on the box, not the label.
        return (
          <div key={p.id} className="solenoid-composite__output solenoid-node__io-row--output">
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


function MarkerNote({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 4 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 9, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>{tag}</span>
      <span style={{ fontFamily: "var(--font-mono, var(--font-sans))", fontSize: 12 }}>{children}</span>
    </div>
  );
}

export function CompositeInputMarkerComponent({ data, emit }: NodeProps<CompositeInputNodeType>) {
  const field = useDraftCommit<number>(
    data.defaultValue ?? 0,
    String,
    (t) => {
      if (t.trim() === "") return 0;
      const n = Number(t);
      return Number.isFinite(n) ? n : INVALID_DRAFT;
    },
    (v) => { data.defaultValue = v; data.edited(); void processGraph(); },
  );
  return (
    <NodeShell node={data} emit={emit} collapsible={false} labelPlaceholder="Input" className="solenoid-node--composite-marker">
      {data.externallyWired ? (
        <CompositeBoundaryValue value={data.value} label={nodeDisplayName(data)} />
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
      <CompositeBoundaryValue value={data.cachedResult} label={nodeDisplayName(data)} />
      {data.goalTarget != null && <MarkerNote tag="target">{formatScalar(data.goalTarget)}</MarkerNote>}
    </NodeShell>
  );
}

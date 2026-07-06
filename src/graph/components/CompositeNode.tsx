import { useEffect, useSyncExternalStore } from "react";
import type { CompositeNode as CompositeNodeType, CompositeInputNode as CompositeInputNodeType, CompositeOutputNode as CompositeOutputNodeType, CompositeRunMode } from "../rete-nodes";
import { isSolError } from "../errorValue";
import { InlineInputs, InlineNumberField } from "./inlineInput";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, PortSockets, type NodeProps, type OpOption } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import type { DisplayValue } from "./valueDisplayFormat";
import { processGraph } from "../process";
import { compositeEditorStore } from "../compositeEditorStore";
import { compositeStaleStore } from "../compositeStaleStore";
import { stopDragStart } from "../coarse";
import { isFrameValue, isCubeValue } from "../frame";
import { isChartValue } from "../chartValue";
import { isMermaidValue } from "../mermaidValue";
import { isLambdaValue, formatLambda } from "../nodes/lambda";
import { FrameDisplay } from "./FrameDisplay";
import { CubeDisplay } from "./CubeDisplay";
import { ChartFigure } from "./chartView";
import { MermaidView } from "./MermaidView";

/**
 * The value a Composite boundary carries (a port output, or an input/output
 * marker in the drill-in) — rendered by its KIND, not stringified. A frame/cube
 * shows the same compact table preview as everywhere else (the old code fell back
 * to `[object Object]`); a chart/mermaid renders its figure; a lambda its
 * signature; scalars/lists/logicals/errors keep the hero ValueDisplay box.
 */
function CompositeBoundaryValue({ value, label }: { value: unknown; label: string }) {
  if (isFrameValue(value)) return <FrameDisplay frame={value} label={label} full={false} />;
  if (isCubeValue(value)) return <CubeDisplay cube={value} label={label} full={false} />;
  if (isChartValue(value)) return <ChartFigure value={value} width={200} height={110} />;
  if (isMermaidValue(value)) return <MermaidView source={value.source} />;
  if (isLambdaValue(value)) return <div className="solenoid-node__display-value">{formatLambda(value)}</div>;
  return <ValueDisplay value={value as DisplayValue} />;
}

// Only modes with a real data() branch appear here — see the CompositeRunMode
// union's own comment (nodes/composite.ts) for why the list grows in lockstep
// with the driver, not ahead of it.
const RUN_MODE_OPTIONS: OpOption<CompositeRunMode>[] = [
  { value: "single", label: "Single run" },
  { value: "scenarios", label: "Scenarios" },
  { value: "data-table", label: "Data table" },
  { value: "simulation", label: "Simulation" },
  { value: "goal-seek", label: "Goal seek" },
];

/** "3.5" → 3.5; "" → undefined (clears the override, falls back to the port's
 *  normal wired/default value); anything else stays a string. Scenario cells
 *  are a general-purpose scalar override, not type-checked against the port
 *  (ports are `any` end to end — see nodes/composite.ts). */
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
                onPointerDown={(e) => e.stopPropagation()}
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
                  onPointerDown={(e) => e.stopPropagation()}
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

/** "2, 4, 6.5, hot" → [2, 4, 6.5, "hot"] — same number-or-string-per-cell
 *  parsing as a scenario override, applied to a comma-separated sweep list. */
function parseCsvValues(text: string): unknown[] {
  return text.split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  });
}

function valuesToCsv(values: unknown[] | undefined): string {
  return (values ?? []).join(", ");
}

// One row per exposed input port: a CSV field of sweep values. Blank = this
// port doesn't vary (a full-factorial grid over whichever ports DO have a
// list — 1 varying port is Excel's one-variable Data Table, 2 is the
// two-variable grid, N generalizes past that).
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
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            spellCheck={false}
          />
        </div>
      ))}
    </div>
  );
}

// Simulation's only container-level parameter: how many feedback steps to
// run. A loop-bound output collects one entry per step (the time series);
// see nodes/composite.ts runSimulation for the algorithm.
function SimulationEditor({ node }: { node: CompositeNodeType }) {
  return (
    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6, alignItems: "center" }}>
      <span className="solenoid-node__io-label">Steps</span>
      <InlineNumberField
        value={node.simulationSteps}
        onChange={(v) => { node.simulationSteps = v ?? 10; void processGraph(node.id); }}
      />
    </div>
  );
}

// Goal-seek: drive one exposed input until a chosen output hits a target (Excel's
// Goal Seek). Reads "Set <output> To <value> By changing <input>"; the solved driver
// value (or #CONV!) shows below. The solve runs in composite.ts runGoalSeek.
function GoalSeekEditor({ node, emit }: { node: CompositeNodeType; emit: NodeProps<CompositeNodeType>["emit"] }) {
  const exposed = node.inputPorts.filter((p) => p.exposure === "exposed");
  const outputs = node.outputPorts;
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
      {result != null && node.outputs[outputId] && (
        // The solved driver value is the HERO of a goal-seek composite (the whole
        // point — the achieved output just equals the target you set). It carries the
        // target output port's socket, so the composite's OUTPUT is its solution:
        // the Solution value is wireable downstream (composite.ts runGoalSeek emits
        // the solved driver on this port).
        <div className="solenoid-composite__output" style={{ marginTop: 4 }}>
          <span className="solenoid-node__io-label">
            Solution — {exposed.find((p) => p.id === inputId)?.label ?? "input"}
          </span>
          <MeasuredSocketRow side="output" socketKey={outputId} nodeId={node.id} emit={emit} payload={node.outputs[outputId]!.socket}>
            {isSolError(result)
              ? <div className="solenoid-node__display-value" style={{ color: "var(--sol-error)" }}>{result.code}</div>
              : <ValueDisplay value={result} />}
          </MeasuredSocketRow>
        </div>
      )}
    </div>
  );
}

// The Composite card: an editable title (NodeShell), one row per exposed
// input (InlineInputs — reuses the generic input-row renderer off
// node.inputs; every port socket is `any`, so a row is socket+label, or a
// "↩ <source>" marker once wired), a run-mode selector, the Scenarios editor
// when that mode is active, and one row per output (custom, since
// ValueDisplay doesn't know about frame/cube previews — a v1 gap noted below).
// In Scenarios mode each output's cachedOutputs value is already an ARRAY
// (one entry per scenario, in order) — ValueDisplay renders that as a list
// chip with no changes needed here, which is the "lay outputs side by side".
// Lucide "play" — the Solve trigger for arm-and-run heavy modes.
const SolveSvg = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" style={{ display: "block" }}>
    <path d="M6 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 6 4.5z" />
  </svg>
);

// Lucide "pencil" — the drill-in trigger. https://lucide.dev/icons/pencil
const EditSvg = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </svg>
);

export function CompositeComponent({ data: node, emit }: NodeProps<CompositeNodeType>) {
  const [runMode, setRunMode] = useNodeField(node, "runMode");
  // Heavy modes are arm-and-run: an explicit Solve, with an orange "stale" dot when
  // inputs/config drifted since the last solve (compositeStaleStore drives the dot —
  // a held composite's output doesn't change, so processGraph won't re-render it).
  useSyncExternalStore(compositeStaleStore.subscribe, compositeStaleStore.getVersion);
  const heavy = node.isHeavyMode();
  const stale = compositeStaleStore.isStale(node.id);
  // Goal-seek failure IS detectable (#CONV! → a SolError on goalSeekResult), so the
  // status circle gets a red "no solution" state on top of stale/solved.
  const failed = heavy && runMode === "goal-seek" && isSolError(node.goalSeekResult);
  // In goal-seek the DRIVER input is solved-for, not fed — its value is overridden by
  // the solve — so hide its socket. The other exposed inputs are real held parameters.
  const inputKeys = runMode === "goal-seek" && node.goalSeek
    ? Object.keys(node.inputs).filter((k) => k !== node.goalSeek!.inputPortId)
    : undefined;

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Composite" hideOutputSockets>
      <button
        type="button"
        className="solenoid-node__inline-input"
        style={{ width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        // Same button on the main canvas AND on a composite card shown INSIDE the
        // drill-in: open a fresh level from the canvas, drill one deeper when
        // already editing (multi-layer). The breadcrumb tracks the chain.
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
      <InlineInputs node={node} emit={emit} keys={inputKeys} />
      {(node.inputPorts.length > 0 || node.outputPorts.length > 0) && (
        <OpSelect value={runMode} options={RUN_MODE_OPTIONS} onChange={setRunMode} />
      )}
      {heavy && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
          <button
            type="button"
            className="solenoid-node__inline-input"
            style={{ flex: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
            onClick={(e) => { e.stopPropagation(); node.requestSolve(); void processGraph(node.id); }}
            onPointerDown={stopDragStart}
            onMouseDown={stopDragStart}
          >
            <SolveSvg />
            Solve
          </button>
          {/* Status circle — ALWAYS present (so it never resizes the Solve button):
              an amber RING while stale (alert-badge amber #d9822b), a filled RED
              (--sol-error) when the solve found no solution, else filled GREEN
              (--sock-lambda, the semantic positive) once solved / up to date. */}
          {(() => {
            const color = stale ? "#d9822b" : failed ? "var(--sol-error)" : "var(--sock-lambda)";
            const title = stale ? "Stale" : failed ? "No solution" : "Up to date";
            return (
              <span
                title={title}
                style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0, boxSizing: "border-box",
                  border: `1.5px solid ${color}`,
                  background: stale ? "transparent" : color,
                }}
              />
            );
          })()}
        </div>
      )}
      {runMode === "scenarios" && <ScenarioTable node={node} />}
      {runMode === "data-table" && <DataTableEditor node={node} />}
      {runMode === "simulation" && <SimulationEditor node={node} />}
      {runMode === "goal-seek" && <GoalSeekEditor node={node} emit={emit} />}
      {/* Goal-seek's Solution is the sole hero — the achieved output just equals
          the target you set, so its value box is redundant and suppressed here
          (the GoalSeekEditor above owns the one hero box). */}
      {runMode !== "goal-seek" && node.outputPorts.map((p) => {
        const port = node.outputs[p.id];
        if (!port) return null;
        const value = node.cachedOutputs[p.id] ?? null;
        // Label ABOVE its value box, stacked — a hero ValueDisplay box is too tall
        // to sit horizontally beside a label in a compact io-row (it pushed the box
        // off the card). The MeasuredSocketRow wraps only the box (height:auto via
        // --output modifier), so the output dot centers on the box, not the label.
        return (
          <div key={p.id} className="solenoid-composite__output">
            <span className="solenoid-node__io-label">{p.label}</span>
            <MeasuredSocketRow side="output" socketKey={p.id} nodeId={node.id} emit={emit} payload={port.socket}>
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

// ─── Boundary markers (drill-in editor only) ───────────────────────────────────
// These render ONLY inside the Composite drill-in editor's own rete root — the
// markers never live on the main canvas. A marker's value can be anything the
// `any` boundary carries; CompositeBoundaryValue renders every kind (frame/cube
// tables, chart/mermaid figures, lambda, scalars/lists/errors).

export function CompositeInputMarkerComponent({ data, emit }: NodeProps<CompositeInputNodeType>) {
  return (
    <NodeShell node={data} emit={emit} collapsible={false} labelPlaceholder="Input" className="solenoid-node--composite-marker">
      <CompositeBoundaryValue value={data.value} label={data.label} />
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
      <CompositeBoundaryValue value={data.cachedResult} label={data.label} />
    </NodeShell>
  );
}

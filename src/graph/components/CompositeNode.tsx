import type { CompositeNode as CompositeNodeType, CompositeRunMode } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, ValueDisplay, OpSelect, useNodeField, type NodeProps, type OpOption } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import type { DisplayValue } from "./valueDisplayFormat";
import { processGraph } from "../process";

// Only modes with a real data() branch appear here — see the CompositeRunMode
// union's own comment (nodes/composite.ts) for why the list grows in lockstep
// with the driver, not ahead of it.
const RUN_MODE_OPTIONS: OpOption<CompositeRunMode>[] = [
  { value: "single", label: "Single run" },
  { value: "scenarios", label: "Scenarios" },
  { value: "data-table", label: "Data table" },
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

// The Composite card: an editable title (NodeShell), one row per exposed
// input (InlineInputs — reuses the generic input-row renderer off
// node.inputs; every port socket is `any`, so a row is socket+label, or a
// "↩ <source>" marker once wired), a run-mode selector, the Scenarios editor
// when that mode is active, and one row per output (custom, since
// ValueDisplay doesn't know about frame/cube previews — a v1 gap noted below).
// In Scenarios mode each output's cachedOutputs value is already an ARRAY
// (one entry per scenario, in order) — ValueDisplay renders that as a list
// chip with no changes needed here, which is the "lay outputs side by side".
export function CompositeComponent({ data: node, emit }: NodeProps<CompositeNodeType>) {
  const [runMode, setRunMode] = useNodeField(node, "runMode");

  return (
    <NodeShell node={node} emit={emit} labelPlaceholder="Composite" hideOutputSockets>
      <InlineInputs node={node} emit={emit} />
      {(node.inputPorts.length > 0 || node.outputPorts.length > 0) && (
        <OpSelect value={runMode} options={RUN_MODE_OPTIONS} onChange={setRunMode} />
      )}
      {runMode === "scenarios" && <ScenarioTable node={node} />}
      {runMode === "data-table" && <DataTableEditor node={node} />}
      {node.outputPorts.map((p) => {
        const port = node.outputs[p.id];
        if (!port) return null;
        const value = node.cachedOutputs[p.id] ?? null;
        return (
          <MeasuredSocketRow key={p.id} side="output" socketKey={p.id} nodeId={node.id} emit={emit} payload={port.socket}>
            <span className="solenoid-node__io-label">{p.label}</span>
            {/* Scalar/list/error/logical render correctly; a frame/cube output
                falls back to a plain object stringification — a known gap for
                the shell milestone (frame-holding composites are a follow-up). */}
            <ValueDisplay value={value as unknown as DisplayValue} />
          </MeasuredSocketRow>
        );
      })}
      {node.inputPorts.length === 0 && node.outputPorts.length === 0 && (
        <div className="solenoid-node__text-empty">no ports</div>
      )}
    </NodeShell>
  );
}

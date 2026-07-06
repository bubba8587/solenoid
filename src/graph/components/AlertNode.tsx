import type { AlertNode as AlertNodeType, AlertMode } from "../rete-nodes";
import { ALERT_MODE_KEYS } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { getActiveEditor } from "../activeGraph";

// The trigger condition. Picking one swaps which input rows show (ALERT_MODE_KEYS)
// and what makes the alert fire.
const MODES: { value: AlertMode; label: string }[] = [
  { value: "range",   label: "Out of range" },
  { value: "equals",  label: "Equals" },
  { value: "boolean", label: "Is true" },
  { value: "text",    label: "Text contains" },
];

// Neutral status wording for the value box — an Alert just reports whether its
// watched condition currently holds; it's not a pass/fail. Calm reads gray, met
// reads amber. No ✓/⚠ (those imply good vs bad).
const STATUS: Record<AlertMode, { calm: string; met: (v: number) => string }> = {
  range:   { calm: "in range", met: (v) => (v === 1 ? "below" : "above") },
  equals:  { calm: "no match", met: () => "equal" },
  boolean: { calm: "false",    met: () => "true" },
  text:    { calm: "no match", met: () => "match" },
};

const CALM_COLOR = "#7a8290";
const MET_COLOR = "#d9822b";

export function AlertComponent({ data, emit }: NodeProps<AlertNodeType>) {
  const [mode, setMode] = useNodeField(data, "mode");
  const shownKeys = ALERT_MODE_KEYS[mode];

  async function handleModeChange(next: AlertMode) {
    // Inputs that leave the active set are about to be hidden — drop any cable
    // wired to them so it doesn't dangle to an unrendered socket (same as TVM).
    const keep = new Set(ALERT_MODE_KEYS[next]);
    const editor = getActiveEditor(); // active graph: an Alert inside a drill-in edits its own graph
    if (editor) {
      const stale = editor.getConnections().filter(
        (c) => c.target === data.id && typeof c.targetInput === "string" && !keep.has(c.targetInput),
      );
      for (const c of stale) await editor.removeConnection(c.id);
    }
    // setMode sets data.mode + recomputes; the node re-evaluates the new condition
    // fresh, so switching into an already-met condition fires once.
    setMode(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={mode} onChange={handleModeChange} options={MODES} />
      <InlineInputs node={data} emit={emit} keys={shownKeys} />
      <ValueDisplay
        value={data.cachedResult}
        render={(v) => {
          const met = Array.isArray(v) ? v.some((x) => x !== 0) : v !== 0;
          const desc = Array.isArray(v)
            ? (met ? "some out" : "all clear")
            : (met ? STATUS[mode].met(v as number) : STATUS[mode].calm);
          return <span style={{ color: met ? MET_COLOR : CALM_COLOR, fontWeight: 600 }}>● {desc}</span>;
        }}
      />
    </NodeShell>
  );
}

import { useSyncExternalStore } from "react";
import type { AlertNode as AlertNodeType, AlertMode } from "../rete-nodes";
import { ALERT_MODE_KEYS } from "../rete-nodes";
import { InlineInputs } from "./inlineInput";
import { NodeShell, OpSelect, ValueDisplay, useNodeField, type NodeProps } from "./nodeKit";
import { dropInputCables } from "./cablePrune";
import { appThemeStore } from "../appTheme";
import { resolveColor, themeAccent } from "../palette";

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

// Calm is the neutral text ramp; met is the palette's AMBER slot (theme-tuned),
// so the status color tracks a palette switch instead of a frozen hex.
const CALM_COLOR = "var(--text-dim)";

export function AlertComponent({ data, emit }: NodeProps<AlertNodeType>) {
  const [op, setOp] = useNodeField(data, "op");
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version);
  const metColor = themeAccent(resolveColor("amber"), appThemeStore.getMode());
  const shownKeys = ALERT_MODE_KEYS[op];

  async function handleOpChange(next: AlertMode) {
    // Inputs that leave the active set are about to be hidden — drop their
    // cables first (the shared pruning loop).
    const keep = new Set(ALERT_MODE_KEYS[next]);
    await dropInputCables(data.id, (k) => !keep.has(k));
    // setOp sets data.op + recomputes; the node re-evaluates the new condition
    // fresh, so switching into an already-met condition fires once.
    setOp(next);
  }

  return (
    <NodeShell node={data} emit={emit}>
      <OpSelect value={op} onChange={handleOpChange} options={MODES} />
      <InlineInputs node={data} emit={emit} keys={shownKeys} />
      <ValueDisplay
        value={data.cachedResult}
        render={(v) => {
          const met = Array.isArray(v) ? v.some((x) => x !== 0) : v !== 0;
          const desc = Array.isArray(v)
            ? (met ? "some out" : "all clear")
            : (met ? STATUS[op].met(v as number) : STATUS[op].calm);
          return <span style={{ color: met ? metColor : CALM_COLOR, fontWeight: 600 }}>● {desc}</span>;
        }}
      />
    </NodeShell>
  );
}

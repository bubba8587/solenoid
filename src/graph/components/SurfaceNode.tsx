import { useSyncExternalStore, type CSSProperties } from "react";
import type { SurfaceNode as SurfaceNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 190;

// A tiny D-pad in the figure's corner: yaw (←/→, 45° around Z) and pitch (↑/↓, 45°
// elevation, clamped to 0–90° so it never flips). Buttons stop pointer/mouse-down so
// the click doesn't start a node drag or selection.
const ROT_BTN: CSSProperties = {
  width: 16, height: 16, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, lineHeight: 1, cursor: "pointer", borderRadius: 3,
  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-dim, #888)",
};

function RotBtn({ ch, title, onClick }: { ch: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      style={ROT_BTN}
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {ch}
    </button>
  );
}

export function SurfaceComponent({ data, emit }: NodeProps<SurfaceNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const cv = data.cachedChart;
  const p = cv?.payload?.kind === "surface" ? cv.payload : null;
  const has = !!p && p.xs.length >= 2 && p.ys.length >= 2 && p.z.some((r) => r.some((v) => v != null && Number.isFinite(v)));

  const rotate = (dYaw: number, dPitch: number) => {
    data.literals.yaw = ((data.literals.yaw ?? 45) + dYaw) % 360;
    data.literals.pitch = Math.max(0, Math.min(90, (data.literals.pitch ?? 30) + dPitch));
    void processGraph(data.id);
  };

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div style={{ position: "relative", height: H, marginTop: 4 }}>
        {has && cv && !collapsed
          ? <ChartFigure value={cv} width={W} height={H} />
          : !has && <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>}
        {has && !collapsed && (
          <div style={{ position: "absolute", right: 4, bottom: 4, display: "grid", gridTemplateColumns: "repeat(3, 16px)", gridTemplateRows: "repeat(3, 16px)", gap: 2, opacity: 0.85 }}>
            <span />
            <RotBtn ch="↑" title="Tilt up" onClick={() => rotate(0, 45)} />
            <span />
            <RotBtn ch="←" title="Rotate left" onClick={() => rotate(-45, 0)} />
            <span />
            <RotBtn ch="→" title="Rotate right" onClick={() => rotate(45, 0)} />
            <span />
            <RotBtn ch="↓" title="Tilt down" onClick={() => rotate(0, -45)} />
            <span />
          </div>
        )}
      </div>
      {/* Collapsed → the hero box shows just the [Chart] chip (opens the popup). */}
      {cv && (
        <div className="solenoid-node__collapsed-only solenoid-node__display-value" style={{ justifyContent: "flex-end" }}>
          <ChartChip value={cv} />
        </div>
      )}
    </NodeShell>
  );
}

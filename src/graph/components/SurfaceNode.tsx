import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { SurfaceNode as SurfaceNodeType } from "../rete-nodes";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";
import { ChartFigure } from "./chartView";
import { ChartChip } from "./ChartChip";
import { collapseStore } from "../collapseStore";
import { processGraph } from "../process";
import { stopDragStart } from "../coarse";

// Fills the wide card (240) minus body padding.
const W = 218;
const H = 190;

// D-pad buttons stop pointer/mouse-down so a click can't start a node drag or selection.
const ROT_BTN: CSSProperties = {
  width: 16, height: 16, padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, lineHeight: 1, cursor: "pointer", borderRadius: 3,
  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-dim, #888)",
};

function RotBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      style={ROT_BTN}
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={stopDragStart}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

// A small house glyph (stroked, even 12px so it centers crisply — see the icon rule).
const HomeIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M2.5 8 L8 3 L13.5 8" />
    <path d="M4 7.5 V13 H12 V7.5" />
  </svg>
);

const DEFAULT_YAW = 45, DEFAULT_PITCH = 45;
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

export function SurfaceComponent({ data, emit }: NodeProps<SurfaceNodeType>) {
  const collapsed = useSyncExternalStore(collapseStore.subscribe, () => collapseStore.get(data.id));
  const cv = data.cachedChart;
  const p = cv?.payload?.kind === "surface" ? cv.payload : null;
  const has = !!p && p.xs.length >= 2 && p.ys.length >= 2 && p.z.some((r) => r.some((v) => v != null && Number.isFinite(v)));

  const rotate = (dYaw: number, dPitch: number) => {
    // Both axes wrap fully (0–360) — pitch flips all the way over, not clamped.
    data.literals.yaw = wrap360((data.literals.yaw ?? DEFAULT_YAW) + dYaw);
    data.literals.pitch = wrap360((data.literals.pitch ?? DEFAULT_PITCH) + dPitch);
    void processGraph(data.id);
  };
  const resetView = () => {
    data.literals.yaw = DEFAULT_YAW;
    data.literals.pitch = DEFAULT_PITCH;
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
            <RotBtn title="Rotate left + tilt up" onClick={() => rotate(-45, 45)}>↖</RotBtn>
            <RotBtn title="Tilt up" onClick={() => rotate(0, 45)}>↑</RotBtn>
            <RotBtn title="Rotate right + tilt up" onClick={() => rotate(45, 45)}>↗</RotBtn>
            <RotBtn title="Rotate left" onClick={() => rotate(-45, 0)}>←</RotBtn>
            <RotBtn title="Reset view" onClick={resetView}><HomeIcon /></RotBtn>
            <RotBtn title="Rotate right" onClick={() => rotate(45, 0)}>→</RotBtn>
            <RotBtn title="Rotate left + tilt down" onClick={() => rotate(-45, -45)}>↙</RotBtn>
            <RotBtn title="Tilt down" onClick={() => rotate(0, -45)}>↓</RotBtn>
            <RotBtn title="Rotate right + tilt down" onClick={() => rotate(45, -45)}>↘</RotBtn>
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

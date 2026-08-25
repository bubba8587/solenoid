import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { SliderInputNode as SliderInputNodeType } from "../rete-nodes";
import { processGraph } from "../process";
import { InlineInputs } from "./inlineInput";
import { NodeShell, type NodeProps } from "./nodeKit";

// Transport icons from Tabler Icons (MIT, tabler.io/icons): player-play,
// player-pause (filled), chevron-left / chevron-right (outline).
const PlayIcon = (
  <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden="true">
    <path d="M6 4v16a1 1 0 0 0 1.524 .852l13 -8a1 1 0 0 0 0 -1.704l-13 -8a1 1 0 0 0 -1.524 .852z" />
  </svg>
);
const PauseIcon = (
  <svg viewBox="0 0 24 24" width={12} height={12} fill="currentColor" aria-hidden="true">
    <path d="M9 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
    <path d="M17 4h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h2a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2z" />
  </svg>
);
const StepBackIcon = (
  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 6l-6 6l6 6" />
  </svg>
);
const StepFwdIcon = (
  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6l-6 6" />
  </svg>
);

// 100% Speed = MAX_HZ steps/second; every tick runs a full processGraph, so the
// ceiling stays modest — faster visibly drags on a large graph.
const MAX_HZ = 10;
const clampSpeed = (s: number) => Math.min(100, Math.max(1, s));

// Kill float drift from repeated step addition (0.1 + 0.2 …).
const fix = (v: number) => parseFloat(v.toFixed(6));

function TransportButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 24, height: 20, padding: 0,
        background: "var(--surface-sunken)", color: "var(--text-dim)",
        border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
      }}
    >{children}</button>
  );
}

export function SliderInputComponent({ data, emit }: NodeProps<SliderInputNodeType>) {
  const min  = data.effectiveMin;
  const max  = data.effectiveMax;
  const step = data.effectiveStep;

  const [playing, setPlaying] = useState(false);
  // Speed % is an inline-only parameter (no socket): persisted via literals.
  const [speed, setSpeed] = useState(() => data.literals.speed ?? 100);
  const busy = useRef(false); // skip ticks while the previous recompute runs

  // Value-only change (no topology), so recompute just the downstream cone.
  function onSlider(e: ChangeEvent<HTMLInputElement>) {
    data.value = parseFloat(e.target.value);
    processGraph(data.id);
  }

  function nudge(dir: 1 | -1) {
    const s = data.effectiveStep || 1;
    data.value = fix(Math.min(data.effectiveMax, Math.max(data.effectiveMin, data.value + dir * s)));
    processGraph(data.id);
  }

  function onSpeedChange(e: ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value);
    const s = Number.isFinite(v) ? v : 100;
    setSpeed(s);
    data.literals.speed = s;
  }

  useEffect(() => {
    if (!playing) return;
    const hz = MAX_HZ * (clampSpeed(speed) / 100);
    const id = setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const lo = data.effectiveMin, hi = data.effectiveMax;
        const s = data.effectiveStep || 1;
        const next = fix(data.value + s);
        data.value = next > hi ? lo : next;
        await processGraph(data.id);
      } finally {
        busy.current = false;
      }
    }, 1000 / hz);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <style>{`
        .solenoid-slider-node-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 12px; height: 12px; border-radius: 50%;
          background: #56b4e9; cursor: grab; border: none;
        }
        .solenoid-slider-node-range::-moz-range-thumb {
          width: 12px; height: 12px; border-radius: 50%;
          background: #56b4e9; cursor: grab; border: none;
        }
        .solenoid-slider-node-range:active::-webkit-slider-thumb { cursor: grabbing; }
      `}</style>
      <div
        style={{ padding: "4px 8px 6px" }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="solenoid-slider-node-range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={data.value}
          onChange={onSlider}
          style={{
            width: "100%", cursor: "pointer", display: "block",
            WebkitAppearance: "none", appearance: "none",
            height: 4, background: "var(--border-strong)", borderRadius: 2, outline: "none",
          }}
        />
        <div style={{ textAlign: "center", fontSize: 14, color: "var(--text)", marginTop: 4 }}>
          {data.value}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 4 }}>
          <TransportButton title="Step back one increment" onClick={() => nudge(-1)}>{StepBackIcon}</TransportButton>
          <TransportButton
            title={playing ? "Pause" : "Play. Walks the slider through its values at Speed, looping."}
            onClick={() => setPlaying((p) => !p)}
          >{playing ? PauseIcon : PlayIcon}</TransportButton>
          <TransportButton title="Step forward one increment" onClick={() => nudge(1)}>{StepFwdIcon}</TransportButton>
          <label
            title="Playback speed (% of maximum). Not wireable."
            style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}
          >
            Speed
            <input
              type="number"
              min={1}
              max={100}
              value={speed}
              onChange={onSpeedChange}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: 38, padding: "1px 3px", fontSize: 10,
                background: "var(--surface-sunken)", color: "var(--text)",
                border: "1px solid var(--border)", borderRadius: 3,
              }}
            />
            %
          </label>
        </div>
      </div>
    </NodeShell>
  );
}

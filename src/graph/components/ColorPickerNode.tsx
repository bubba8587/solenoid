import { useState } from "react";
import { colord } from "colord";
import type { ColorPickerNode as ColorPickerNodeType, ColorMode, ColorFormat } from "../rete-nodes";
import { NodeShell, OpSelect, type NodeProps } from "./nodeKit";
import { MeasuredSocketRow } from "./NodeSocket";
import { SegToggle } from "./SegToggle";
import { processGraph } from "../process";
import "./ColorPickerNode.css";
import { stopDragStart } from "../coarse";

const MODE_OPTS = [
  { value: "rgb", label: "RGB", title: "Red / Green / Blue, 0–255" },
  { value: "hsv", label: "HSV", title: "Hue 0–360 / Saturation / Value 0–100" },
  { value: "hex", label: "Hex", title: "Type a hex code directly" },
] as const;

const FORMAT_OPTS = [
  { value: "hex", label: "Hex: #rrggbb" },
  { value: "rgb", label: "rgb(r, g, b)" },
] as const;

type ChKey = "c0" | "c1" | "c2";
type Ch = Record<ChKey, number>;
const CHANNELS: Record<"rgb" | "hsv", { key: ChKey; label: string; max: number }[]> = {
  rgb: [
    { key: "c0", label: "R", max: 255 },
    { key: "c1", label: "G", max: 255 },
    { key: "c2", label: "B", max: 255 },
  ],
  hsv: [
    { key: "c0", label: "H", max: 360 },
    { key: "c1", label: "S", max: 100 },
    { key: "c2", label: "V", max: 100 },
  ],
};

// The slider track gradient: the color as THAT channel sweeps, others held.
function channelGradient(mode: "rgb" | "hsv", key: ChKey, ch: Ch): string {
  if (mode === "rgb") {
    const { c0: r, c1: g, c2: b } = ch;
    if (key === "c0") return `linear-gradient(to right, rgb(0,${g},${b}), rgb(255,${g},${b}))`;
    if (key === "c1") return `linear-gradient(to right, rgb(${r},0,${b}), rgb(${r},255,${b}))`;
    return `linear-gradient(to right, rgb(${r},${g},0), rgb(${r},${g},255))`;
  }
  const { c0: h, c1: s, c2: v } = ch;
  if (key === "c0") {
    const stops = [0, 60, 120, 180, 240, 300, 360].map((hh) => colord({ h: hh, s, v }).toHex());
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }
  if (key === "c1") return `linear-gradient(to right, ${colord({ h, s: 0, v }).toHex()}, ${colord({ h, s: 100, v }).toHex()})`;
  return `linear-gradient(to right, ${colord({ h, s, v: 0 }).toHex()}, ${colord({ h, s, v: 100 }).toHex()})`;
}

export function ColorPickerComponent({ data, emit }: NodeProps<ColorPickerNodeType>) {
  const [mode, setMode] = useState<ColorMode>(data.mode);
  const [format, setFormat] = useState<ColorFormat>(data.format);
  const [ch, setCh] = useState<Ch>({ c0: data.literals.c0, c1: data.literals.c1, c2: data.literals.c2 });
  const [hexDraft, setHexDraft] = useState(data.stringLiterals.hex ?? "#56b4e9");

  const raw = mode === "hex"
    ? colord(hexDraft || "#000000")
    : mode === "rgb"
      ? colord({ r: ch.c0, g: ch.c1, b: ch.c2 })
      : colord({ h: ch.c0, s: ch.c1, v: ch.c2 });
  const c = raw.isValid() ? raw : colord("#000000");
  const swatch = c.toHex();
  const output = format === "hex" ? c.toHex() : c.toRgbString();

  function setChannel(key: ChKey, v: number) {
    const next = { ...ch, [key]: v };
    setCh(next);
    data.literals[key] = v;
    void processGraph(data.id);
  }

  function changeMode(next: ColorMode) {
    if (next === mode) return;
    if (next === "hex") {
      const hx = c.toHex();
      setHexDraft(hx);
      data.stringLiterals.hex = hx;
    } else {
      const nc: Ch = next === "hsv"
        ? (() => { const h = c.toHsv(); return { c0: Math.round(h.h), c1: Math.round(h.s), c2: Math.round(h.v) }; })()
        : (() => { const r = c.toRgb(); return { c0: r.r, c1: r.g, c2: r.b }; })();
      setCh(nc);
      data.literals.c0 = nc.c0; data.literals.c1 = nc.c1; data.literals.c2 = nc.c2;
    }
    setMode(next);
    data.mode = next;
    void processGraph(data.id);
  }

  function changeFormat(next: ColorFormat) {
    setFormat(next);
    data.format = next;
    void processGraph(data.id);
  }

  // Hex field commits on Enter / blur (project rule) but the swatch tracks the
  // draft live so typing previews.
  function commitHex() {
    data.stringLiterals.hex = hexDraft;
    void processGraph(data.id);
  }

  const colorOut = data.outputs.color;

  return (
    <NodeShell node={data} emit={emit} labelPlaceholder="Color" hideOutputSockets>
      <SegToggle arg value={mode} onChange={changeMode} options={MODE_OPTS} />
      {mode === "hex" ? (
        <div style={{ padding: "8px 2px 2px" }} onPointerDown={stopDragStart} onMouseDown={(e) => e.stopPropagation()}>
          <input
            className="solenoid-colorpicker__hex"
            value={hexDraft}
            spellCheck={false}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
          />
        </div>
      ) : (
        <div
          onPointerDown={stopDragStart}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ padding: "8px 2px 2px", display: "flex", flexDirection: "column", gap: 8 }}
        >
          {CHANNELS[mode].map(({ key, label, max }) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-dim)" }}>
              <span style={{ width: 12, fontWeight: 600 }}>{label}</span>
              <input
                className="solenoid-colorpicker__slider"
                type="range"
                min={0}
                max={max}
                step={1}
                value={ch[key]}
                onChange={(e) => setChannel(key, Number(e.target.value))}
                style={{ flex: 1, minWidth: 0, background: channelGradient(mode, key, ch) }}
              />
              <span style={{ width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                {Math.round(ch[key])}
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ padding: "6px 0 2px" }}>
        <OpSelect arg value={format} onChange={changeFormat} options={FORMAT_OPTS} />
      </div>

      {/* The color output socket is measured onto the swatch row so it sits next
          to what it emits. */}
      {colorOut && (
        <MeasuredSocketRow side="output" socketKey="color" nodeId={data.id} emit={emit} payload={colorOut.socket}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, width: "100%" }}>
            <span
              aria-label="Color preview"
              style={{ width: 18, height: 18, borderRadius: 5, border: "1px solid var(--border-strong)", background: swatch, flex: "0 0 auto" }}
            />
            <code style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{output}</code>
          </div>
        </MeasuredSocketRow>
      )}
    </NodeShell>
  );
}

import type { SevenSegNode as SevenSegNodeType } from "../rete-nodes";
import { sevenSegText } from "../nodes/visual";
import { NodeShell, type NodeProps } from "./nodeKit";
import { InlineInputs } from "./inlineInput";

// A flat seven-segment readout. Lit segments take the accent; every segment also
// draws as a faint ghost (the LCD idiom that makes a 7-seg read as a display,
// not seven floating bars). Pure SVG rects — no gradients, no animation.

// Segment geometry in an 11 × 20.5 digit box: three horizontals (a/g/d), four
// verticals (f/b top, e/c bottom).
const SEGS: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 2, y: 0, w: 7, h: 2 },
  g: { x: 2, y: 9.25, w: 7, h: 2 },
  d: { x: 2, y: 18.5, w: 7, h: 2 },
  f: { x: 0, y: 2.5, w: 2, h: 6 },
  b: { x: 9, y: 2.5, w: 2, h: 6 },
  e: { x: 0, y: 12, w: 2, h: 6 },
  c: { x: 9, y: 12, w: 2, h: 6 },
};
const LIT: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcfgd",
  "-": "g",
};

const CELL_W = 11, CELL_H = 20.5, CELL_GAP = 4.5, DP_W = 4;

type Cell = { lit: string; dp: boolean };

/** Group a numeric string into digit cells; a '.' becomes the previous cell's
 *  decimal point instead of its own cell. */
function toCells(text: string): Cell[] {
  const cells: Cell[] = [];
  for (const ch of text) {
    if (ch === ".") {
      if (cells.length) cells[cells.length - 1].dp = true;
      continue;
    }
    cells.push({ lit: LIT[ch] ?? "", dp: false });
  }
  return cells;
}

export function SevenSegComponent({ data, emit }: NodeProps<SevenSegNodeType>) {
  const text = sevenSegText(data.cachedResult, data.literals.decimals ?? 0);
  const cells = toCells(text);
  // Blank display (no value) still shows ghost digits, like a meter at rest.
  const shown: Cell[] = cells.length ? cells : Array.from({ length: 4 }, () => ({ lit: "", dp: false }));
  let w = 0;
  const xs = shown.map((c) => { const x = w; w += CELL_W + (c.dp ? DP_W : 0) + CELL_GAP; return x; });
  w -= CELL_GAP;

  return (
    <NodeShell node={data} emit={emit}>
      <InlineInputs node={data} emit={emit} />
      <div className="solenoid-node__section-divider" />
      <div className="solenoid-node__display-value" style={{ justifyContent: "center", padding: "6px 0" }}>
        <svg width={Math.min(178, w * (28 / CELL_H))} viewBox={`-1 -1 ${w + 2} ${CELL_H + 2}`} style={{ display: "block", maxWidth: "100%" }} aria-label={text || undefined}>
          {shown.map((cell, i) => (
            <g key={i} transform={`translate(${xs[i]}, 0)`}>
              {Object.entries(SEGS).map(([k, s]) => (
                <rect
                  key={k}
                  x={s.x} y={s.y} width={s.w} height={s.h} rx={1}
                  fill={cell.lit.includes(k) ? "var(--accent)" : "var(--text)"}
                  opacity={cell.lit.includes(k) ? 1 : 0.08}
                />
              ))}
              {/* Ghost decimal point on every cell keeps spacing honest only when lit. */}
              {cell.dp && <circle cx={CELL_W + 2} cy={CELL_H - 1} r={1.3} fill="var(--accent)" />}
            </g>
          ))}
        </svg>
      </div>
    </NodeShell>
  );
}

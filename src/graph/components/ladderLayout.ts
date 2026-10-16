// [[C122]] choiceLadder
import type { LadderPayload } from "../chartValue";

/** A card on the ladder: `source` (the limits) or `r<k>`, rung k counted from 0 (the last is the plan). */
export interface Box { key: string; x: number; y: number; w: number; h: number }

/** One drawn piece. A band is one resource: it runs down beside the cards (`trunk`) and turns into each card for what that
 *  card spends (`turn`). `line` is the flowchart edge from one card to the next. */
export interface Piece {
  kind: "trunk" | "turn" | "line";
  band: number | null;
  d: string;
  width: number;
  /** The box it leaves and the box it reaches; a trunk's ends are the boxes whose junctions bound it. */
  from: string;
  to: string;
  x0: number; y0: number; x1: number; y1: number;
}

export interface Metrics { cw: number; band: number; turn: number; rowGap: number }
export const metricsFor = (fs: number): Metrics => ({ cw: Math.round(300 * fs), band: Math.round(24 * fs), turn: Math.round(26 * fs), rowGap: Math.round(40 * fs) });

const SLOT_GAP = 3;
/** How far below a card's top a band enters it, and how far above that the band starts to turn. */
const ENTER = 10, TURN_V = 18;

export interface Layout { boxes: Map<string, Box>; pieces: Piece[]; width: number; height: number }

export function layoutLadder(p: LadderPayload, heights: Map<string, number>, m: Metrics): Layout {
  const R = p.resources.length;
  // Band 1 runs down the right; every other band down the left, band 0 nearest the cards.
  const leftBands = [...Array(R).keys()].filter((r) => r !== 1).reverse();
  const gutterL = leftBands.length ? leftBands.length * (m.band + SLOT_GAP) + m.turn : m.turn;
  const gutterR = R > 1 ? m.band + SLOT_GAP + m.turn : m.turn;
  const width = gutterL + m.cw + gutterR;
  const isRight = (r: number) => r === 1;
  /** A band's fixed edge: a left band is left-aligned from here, the right band right-aligned to here. */
  const anchor = (r: number) => (isRight(r) ? width - SLOT_GAP : SLOT_GAP + leftBands.indexOf(r) * (m.band + SLOT_GAP));
  const widthOf = (v: number, r: number) => Math.max(0, Math.min(1, v / (p.resources[r].limit || 1))) * m.band;

  const boxes = new Map<string, Box>();
  const src: Box = { key: "source", x: 0, y: 0, w: width, h: heights.get("source") ?? 0 };
  boxes.set("source", src);
  let y = src.h + m.rowGap;
  p.rungs.forEach((_, k) => {
    const h = heights.get(`r${k}`) ?? 0;
    boxes.set(`r${k}`, { key: `r${k}`, x: gutterL, y, w: m.cw, h });
    y += h + m.rowGap;
  });
  const height = y - m.rowGap;

  const pieces: Piece[] = [];
  const junction = (b: Box) => b.y + ENTER - TURN_V;
  const trunk = (r: number, w: number, ya: number, yb: number, from: string, to: string) => {
    if (w <= 0 || yb <= ya) return;
    const a = anchor(r), xl = isRight(r) ? a - w : a;
    pieces.push({ kind: "trunk", band: r, d: `M${xl} ${ya}H${xl + w}V${yb}H${xl}Z`, width: w, from, to, x0: xl, y0: ya, x1: xl, y1: yb });
  };
  // The slice of band r a card spends, turning off the band into the card's side.
  const turn = (b: Box, r: number, wBefore: number, wAfter: number) => {
    const t = wBefore - wAfter;
    if (t <= 0.01) return;
    const a = anchor(r), yS = junction(b), ye = b.y + ENTER;
    const right = isRight(r);
    const xo = right ? a - wBefore : a + wBefore, xi = right ? a - wAfter : a + wAfter, X = right ? b.x + b.w : b.x;
    const d = `M${xo} ${yS}C${xo} ${yS + 0.6 * (ye - yS)} ${X + 0.6 * (xo - X)} ${ye} ${X} ${ye}`
      + `L${X} ${ye + t}C${X + 0.6 * (xi - X)} ${ye + t} ${xi} ${yS + 0.6 * (ye + t - yS)} ${xi} ${yS}Z`;
    pieces.push({ kind: "turn", band: r, d, width: t, from: b.key, to: b.key, x0: xo, y0: yS, x1: X, y1: ye });
  };
  const line = (a: Box, b: Box) => {
    const x = gutterL + m.cw / 2;
    pieces.push({ kind: "line", band: null, d: `M${x} ${a.y + a.h}V${b.y}`, width: 1.5, from: a.key, to: b.key, x0: x, y0: a.y + a.h, x1: x, y1: b.y });
  };

  let above = { key: "source", y: src.h, box: src };
  p.rungs.forEach((rung, k) => {
    const b = boxes.get(`r${k}`)!;
    const spent = rung.kind === "plan" ? rung.left : p.options[rung.pick!].costs;
    for (let r = 0; r < R; r++) {
      const wB = widthOf(rung.left[r], r);
      trunk(r, wB, above.y, junction(b), above.key, b.key);
      turn(b, r, wB, widthOf(rung.left[r] - spent[r], r));
    }
    line(above.box, b);
    above = { key: b.key, y: junction(b), box: b };
  });

  return { boxes, pieces, width, height };
}

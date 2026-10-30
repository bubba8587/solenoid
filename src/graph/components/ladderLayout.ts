// [[C100]] chartIsAValue
import type { LadderPayload } from "../chartValue";

/** A card: `source` (the criteria and limits), or `e<i>` (the rung edge i takes). */
export interface Box { key: string; lane: number; row: number; x: number; y: number; w: number; h: number }

/** One drawn piece of the value flow. `link` carries it between cards and is drawn as a stroke along its centerline `d`, so a
 *  sideways run keeps its thickness; `shift` is the short straight run into a card's row, `trunk` runs beside a card and
 *  `turn` is the slice a card takes, all filled shapes. `need` marks an option taken first because the next one needs it. */
export interface Piece {
  kind: "link" | "shift" | "trunk" | "turn" | "need";
  d: string;
  width: number;
  from: string;
  to: string;
}

export interface Metrics { cw: number; band: number; turn: number; laneGap: number; rowGap: number }
export const metricsFor = (fs: number): Metrics => ({ cw: Math.round(190 * fs), band: Math.round(96 * fs), turn: Math.round(26 * fs), laneGap: Math.round(18 * fs), rowGap: Math.round(54 * fs) });

/** Where the band runs straight into a card's row (above its top), where its slice starts to turn, and where the slice enters its side. */
const PRE = 12, POST = 2, ENTER = 16;
/** How far straight pieces run past their ends into their neighbors, so no seam shows where they meet. */
const OVER = 1;

/** `minHeight`: how tall each card must be for its slice to land inside it. `flows`: each card's flow in, its slice and
 *  what flows on, in pixels. */
export interface Layout {
  boxes: Map<string, Box>; pieces: Piece[]; width: number; height: number; minHeight: Map<string, number>;
  flows: Map<string, { inW: number; peelW: number; outW: number }>;
  /** Whether a piece lies on the plan's own path (the main line). */
  onMain: (x: Piece) => boolean;
}

interface Item { key: string; lane: number; row: number; from: number; to: number; inF: number; peel: number; outF: number }
/** A link before rows have heights: where it leaves and lands across, how wide, and which stage of the gap it runs in. */
interface Spec { row: number; stage: "one" | "in" | "out"; xa: number; xb: number; w: number; from: string; to: string; upperRow: number }

export function layoutLadder(p: LadderPayload, heights: Map<string, number>, m: Metrics): Layout {
  // The band is the value the plan serves, weighted by how much of the flow takes each path: it narrows as each card takes
  // its option's slice and is spent at the last card. Built bottom up, so a fork splits it by what each side serves.
  const valueOf = (i: number) => p.options[i].value.reduce((s, v) => s + Math.max(0, v), 0);
  const byId = new Map(p.states.map((s) => [s.id, s]));
  const outs = new Map(p.states.map((s) => [s.id, p.edges.map((e, i) => ({ e, i })).filter((x) => x.e.from === s.id).sort((a, b) => b.e.share - a.e.share)]));
  const maxDepth = Math.max(0, ...p.states.map((s) => s.depth));
  const flow = new Map<number, number>();
  const edgeFlow = new Map<number, { inF: number; peel: number; outF: number }>();
  for (const s of [...p.states].sort((x, y) => y.depth - x.depth)) {
    let F = 0;
    for (const { e, i } of outs.get(s.id)!) {
      const to = byId.get(e.to)!;
      const peel = valueOf(e.pick) * e.share;
      const outF = to.share > 0 ? (flow.get(e.to) ?? 0) * (e.share / to.share) : 0;
      edgeFlow.set(i, { inF: peel + outF, peel, outF });
      F += peel + outF;
    }
    flow.set(s.id, F);
  }
  const total = flow.get(0) ?? 0;
  const px = m.band / (total || 1);
  const gutter = m.band + m.turn + 4;
  const laneW = gutter + m.cw + m.laneGap;

  // Lanes, depth first: a fork's main side and everything below it are placed before its other side, which takes the
  // next lane past all of them, so no flow crosses another. A path that reaches a state already placed merges into it.
  const laneOfState = new Map<number, number>();
  const laneOfEdge = new Map<number, number>();
  const place = (sid: number, lane: number): number => {
    laneOfState.set(sid, lane);
    let most = lane;
    outs.get(sid)!.filter(({ e }) => e.share > 0).forEach(({ e, i }, k) => {
      const l = k === 0 ? lane : most + 1;
      laneOfEdge.set(i, l);
      most = Math.max(most, l);
      if (!laneOfState.has(e.to)) most = Math.max(most, place(e.to, l));
    });
    return most;
  };
  place(0, 0);
  // A side passed over carries nothing, so no flow can cross it: it sits in the first free lane right of the pick.
  p.edges.forEach((e, i) => {
    if (e.share > 0) return;
    const row = byId.get(e.from)!.depth;
    const busy = new Set(p.edges.map((x, j) => (laneOfEdge.has(j) && byId.get(x.from)!.depth === row ? laneOfEdge.get(j)! : -1)));
    const pick = outs.get(e.from)!.find((x) => x.e.share > 0);
    let l = (pick ? laneOfEdge.get(pick.i)! : laneOfState.get(e.from) ?? 0) + 1;
    while (busy.has(l)) l++;
    laneOfEdge.set(i, l);
  });

  const items: Item[] = p.edges.map((e, i) => ({ key: `e${i}`, lane: laneOfEdge.get(i) ?? 0, row: byId.get(e.from)!.depth, from: e.from, to: e.to, ...edgeFlow.get(i)! }));
  const anchor = (lane: number) => lane * laneW + 4;

  // Between rows, across only: a state's arriving flows split among its rungs by what each goes on to serve. When several
  // arrive and several leave they first meet in one band centered between their lanes, so no two flows cross.
  const specs: Spec[] = [];
  for (const s of p.states) {
    const lower = items.filter((it) => it.from === s.id).sort((x, y) => x.lane - y.lane);
    if (!lower.length) continue;
    const upper = s.id === 0
      ? [{ key: "source", lane: 0, outF: total, row: -1 }]
      : items.filter((it) => it.to === s.id).sort((x, y) => x.lane - y.lane);
    const F = flow.get(s.id) || 1;
    const q = lower.map((l) => l.inF / F);
    const row = s.depth, upperRow = row - 1;
    if (upper.length > 1 && lower.length > 1) {
      const inState = upper.reduce((t, u) => t + u.outF, 0);
      const lanesHere = [...upper, ...lower].map((x) => x.lane);
      const xs = (anchor(Math.min(...lanesHere)) + anchor(Math.max(...lanesHere)) - inState * px) / 2;
      let off = 0;
      for (const u of upper) {
        specs.push({ row, upperRow, stage: "in", xa: anchor(u.lane), xb: xs + off, w: u.outF * px, from: u.key, to: `m${s.id}` });
        off += u.outF * px;
      }
      off = 0;
      lower.forEach((l, li) => {
        const w = inState * q[li] * px;
        specs.push({ row, upperRow, stage: "out", xa: xs + off, xb: anchor(l.lane), w, from: `m${s.id}`, to: l.key });
        off += w;
      });
      continue;
    }
    const lowerOff = lower.map(() => 0);
    for (const u of upper) {
      let off = 0;
      lower.forEach((l, li) => {
        const w = u.outF * q[li] * px;
        specs.push({ row, upperRow, stage: "one", xa: anchor(u.lane) + off, xb: anchor(l.lane) + lowerOff[li], w, from: u.key, to: l.key });
        off += w;
        lowerOff[li] += w;
      });
    }
  }

  // Rows: the source on top, then one per depth, each as tall as its tallest card. A gap grows to fit the widest band that
  // runs sideways through it, so a band never crowds the cards above or below.
  const sideways = (sp: Spec) => (Math.abs(sp.xb - sp.xa) > 0.5 && sp.w > 0.01 ? 1.4 * sp.w + 6 : 0);
  const gapAbove = Array.from({ length: maxDepth + 1 }, (_, r) => {
    const at = specs.filter((sp) => sp.row === r);
    const most = (st: Spec["stage"]) => Math.max(0, ...at.filter((sp) => sp.stage === st).map(sideways));
    return Math.max(m.rowGap, Math.max(most("one"), most("in") + most("out")) + PRE);
  });
  const srcH = heights.get("source") ?? 0;
  const rowH = new Array(maxDepth + 1).fill(0);
  for (const it of items) rowH[it.row] = Math.max(rowH[it.row], heights.get(it.key) ?? 0);
  const rowY: number[] = [];
  let y = srcH;
  for (let r = 0; r <= maxDepth; r++) { y += gapAbove[r]; rowY[r] = y; y += rowH[r]; }
  const height = y;
  const lanes = Math.max(1, ...items.map((it) => it.lane + 1));
  const width = lanes * laneW - m.laneGap;
  const rowBottom = (r: number) => (r < 0 ? srcH : rowY[r] + rowH[r]);

  const boxes = new Map<string, Box>();
  boxes.set("source", { key: "source", lane: 0, row: -1, x: 0, y: 0, w: gutter + m.cw, h: srcH });
  for (const it of items) boxes.set(it.key, { key: it.key, lane: it.lane, row: it.row, x: it.lane * laneW + gutter, y: rowY[it.row], w: m.cw, h: heights.get(it.key) ?? 0 });

  const pieces: Piece[] = [];
  const band = (kind: Piece["kind"], x: number, w: number, y0: number, y1: number, from: string, to: string) => {
    if (w > 0.01 && y1 > y0) pieces.push({ kind, width: w, from, to, d: `M${x} ${y0 - OVER}H${x + w}V${y1 + OVER}H${x}Z` });
  };
  for (const sp of specs) {
    if (sp.w <= 0.01) continue;
    const y0 = rowBottom(sp.upperRow), y1 = rowY[sp.row] - PRE, ymid = (y0 + y1) / 2;
    const [ya, yb] = sp.stage === "in" ? [y0, ymid] : sp.stage === "out" ? [ymid, y1] : [y0, y1];
    const xa = sp.xa + sp.w / 2, xb = sp.xb + sp.w / 2, ym = (ya + yb) / 2;
    pieces.push({ kind: "link", width: sp.w, from: sp.from, to: sp.to, d: `M${xa} ${ya - OVER}L${xa} ${ya}C${xa} ${ym} ${xb} ${ym} ${xb} ${yb}L${xb} ${yb + OVER}` });
  }

  // Within each card's row: the band runs straight into the row, the card's slice turns into its left side, and what's
  // left runs down beside it.
  for (const it of items) {
    const b = boxes.get(it.key)!;
    const a = anchor(it.lane), yT = b.y + POST, yE = b.y + ENTER;
    const outW = it.outF * px, t = it.peel * px;
    band("shift", a, it.inF * px, b.y - PRE, yT, it.key, it.key);
    if (t > 0.01) {
      const xo = a + outW + t, xi = a + outW, X = b.x;
      pieces.push({ kind: "turn", width: t, from: it.key, to: it.key,
        d: `M${xo} ${yT}C${xo} ${yT + 0.6 * (yE - yT)} ${X - 0.6 * (X - xo)} ${yE} ${X} ${yE}L${X} ${yE + t}C${X - 0.6 * (X - xi)} ${yE + t} ${xi} ${yT + 0.6 * (yE + t - yT)} ${xi} ${yT}Z` });
    }
    band("trunk", a, outW, yT, rowBottom(it.row), it.key, it.key);
  }

  // An option taken first because the next one needs it: a dashed bracket to the card that needs it.
  for (const it of items) {
    if (!it.key.startsWith("e") || p.edges[Number(it.key.slice(1))].kind !== "required") continue;
    const nxt = items.find((x) => x.from === it.to && x.lane === it.lane);
    if (!nxt) continue;
    const a = boxes.get(it.key)!, c = boxes.get(nxt.key)!;
    const xr = a.x + a.w, ya = a.y + a.h / 2, yc = c.y + c.h / 2;
    pieces.push({ kind: "need", width: 1, from: it.key, to: nxt.key, d: `M${xr} ${ya}C${xr + 14} ${ya} ${xr + 14} ${yc} ${xr} ${yc}` });
  }

  const minHeight = new Map(items.map((it) => [it.key, Math.ceil(ENTER + it.peel * px + 6)]));
  const flows = new Map(items.map((it) => [it.key, { inW: it.inF * px, peelW: it.peel * px, outW: it.outF * px }]));
  flows.set("source", { inW: 0, peelW: 0, outW: total * px });
  const mainKeys = new Set(["source", ...p.main.map((i) => `e${i}`)]);
  const mainStates = new Set(p.main.map((i) => `m${p.edges[i].from}`));
  const on = (k: string) => mainKeys.has(k) || mainStates.has(k);
  const onMain = (x: Piece) => (x.kind === "link" ? on(x.from) && on(x.to) : mainKeys.has(x.from));
  return { boxes, pieces, width: Math.max(width, gutter + m.cw), height, minHeight, flows, onMain };
}

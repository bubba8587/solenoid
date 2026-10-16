// [[C122]] choiceLadder
import type { LadderPayload } from "../chartValue";

/** A card: `source` (the limits), `e<i>` (the rung edge i takes), `s<id>` (state id's end, what was never served). */
export interface Box { key: string; lane: number; row: number; x: number; y: number; w: number; h: number }

/** One drawn piece of the value flow (one strand: the total value; each card shows its criteria itself). `link` carries it between cards, `shift` re-stacks it
 *  where a card takes its slice, `trunk` runs beside a card, `turn` is the slice a card takes. `need` marks an option taken
 *  first because the next one needs it. */
export interface Piece {
  kind: "link" | "shift" | "trunk" | "turn" | "need";
  strand: number | null;
  d: string;
  width: number;
  from: string;
  to: string;
}

export interface Metrics { cw: number; band: number; turn: number; laneGap: number; rowGap: number }
export const metricsFor = (fs: number): Metrics => ({ cw: Math.round(190 * fs), band: Math.round(120 * fs), turn: Math.round(26 * fs), laneGap: Math.round(18 * fs), rowGap: Math.round(54 * fs) });

/** Where a card's strands re-stack (above its top), where its slice starts to turn, and where the slice enters its side. */
const PRE = 12, POST = 2, ENTER = 16;

/** `minHeight`: how tall each card must be for its slice to land inside it. `flows`: each card's flow in, its slice and
 *  what flows on, in pixels. */
export interface Layout {
  boxes: Map<string, Box>; pieces: Piece[]; width: number; height: number; minHeight: Map<string, number>;
  flows: Map<string, { inW: number; peelW: number; outW: number }>;
}

interface Item { key: string; lane: number; row: number; from: number | null; to: number | null; share: number; inF: number[]; peel: number[]; outF: number[] }

export function layoutLadder(p: LadderPayload, heights: Map<string, number>, m: Metrics): Layout {
  // The flow is one strand of total value: thin per-criterion strands read as noise at a slice per option.
  const K = 1;
  const valueOf = (i: number) => [p.options[i].value.reduce((s, v) => s + Math.max(0, v), 0)];
  const total = [p.options.reduce((s, _, i) => s + valueOf(i)[0], 0)];
  const sumTotal = total.reduce((a, b) => a + b, 0) || 1;
  const px = m.band / sumTotal;
  const gutter = m.band + m.turn + 4;
  const laneW = gutter + m.cw + m.laneGap;
  const byId = new Map(p.states.map((s) => [s.id, s]));
  const outs = new Map(p.states.map((s) => [s.id, p.edges.map((e, i) => ({ e, i })).filter((x) => x.e.from === s.id).sort((a, b) => b.e.share - a.e.share)]));

  // Flows, top down: each state's arriving value splits among its rungs by share, and each rung takes its option's slice.
  const maxDepth = Math.max(0, ...p.states.map((s) => s.depth));
  const flow = new Map<number, number[]>([[0, [...total]]]);
  const edgeFlow = new Map<number, { inF: number[]; peel: number[]; outF: number[] }>();
  for (const s of [...p.states].sort((x, y2) => x.depth - y2.depth)) {
    const F = flow.get(s.id) ?? new Array(K).fill(0);
    for (const { e, i } of outs.get(s.id)!) {
      const q = s.share > 0 ? e.share / s.share : 0;
      const inF = F.map((v) => v * q);
      const peel = valueOf(e.pick).map((v) => v * e.share);
      const outF = inF.map((v, j) => Math.max(0, v - peel[j]));
      edgeFlow.set(i, { inF, peel, outF });
      flow.set(e.to, (flow.get(e.to) ?? new Array(K).fill(0)).map((v, j) => v + outF[j]));
    }
  }

  // Lanes, depth first: a fork's main side and everything below it are placed before its other side, which takes the
  // next lane past all of them, so no flow crosses another. A path that reaches a state already placed merges into it.
  const laneOfState = new Map<number, number>();
  const laneOfEdge = new Map<number, number>();
  const place = (sid: number, lane: number): number => {
    laneOfState.set(sid, lane);
    let most = lane;
    outs.get(sid)!.forEach(({ e, i }, k) => {
      const l = k === 0 ? lane : most + 1;
      laneOfEdge.set(i, l);
      most = Math.max(most, l);
      if (!laneOfState.has(e.to)) most = Math.max(most, place(e.to, l));
    });
    return most;
  };
  place(0, 0);

  const items: Item[] = [];
  for (const s of p.states) {
    if (s.end) items.push({ key: `s${s.id}`, lane: laneOfState.get(s.id) ?? 0, row: s.depth, from: s.id, to: null, share: s.share, inF: flow.get(s.id) ?? [0], peel: flow.get(s.id) ?? [0], outF: [0] });
  }
  p.edges.forEach((e, i) => {
    const f = edgeFlow.get(i)!;
    items.push({ key: `e${i}`, lane: laneOfEdge.get(i) ?? 0, row: byId.get(e.from)!.depth, from: e.from, to: e.to, share: e.share, ...f });
  });

  // Rows: the source on top, then one per depth, each as tall as its tallest card.
  const srcH = heights.get("source") ?? 0;
  const rowH = new Array(maxDepth + 1).fill(0);
  for (const it of items) rowH[it.row] = Math.max(rowH[it.row], heights.get(it.key) ?? 0);
  const rowY: number[] = [];
  let y = srcH + m.rowGap;
  for (let r = 0; r <= maxDepth; r++) { rowY[r] = y; y += rowH[r] + m.rowGap; }
  const height = y - m.rowGap;
  const lanes = Math.max(1, ...items.map((it) => it.lane + 1));
  const width = lanes * laneW - m.laneGap;

  const boxes = new Map<string, Box>();
  boxes.set("source", { key: "source", lane: 0, row: -1, x: 0, y: 0, w: gutter + m.cw, h: srcH });
  for (const it of items) boxes.set(it.key, { key: it.key, lane: it.lane, row: it.row, x: it.lane * laneW + gutter, y: rowY[it.row], w: m.cw, h: heights.get(it.key) ?? 0 });

  const pieces: Piece[] = [];
  const anchor = (lane: number) => lane * laneW + 4;
  const stack = (v: number[]) => { const xs: number[] = []; let x = 0; for (const w of v) { xs.push(x); x += w * px; } return xs; };
  const link = (kind: Piece["kind"], j: number, xa: number, wa: number, ya: number, xb: number, wb: number, yb: number, from: string, to: string) => {
    if (wa <= 0.01 && wb <= 0.01) return;
    const ym = (ya + yb) / 2;
    pieces.push({ kind, strand: j, width: wa, from, to,
      d: `M${xa} ${ya}C${xa} ${ym} ${xb} ${ym} ${xb} ${yb}L${xb + wb} ${yb}C${xb + wb} ${ym} ${xa + wa} ${ym} ${xa + wa} ${ya}Z` });
  };

  // Within each card's row: strands re-stack so the card's slice comes off the right, the slice turns into the card,
  // and what's left runs down beside it.
  for (const it of items) {
    const b = boxes.get(it.key)!;
    const a = anchor(it.lane), yJ = b.y - PRE, yT = b.y + POST, yE = b.y + ENTER, yBot = rowY[it.row] + rowH[it.row];
    const xin = stack(it.inF), xout = stack(it.outF), xpeel = stack(it.peel);
    const outW = it.outF.reduce((s, v) => s + v * px, 0);
    for (let j = 0; j < K; j++) {
      link("shift", j, a + xin[j], it.outF[j] * px, yJ, a + xout[j], it.outF[j] * px, yT, it.key, it.key);
      link("shift", j, a + xin[j] + it.outF[j] * px, it.peel[j] * px, yJ, a + outW + xpeel[j], it.peel[j] * px, yT, it.key, it.key);
    }
    // Slices nest as they turn: the one nearest the card lands highest.
    for (let j = 0; j < K; j++) {
      const t = it.peel[j] * px;
      if (t <= 0.01) continue;
      const xo = a + outW + xpeel[j] + t, xi = a + outW + xpeel[j], X = b.x;
      const yo = yE + it.peel.slice(j + 1).reduce((s, v) => s + v * px, 0);
      pieces.push({ kind: "turn", strand: j, width: t, from: it.key, to: it.key,
        d: `M${xo} ${yT}C${xo} ${yT + 0.6 * (yo - yT)} ${X - 0.6 * (X - xo)} ${yo} ${X} ${yo}L${X} ${yo + t}C${X - 0.6 * (X - xi)} ${yo + t} ${xi} ${yT + 0.6 * (yo + t - yT)} ${xi} ${yT}Z` });
    }
    for (let j = 0; j < K; j++) {
      const w = it.outF[j] * px;
      if (w <= 0.01 || yBot <= yT) continue;
      const x = a + xout[j];
      pieces.push({ kind: "trunk", strand: j, width: it.outF[j] * px, from: it.key, to: it.key, d: `M${x} ${yT}H${x + w}V${yBot}H${x}Z` });
    }
  }

  // Between rows: a state's arriving flows meet in its lane, then split among its rungs in proportion to their shares.
  // With one flow in and one out they join directly.
  const statesAt = (r: number) => p.states.filter((s) => s.depth === r);
  for (let r = 0; r <= maxDepth; r++) {
    for (const s of statesAt(r)) {
      const lower = items.filter((it) => it.from === s.id).sort((x, y2) => x.lane - y2.lane);
      if (!lower.length) continue;
      const upper: { key: string; lane: number; outF: number[]; yBot: number }[] = s.id === 0
        ? [{ key: "source", lane: 0, outF: total, yBot: srcH }]
        : items.filter((it) => it.to === s.id).map((it) => ({ key: it.key, lane: it.lane, outF: it.outF, yBot: rowY[it.row] + rowH[it.row] })).sort((x, y2) => x.lane - y2.lane);
      const share = byId.get(s.id)!.share || 1;
      const q = lower.map((l) => (l.to == null ? 1 : l.share / share));
      const yLow = rowY[lower[0].row] - PRE;
      const yTop = Math.max(...upper.map((u) => u.yBot));
      const meet = upper.length > 1 && lower.length > 1;
      const yMid = (yTop + yLow) / 2;
      const sLane = laneOfState.get(s.id) ?? lower[0].lane;
      for (let j = 0; j < K; j++) {
        if (meet) {
          // Into one band in the state's lane, stacked by arriving lane, then out to each rung.
          let off = 0;
          for (const u of upper) {
            link("link", j, anchor(u.lane) + stack(u.outF)[j], u.outF[j] * px, u.yBot, anchor(sLane) + off, u.outF[j] * px, yMid, u.key, `m${s.id}`);
            off += u.outF[j] * px;
          }
          const inState = upper.reduce((t, u) => t + u.outF[j], 0);
          off = 0;
          lower.forEach((l, li) => {
            const amt = inState * q[li];
            link("link", j, anchor(sLane) + off, amt * px, yMid, anchor(l.lane) + stack(l.inF)[j], amt * px, yLow, `m${s.id}`, l.key);
            off += amt * px;
          });
          continue;
        }
        const lowerOff = lower.map(() => 0);
        for (const u of upper) {
          let off = stack(u.outF)[j];
          lower.forEach((l, li) => {
            const amt = u.outF[j] * q[li];
            const xl = anchor(l.lane) + stack(l.inF)[j] + lowerOff[li];
            link("link", j, anchor(u.lane) + off, amt * px, u.yBot, xl, amt * px, yLow, u.key, l.key);
            off += amt * px;
            lowerOff[li] += amt * px;
          });
        }
      }
    }
  }

  // An option taken first because the next one needs it: a dashed bracket to the card that needs it.
  for (const it of items) {
    if (!it.key.startsWith("e") || p.edges[Number(it.key.slice(1))].kind !== "required") continue;
    const nxt = items.find((x) => x.from === it.to && x.lane === it.lane);
    if (!nxt) continue;
    const a = boxes.get(it.key)!, c = boxes.get(nxt.key)!;
    const xr = a.x + a.w, ya = a.y + a.h / 2, yc = c.y + c.h / 2;
    pieces.push({ kind: "need", strand: null, width: 1, from: it.key, to: nxt.key, d: `M${xr} ${ya}C${xr + 14} ${ya} ${xr + 14} ${yc} ${xr} ${yc}` });
  }

  const minHeight = new Map(items.map((it) => [it.key, Math.ceil(ENTER + it.peel.reduce((s, v) => s + v * px, 0) + 6)]));
  const sum = (v: number[]) => v.reduce((t, x) => t + x * px, 0);
  const flows = new Map(items.map((it) => [it.key, { inW: sum(it.inF), peelW: sum(it.peel), outW: sum(it.outF) }]));
  flows.set("source", { inW: 0, peelW: 0, outW: sum(total) });
  return { boxes, pieces, width: Math.max(width, gutter + m.cw), height, minHeight, flows };
}

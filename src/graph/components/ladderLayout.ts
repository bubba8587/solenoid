// [[C122]] choiceLadder
import type { LadderPayload, LadderRung } from "../chartValue";

/** A card on the ladder: `source` (the limits), `r<id>` (a rung's card, a toss-up's main side, or a plan), `a<id>` (a toss-up's alternative side). */
export interface Box { key: string; lane: number; row: number; x: number; y: number; w: number; h: number; on: boolean }

/** One drawn piece. A band is one resource: it runs down a lane (`trunk`), turns into a card for what that card spends
 *  (`turn`), and at a toss-up a dashed copy of it crosses to the alternative's lane (`cross`). `line` is the flowchart edge. */
export interface Piece {
  kind: "trunk" | "turn" | "cross" | "line";
  band: number | null;
  d: string;
  on: boolean;
  ghost: boolean;
  width: number;
  /** The box it leaves and the box it reaches; a trunk's ends are the boxes whose junctions bound it. */
  from: string;
  to: string;
  /** Endpoints, for checking that every piece meets what it says it meets. */
  x0: number; y0: number; x1: number; y1: number;
}

export interface Metrics { cw: number; band: number; turn: number; laneGap: number; rowGap: number }
export const metricsFor = (fs: number): Metrics => ({ cw: Math.round(200 * fs), band: Math.round(18 * fs), turn: Math.round(22 * fs), laneGap: Math.round(14 * fs), rowGap: Math.round(74 * fs) });

const SLOT_GAP = 3;
/** How far below a card's top a band enters it, and how far above that the band starts to turn. */
const ENTER = 10, TURN_V = 18, RAD = 6;

export interface Layout { boxes: Map<string, Box>; pieces: Piece[]; width: number; height: number; gutterL: number; gutterR: number; laneW: number }

export function laneOrder(rungs: LadderRung[]): { laneX: Map<number, number>; lanes: number; kids: Map<number, LadderRung[]> } {
  const kids = new Map<number, LadderRung[]>(rungs.map((r) => [r.id, []]));
  for (const r of rungs) if (r.parent != null) kids.get(r.parent)!.push(r);
  for (const list of kids.values()) list.sort((a, b) => (a.branch ?? 0) - (b.branch ?? 0));
  const laneX = new Map<number, number>();
  let next = 0;
  const walk = (r: LadderRung) => {
    const ks = kids.get(r.id)!;
    if (!ks.length) { laneX.set(r.id, next++); return; }
    ks.forEach(walk);
    laneX.set(r.id, laneX.get(ks[0].id)!);
  };
  const root = rungs.find((r) => r.parent == null);
  if (root) walk(root);
  return { laneX, lanes: next, kids };
}

/** The selected plan's path: every rung on it, root to plan. */
export function pathTo(p: LadderPayload, planId: number): Set<number> {
  const byId = new Map(p.rungs.map((r) => [r.id, r]));
  const on = new Set<number>();
  for (let r = byId.get(planId); r; r = r.parent != null ? byId.get(r.parent) : undefined) on.add(r.id);
  return on;
}

export function layoutLadder(p: LadderPayload, heights: Map<string, number>, m: Metrics, selected: number): Layout {
  const R = p.resources.length;
  const byId = new Map(p.rungs.map((r) => [r.id, r]));
  const { laneX, lanes, kids } = laneOrder(p.rungs);
  const path = pathTo(p, selected);

  // Band 1 runs down the right of each lane; every other band down the left, band 0 nearest the card.
  const leftBands = [...Array(R).keys()].filter((r) => r !== 1).reverse();
  const gutterL = leftBands.length ? leftBands.length * (m.band + SLOT_GAP) + m.turn : m.turn;
  const gutterR = R > 1 ? m.band + SLOT_GAP + m.turn : m.turn;
  const laneW = gutterL + m.cw + gutterR + m.laneGap;
  const cardX = (lane: number) => lane * laneW + gutterL;
  const isRight = (r: number) => r === 1;
  /** A band's fixed edge: a left band is left-aligned from here, the right band right-aligned to here. */
  const anchor = (lane: number, r: number) => isRight(r)
    ? lane * laneW + gutterL + m.cw + gutterR - SLOT_GAP
    : lane * laneW + SLOT_GAP + leftBands.indexOf(r) * (m.band + SLOT_GAP);
  const widthOf = (v: number, r: number) => Math.max(0, Math.min(1, v / (p.resources[r].limit || 1))) * m.band;

  // Rows: the source, then one per rung depth; every plan sits on the last.
  const depth = Math.max(0, ...p.rungs.filter((r) => r.kind !== "plan").map((r) => r.rung + 1));
  const rowOfRung = (r: LadderRung) => (r.kind === "plan" ? depth : r.rung);
  const boxes = new Map<string, Box>();
  const put = (key: string, lane: number, row: number, on: boolean) => boxes.set(key, { key, lane, row, x: cardX(lane), y: 0, w: m.cw, h: heights.get(key) ?? 0, on });
  const childOf = (n: LadderRung, branch: 0 | 1) => kids.get(n.id)!.find((k) => (k.branch ?? 0) === branch)!;
  for (const n of p.rungs) {
    const mainOn = path.has(n.id) && (n.kind !== "tossup" || path.has(childOf(n, 0).id));
    put(`r${n.id}`, laneX.get(n.id)!, rowOfRung(n), mainOn);
    if (n.kind === "tossup") { const c1 = childOf(n, 1); put(`a${n.id}`, laneX.get(c1.id)!, n.rung, path.has(c1.id)); }
  }
  const srcH = heights.get("source") ?? 0;
  boxes.set("source", { key: "source", lane: 0, row: -1, x: 0, y: 0, w: gutterL + m.cw + gutterR, h: srcH, on: true });
  const rowH = new Array(depth + 1).fill(0);
  for (const b of boxes.values()) if (b.row >= 0) rowH[b.row] = Math.max(rowH[b.row], b.h);
  const rowY: number[] = [];
  let y = srcH + m.rowGap;
  for (let k = 0; k <= depth; k++) { rowY[k] = y; y += rowH[k] + m.rowGap; }
  for (const b of boxes.values()) if (b.row >= 0) b.y = rowY[b.row];
  const height = y - m.rowGap, width = Math.max(boxes.get("source")!.w, lanes * laneW - m.laneGap);

  // What each box takes from each band, and what passes on below it.
  const before = (key: string): number[] => {
    const n = byId.get(Number(key.slice(1)))!;
    return n.left;
  };
  const spent = (key: string): number[] => {
    const n = byId.get(Number(key.slice(1)))!;
    if (key[0] === "a") return p.options[n.rival!].costs;
    if (n.kind === "plan") return n.left;
    return p.options[n.pick!].costs;
  };
  /** The next box down the same lane. */
  const nextBox = (key: string): string | null => {
    const n = byId.get(Number(key.slice(1)))!;
    if (key[0] === "a") return `r${childOf(n, 1).id}`;
    if (n.kind === "plan") return null;
    return `r${(n.kind === "tossup" ? childOf(n, 0) : kids.get(n.id)![0]).id}`;
  };
  const reached = (key: string): boolean => key === "source" || (key[0] === "a" ? boxes.get(key)!.on : path.has(Number(key.slice(1))));

  const pieces: Piece[] = [];
  const junction = (b: Box) => b.y + ENTER - TURN_V;

  // A vertical stretch of band r in `lane` between two heights.
  const trunk = (lane: number, r: number, w: number, ya: number, yb: number, from: string, to: string, on: boolean, ghost: boolean) => {
    if (w <= 0 || yb <= ya) return;
    const a = anchor(lane, r);
    const xl = isRight(r) ? a - w : a;
    pieces.push({ kind: "trunk", band: r, d: `M${xl} ${ya}H${xl + w}V${yb}H${xl}Z`, on, ghost, width: w, from, to, x0: xl, y0: ya, x1: xl, y1: yb });
  };
  // The part of band r a box spends, turning off the trunk into the box's side.
  const turn = (b: Box, r: number, wBefore: number, wAfter: number, on: boolean) => {
    const t = wBefore - wAfter;
    if (t <= 0.01) return;
    const a = anchor(b.lane, r), yS = junction(b), ye = b.y + ENTER;
    if (isRight(r)) {
      const xo = a - wBefore, xi = a - wAfter, X = b.x + b.w;
      const d = `M${xo} ${yS}C${xo} ${yS + 0.6 * (ye - yS)} ${X + 0.6 * (xo - X)} ${ye} ${X} ${ye}`
        + `L${X} ${ye + t}C${X + 0.6 * (xi - X)} ${ye + t} ${xi} ${yS + 0.6 * (ye + t - yS)} ${xi} ${yS}Z`;
      pieces.push({ kind: "turn", band: r, d, on, ghost: false, width: t, from: b.key, to: b.key, x0: xo, y0: yS, x1: X, y1: ye });
    } else {
      const xo = a + wBefore, xi = a + wAfter, X = b.x;
      const d = `M${xo} ${yS}C${xo} ${yS + 0.6 * (ye - yS)} ${X - 0.6 * (X - xo)} ${ye} ${X} ${ye}`
        + `L${X} ${ye + t}C${X - 0.6 * (X - xi)} ${ye + t} ${xi} ${yS + 0.6 * (ye + t - yS)} ${xi} ${yS}Z`;
      pieces.push({ kind: "turn", band: r, d, on, ghost: false, width: t, from: b.key, to: b.key, x0: xo, y0: yS, x1: X, y1: ye });
    }
  };
  // A flowchart edge from one box's bottom to another's top, elbowed when they sit in different lanes.
  const line = (from: Box, to: Box, on: boolean, ghost: boolean, elbowY?: number) => {
    const xa = from.key === "source" ? cardX(0) + m.cw / 2 : from.x + from.w / 2, ya = from.y + from.h;
    const xb = to.x + to.w / 2, yb = to.y;
    const ym = elbowY ?? (ya + yb) / 2;
    const d = xa === xb ? `M${xa} ${ya}V${yb}` : `M${xa} ${ya}V${ym}H${xb}V${yb}`;
    pieces.push({ kind: "line", band: null, d, on, ghost, width: 1.5, from: from.key, to: to.key, x0: xa, y0: ya, x1: xb, y1: yb });
  };

  // Walk each lane's chain of boxes, from the source (lane 0) or from a toss-up's alternative card.
  const walkChain = (first: string, feedFrom: { key: string; y: number }, feedOn: boolean, ghostFeed: boolean, crossFed = false) => {
    let key: string | null = first;
    let above = feedFrom;
    let aboveOn = feedOn;
    let ghost = ghostFeed;
    while (key) {
      const b = boxes.get(key)!;
      const bef = before(key), sp = spent(key);
      for (let r = 0; r < R; r++) {
        const wB = widthOf(bef[r], r);
        if (!crossFed) trunk(b.lane, r, wB, above.y, junction(b), above.key, key, aboveOn && reached(key), ghost);
        turn(b, r, wB, widthOf(bef[r] - sp[r], r), b.on);
      }
      ghost = false;
      crossFed = false;
      const nk = nextBox(key);
      if (nk) {
        const nb = boxes.get(nk)!;
        line(b, nb, b.on && reached(nk), false);
        above = { key, y: junction(b) };
        aboveOn = b.on;
      }
      key = nk;
    }
  };
  const root = p.rungs.find((r) => r.parent == null);
  if (root) {
    const src = boxes.get("source")!;
    line(src, boxes.get(`r${root.id}`)!, true, false);
    walkChain(`r${root.id}`, { key: "source", y: src.h }, true, false);
  }
  // Each toss-up: a dashed copy of the budget crosses to the alternative's lane, then that lane's chain. The copy turns
  // flat, runs across the gap above the row, and turns down, so its thickness stays the band's. Band 1 runs highest
  // so the left bands can drop into the alternative's lane without crossing it.
  for (const n of p.rungs) {
    if (n.kind !== "tossup") continue;
    const main = boxes.get(`r${n.id}`)!, alt = boxes.get(`a${n.id}`)!;
    const on = alt.on;
    const gapTop = main.y - m.rowGap + 6, yB = junction(alt);
    const order = [...Array(R).keys()].sort((a, b) => (a === 1 ? -1 : b === 1 ? 1 : a - b));
    let yh = gapTop + RAD;
    for (const r of order) {
      const w = widthOf(n.left[r], r);
      if (w <= 0) continue;
      const aL = anchor(main.lane, r), aK = anchor(alt.lane, r);
      const xL = isRight(r) ? aL - w : aL, xK = isRight(r) ? aK - w : aK;
      const k = 0.5523, ri = RAD, ro = RAD + w, y0 = yh - ri;
      const d = `M${xL} ${y0}`
        + `C${xL} ${y0 + k * ro} ${xL + w + ri - k * ro} ${yh + w} ${xL + w + ri} ${yh + w}`
        + `H${xK - ri}`
        + `C${xK - ri + k * ri} ${yh + w} ${xK} ${yh + w + ri - k * ri} ${xK} ${yh + w + ri}`
        + `V${yB}H${xK + w}V${yh + w + ri}`
        + `C${xK + w} ${yh + w + ri - k * ro} ${xK - ri + k * ro} ${yh} ${xK - ri} ${yh}`
        + `H${xL + w + ri}`
        + `C${xL + w + ri - k * ri} ${yh} ${xL + w} ${y0 + k * ri} ${xL + w} ${y0}Z`;
      pieces.push({ kind: "cross", band: r, d, on, ghost: true, width: w, from: main.key, to: alt.key, x0: xL, y0, x1: xK, y1: yB });
      yh += w + 3;
    }
    const pred = n.parent == null ? boxes.get("source")! : predecessorBox(n);
    line(pred, alt, on, true, main.y - m.rowGap / 2);
    walkChain(alt.key, { key: main.key, y: yB }, on, true, true);
  }

  function predecessorBox(n: LadderRung): Box {
    const par = byId.get(n.parent!)!;
    // Reached from a toss-up's alternative side, the box above is that alternative card.
    if (par.kind === "tossup" && n.branch === 1) return boxes.get(`a${par.id}`)!;
    return boxes.get(`r${par.id}`)!;
  }

  return { boxes, pieces, width, height, gutterL, gutterR, laneW };
}

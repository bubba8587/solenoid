// [[C122]] choiceLadder
import { solError } from "../errorValue";
import type { LadderRung, LadderStruck, LadderSwitch } from "../chartValue";

/** One option, in rank order: its Decision Matrix score, each criterion's signed share of it, and what it costs per resource. */
export interface LadderOption { score: number; contrib: number[]; costs: number[] }

export interface LadderResult {
  /** Top rung first; the last is the plan. */
  rungs: LadderRung[];
  /** The best possible score with no choices made. */
  bestTotal: number;
  /** What taking options straight down the ranking scores. */
  rankingTotal: number;
  /** The choices honored, in the order made, and those dropped because they no longer fit with the rest. */
  kept: number[];
  dropped: number[];
}

/** What a viewer can do to a Choice Ladder's choices: take an option, undo one, or clear them all. */
export type LadderAction = { add: string } | { remove: string } | { reset: true };

/** The choices after an action, matched by name trimmed and case-insensitive: a take appends (moving to the end if already
 *  there), an undo removes. */
export function nextChoices(choices: readonly string[], a: LadderAction): string[] {
  const key = (s: string) => s.trim().toLowerCase();
  if ("reset" in a) return [];
  if ("remove" in a) return choices.filter((c) => key(c) !== key(a.remove));
  return [...choices.filter((c) => key(c) !== key(a.add)), a.add];
}

export const LADDER_MAX_OPTIONS = 40;
/** How many options outside the plan a rung weighs as its rival, best-ranked first. */
const RIVALS_WEIGHED = 15;
const SEARCH_BUDGET = 2_000_000;
const EPS = 1e-9;

const round4 = (x: number): number => { const r = Math.round(x * 1e4) / 1e4; return r === 0 ? 0 : r; };

/** Two sets of options compared. Each weight may be off by ±tol; in the worst case every one moves against the side ahead,
 *  so its lead (the sum of the signed criterion differences) shrinks by tol times the sum of their sizes. */
export function compareSets(a: number[], b: number[], opts: LadderOption[], tol: number): { margin: number; tossUp: boolean; flipsAt: number | null; pulls: number[] } {
  const k = opts[0]?.contrib.length ?? 0;
  let lead = 0, swing = 0;
  const pulls: number[] = [];
  for (let j = 0; j < k; j++) {
    let d = 0;
    for (const i of a) d += opts[i].contrib[j];
    for (const i of b) d -= opts[i].contrib[j];
    lead += d; swing += Math.abs(d);
    pulls.push(round4(d));
  }
  return {
    margin: round4(lead),
    tossUp: Math.abs(lead) <= tol * swing + EPS,
    flipsAt: swing > EPS ? Math.abs(lead) / swing : null,
    pulls,
  };
}

const fits = (o: LadderOption, left: number[]): boolean => o.costs.every((c, r) => c <= left[r] + EPS);
const spend = (left: number[], o: LadderOption): number[] => left.map((l, r) => l - o.costs[r]);

/** The best plan from `pool` (positions into `opts`, in rank order) within `left`: the highest total score, then the most
 *  left over as a share of the limits. Exact branch and bound; each resource's fractional fill caps what a branch can reach. */
export function bestPlan(pool: number[], left: number[], opts: LadderOption[], limits: number[]): { ids: number[]; total: number } {
  const R = limits.length, n = pool.length;
  const slack = (l: number[]) => l.reduce((s, v, r) => s + v / (limits[r] || 1), 0);
  const byRatio = Array.from({ length: R }, (_, r) =>
    [...pool.keys()].sort((x, y) => ratio(opts[pool[y]], r) - ratio(opts[pool[x]], r)));
  let best = { total: 0, ids: [] as number[], slack: slack(left) };
  const ids: number[] = [];
  let visits = 0;
  const bound = (from: number, l: number[]): number => {
    let cap = Infinity;
    for (let r = 0; r < Math.max(1, R); r++) {
      let room = R ? l[r] : Infinity, sum = 0;
      for (const p of R ? byRatio[r] : [...pool.keys()]) {
        if (p < from) continue;
        const o = opts[pool[p]];
        if (o.score <= 0 || !fits(o, l)) continue;
        const c = R ? o.costs[r] : 0;
        if (c <= room + EPS) { sum += o.score; room -= c; }
        else { sum += o.score * (room / c); break; }
      }
      cap = Math.min(cap, sum);
    }
    return cap;
  };
  const dfs = (i: number, l: number[], total: number) => {
    if (++visits > SEARCH_BUDGET) throw solError("#VALUE!", "Choice Ladder: too many close combinations to search; narrow the options");
    if (total > best.total + EPS || (Math.abs(total - best.total) <= EPS && slack(l) > best.slack + EPS)) {
      best = { total, ids: [...ids], slack: slack(l) };
    }
    if (i >= n || total + bound(i, l) < best.total - EPS) return;
    const o = opts[pool[i]];
    if (o.score > 0 && fits(o, l)) {
      ids.push(pool[i]);
      dfs(i + 1, spend(l, o), total + o.score);
      ids.pop();
    }
    dfs(i + 1, l, total);
  };
  dfs(0, left, 0);
  return { ids: best.ids, total: round4(best.total) };
}

function ratio(o: LadderOption, r: number): number {
  const c = o.costs[r];
  return c > EPS ? o.score / c : o.score > 0 ? Infinity : -Infinity;
}

/** Walks the ranking one rung at a time toward the best plan that holds every choice in `chosen` (option positions, in the
 *  order made). A rung takes the best-ranked option in that plan. It is a toss-up when an option outside the plan leads to
 *  a plan that can't also hold the pick and that the wiggle can't tell from it; taking that rival is a choice, and the pick
 *  it displaced stays in the pool. A rung whose pick is a choice offers the way back. */
export function buildLadder(opts: LadderOption[], limits: number[], tol: number, chosen: number[] = []): LadderResult {
  if (opts.length > LADDER_MAX_OPTIONS) throw solError("#VALUE!", `Choice Ladder takes at most ${LADDER_MAX_OPTIONS} options`);
  const all = opts.map((_, i) => i);
  const sumScore = (ids: number[]) => round4(ids.reduce((s, i) => s + opts[i].score, 0));
  const only = (a: number[], b: number[]) => a.filter((i) => !b.includes(i));

  /** The best plan from what's left that holds every option in `must`, or null when they can't all fit. */
  const planWith = (out: Set<number>, left: number[], must: number[]): { ids: number[]; total: number } | null => {
    let l = left;
    for (const i of must) { if (opts[i].score <= 0 || !fits(opts[i], l)) return null; l = spend(l, opts[i]); }
    const p = bestPlan(all.filter((i) => !out.has(i) && !must.includes(i)), l, opts, limits);
    const ids = [...must, ...p.ids].sort((x, y) => x - y);
    return { ids, total: sumScore(ids) };
  };

  // Keep the choices that fit together, earliest first; a later one that no longer fits is dropped.
  const start = new Set(all.filter((i) => opts[i].score <= 0));
  const kept: number[] = [], dropped: number[] = [];
  for (const c of chosen) {
    if (c < 0 || c >= opts.length || kept.includes(c)) continue;
    (planWith(start, limits, [...kept, c]) ? kept : dropped).push(c);
  }

  const rungs: LadderRung[] = [];
  const out = new Set(start);
  const picks: number[] = [];
  let left = [...limits];
  for (let k = 0; ; k++) {
    const must = kept.filter((c) => !picks.includes(c));
    const plan = planWith(out, left, must)!;
    const total = sumScore(picks);
    if (plan.ids.length === 0) { rungs.push({ rung: k, kind: "plan", left, total }); break; }
    const pick = plan.ids[0];
    const rung: LadderRung = { rung: k, kind: "clear", left, total, pick };

    if (kept.includes(pick)) {
      // A choice: the way back is the whole plan without it, the other choices kept.
      const without = planWith(start, limits, kept.filter((c) => c !== pick))!;
      const cur = [...picks, ...plan.ids];
      const cmp = compareSets(only(without.ids, cur), only(cur, without.ids), opts, tol);
      const back = without.ids.find((i) => !cur.includes(i));
      rung.kind = "chosen";
      rung.alt = {
        option: back ?? pick,
        brings: only(without.ids, cur).filter((i) => i !== back),
        drops: only(cur, without.ids),
        plan: without.total, margin: cmp.margin, flipsAt: cmp.flipsAt ?? 0, pulls: cmp.pulls,
      };
    } else {
      // The rival: the option outside the plan whose own best plan scores highest without the pick.
      let rival: { b: number; p: { ids: number[]; total: number } } | null = null;
      let weighed = 0;
      for (const b of all) {
        if (weighed >= RIVALS_WEIGHED) break;
        if (out.has(b) || picks.includes(b) || plan.ids.includes(b) || !fits(opts[b], left)) continue;
        weighed++;
        const pb = planWith(out, left, [...must, b]);
        if (!pb || pb.ids.includes(pick)) continue;
        if (!rival || pb.total > rival.p.total + EPS) rival = { b, p: pb };
      }
      if (rival) {
        const cmp = compareSets(only(plan.ids, rival.p.ids), only(rival.p.ids, plan.ids), opts, tol);
        if (cmp.tossUp) { rung.kind = "tossup"; rung.alt = sw(rival.b, rival.p, plan, total, { ...cmp, margin: -cmp.margin, pulls: cmp.pulls.map((v) => -v) }); }
        else rung.sturdy = { rival: rival.b, flipsAt: cmp.flipsAt };
      }
    }

    // Everything still open and ranked above the pick is struck off here.
    const struck: LadderStruck[] = [];
    for (let i = 0; i < pick; i++) {
      if (out.has(i) || picks.includes(i)) continue;
      if (!fits(opts[i], left)) {
        struck.push({ option: i, why: "fit", over: opts[i].costs.map((c, r) => Math.max(0, round4(c - left[r]))) });
      } else {
        const forced = planWith(out, left, [...must, i]);
        if (!forced) { struck.push({ option: i, why: "picks" }); continue; }
        struck.push({ option: i, why: "crowd", pushedOut: only(plan.ids, forced.ids), cost: round4(plan.total - forced.total) });
      }
    }
    if (struck.length) rung.struck = struck;
    rungs.push(rung);
    for (const s of struck) out.add(s.option);
    out.add(pick);
    picks.push(pick);
    left = spend(left, opts[pick]);
  }

  return {
    rungs,
    bestTotal: planWith(start, limits, [])!.total,
    rankingTotal: greedyTotal(opts, limits),
    kept, dropped,
  };

  /** The other way at a rung: take `option`, reaching `to`, instead of this rung's plan `from`. `cmp` is signed toward `to`. */
  function sw(option: number, to: { ids: number[]; total: number }, from: { ids: number[]; total: number }, total: number,
    cmp: { margin: number; flipsAt: number | null; pulls: number[] }): LadderSwitch {
    return {
      option,
      brings: only(to.ids, from.ids).filter((i) => i !== option),
      drops: only(from.ids, to.ids),
      plan: round4(total + to.total),
      margin: cmp.margin,
      flipsAt: cmp.flipsAt ?? 0,
      pulls: cmp.pulls,
    };
  }
}

/** Straight down the ranking, taking whatever still fits. */
export function greedyTotal(opts: LadderOption[], limits: number[]): number {
  let left = [...limits], total = 0;
  for (const o of opts) if (o.score > 0 && fits(o, left)) { left = spend(left, o); total += o.score; }
  return round4(total);
}

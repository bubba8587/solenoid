// [[C122]] choiceLadder
import { solError } from "../errorValue";
import type { LadderRung, LadderStruck } from "../chartValue";

/** One option, in rank order: its Decision Matrix score, each criterion's signed share of it, and what it costs per resource. */
export interface LadderOption { score: number; contrib: number[]; costs: number[] }

export interface LadderResult {
  rungs: LadderRung[];
  /** The id of the best plan's rung. */
  best: number;
  /** What taking options straight down the ranking scores. */
  rankingTotal: number;
}

export const LADDER_MAX_OPTIONS = 40;
const SEARCH_BUDGET = 2_000_000;
const MAX_FORKS = 3;
const MAX_PLANS = 8;
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

interface State { id: number; parent: number | null; branch: 0 | 1 | null; chosen: number[]; out: Set<number>; left: number[]; forks: number; rung: number }

/** Walks the ranking one rung at a time. A clear rung takes the best-ranked option in the best plan from here. When the best
 *  plan without that pick is a toss-up with it, the rung forks: one branch takes the pick, the other its rival. */
export function buildLadder(opts: LadderOption[], limits: number[], tol: number): LadderResult {
  if (opts.length > LADDER_MAX_OPTIONS) throw solError("#VALUE!", `Choice Ladder takes at most ${LADDER_MAX_OPTIONS} options`);
  const sumScore = (ids: number[]) => round4(ids.reduce((s, i) => s + opts[i].score, 0));
  const plan = (s: State, extraOut: number[] = [], forceIn: number | null = null): { ids: number[]; total: number } | null => {
    const out = new Set([...s.chosen, ...s.out, ...extraOut]);
    let left = s.left;
    const head: number[] = [];
    if (forceIn != null) {
      if (!fits(opts[forceIn], left)) return null;
      out.add(forceIn); left = spend(left, opts[forceIn]); head.push(forceIn);
    }
    const p = bestPlan(opts.map((_, i) => i).filter((i) => !out.has(i)), left, opts, limits);
    const ids = [...head, ...p.ids].sort((x, y) => x - y);
    return { ids, total: sumScore(ids) };
  };
  const only = (a: number[], b: number[]) => a.filter((i) => !b.includes(i));

  const rungs: LadderRung[] = [];
  const outAtStart = opts.map((o, i) => (o.score > 0 ? -1 : i)).filter((i) => i >= 0);
  const stack: State[] = [{ id: 0, parent: null, branch: null, chosen: [], out: new Set(outAtStart), left: [...limits], forks: 0, rung: 0 }];
  let plans = 0, nextId = 1;

  while (stack.length) {
    const s = stack.pop()!;
    const best = plan(s)!;
    const total = sumScore(s.chosen);
    const base = { id: s.id, parent: s.parent, branch: s.branch, rung: s.rung, left: s.left, total };
    if (best.ids.length === 0) { rungs.push({ ...base, kind: "plan" }); plans++; continue; }

    const pick = best.ids[0];
    const without = plan(s, [pick])!;
    const rival = without.ids.find((i) => !best.ids.includes(i));
    const rung: LadderRung = { ...base, kind: "clear", pick };
    let fork = false;
    if (rival != null) {
      const cmp = compareSets(only(best.ids, without.ids), only(without.ids, best.ids), opts, tol);
      fork = cmp.tossUp && s.forks < MAX_FORKS && plans + stack.length + 2 <= MAX_PLANS;
      if (fork) {
        rung.kind = "tossup";
        rung.rival = rival;
        rung.duel = {
          aBrings: only(best.ids, without.ids).filter((i) => i !== pick),
          bBrings: only(without.ids, best.ids).filter((i) => i !== rival),
          planA: round4(total + best.total), planB: round4(total + without.total),
          margin: cmp.margin, flipsAt: cmp.flipsAt ?? 0, pulls: cmp.pulls,
        };
      } else {
        rung.sturdy = { rival, flipsAt: cmp.flipsAt };
      }
    }

    // Everything still open and ranked above the pick is struck off here, bar a fork's rival.
    const struck: LadderStruck[] = [];
    for (let i = 0; i < pick; i++) {
      if (s.chosen.includes(i) || s.out.has(i) || (fork && i === rival)) continue;
      if (!fits(opts[i], s.left)) {
        struck.push({ option: i, why: "fit", over: opts[i].costs.map((c, r) => Math.max(0, round4(c - s.left[r]))) });
      } else {
        const forced = plan(s, [], i)!;
        struck.push({ option: i, why: "crowd", pushedOut: only(best.ids, forced.ids), cost: round4(best.total - forced.total) });
      }
    }
    if (struck.length) rung.struck = struck;
    rungs.push(rung);

    const struckIds = struck.map((x) => x.option);
    const child = (take: number, extraOut: number[], branch: 0 | 1 | null, keep: number[] = []): State => ({
      id: nextId++, parent: s.id, branch, chosen: [...s.chosen, take],
      out: new Set([...s.out, ...struckIds.filter((i) => !keep.includes(i)), ...extraOut]),
      left: spend(s.left, opts[take]), forks: s.forks + (fork ? 1 : 0), rung: s.rung + 1,
    });
    const kids = [child(pick, fork ? [rival!] : [], fork ? 0 : null)];
    if (fork) kids.push(child(rival!, [pick], 1, without.ids));
    stack.push(...kids.reverse());
  }

  rungs.sort((a, b) => a.id - b.id);
  const ends = rungs.filter((r) => r.kind === "plan");
  const best = ends.reduce((a, b) => (b.total > a.total + EPS ? b : a));
  return { rungs, best: best.id, rankingTotal: greedyTotal(opts, limits) };
}

/** Straight down the ranking, taking whatever still fits. */
export function greedyTotal(opts: LadderOption[], limits: number[]): number {
  let left = [...limits], total = 0;
  for (const o of opts) if (o.score > 0 && fits(o, left)) { left = spend(left, o); total += o.score; }
  return round4(total);
}

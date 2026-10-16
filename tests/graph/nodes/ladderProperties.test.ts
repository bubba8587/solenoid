// [[C122]] choiceLadder: the plan search held to exhaustive search on many small random problems.
import { describe, it, expect } from "vitest";
import { bestPlan, buildLadder, type LadderOption } from "../../../src/graph/nodes/ladderOps";

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

/** A small random problem: scores (some 0 or negative), two resources, and sparse Requires and Excludes. */
function problem(seed: number) {
  const r = rng(seed);
  const n = 3 + Math.floor(r() * 6);
  const opts: LadderOption[] = Array.from({ length: n }, () => ({
    score: Math.round((r() * 1.2 - 0.2) * 100) / 100, value: [1], costs: [1 + Math.floor(r() * 5), r() < 0.4 ? 1 : 0], requires: [], excludes: [],
  }));
  opts.forEach((o, i) => {
    if (r() < 0.25) { const j = Math.floor(r() * n); if (j !== i) o.requires.push(j); }
    if (r() < 0.25) { const j = Math.floor(r() * n); if (j !== i) o.excludes.push(j); }
  });
  const cap = 4 + Math.floor(r() * 8);
  const floor = r() < 0.5 ? Math.floor(r() * 3) : 0;
  return { opts, cap, floor };
}

const clashes = (o: LadderOption[], set: number[]) => set.some((a) => set.some((b) => a !== b && (o[a].excludes.includes(b) || o[b].excludes.includes(a))));
const closed = (o: LadderOption[], set: number[]) => set.every((a) => o[a].requires.every((q) => set.includes(q)));

/** Every subset that keeps the cap, meets the floor, clashes nowhere and carries its Requires: the best total. */
function brute(o: LadderOption[], cap: number, floor: number): number | null {
  let best: number | null = null;
  for (let mask = 0; mask < 1 << o.length; mask++) {
    const set = o.map((_, i) => i).filter((i) => mask & (1 << i));
    if (set.reduce((s, i) => s + o[i].costs[0], 0) > cap || set.reduce((s, i) => s + o[i].costs[1], 0) < floor) continue;
    if (clashes(o, set) || !closed(o, set)) continue;
    const t = set.reduce((s, i) => s + o[i].score, 0);
    if (best == null || t > best + 1e-9) best = t;
  }
  return best;
}

describe("Choice Ladder plan search against exhaustive search", () => {
  it("with a cap and a floor, the plan's total is the best possible, and none means no plan", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const { opts, cap, floor } = problem(seed);
      const open = opts.map((_, i) => i);
      const plan = bestPlan(opts, open, [], [cap, null], [0, floor]);
      const want = brute(opts, cap, floor);
      if (want == null) { expect(plan, `seed ${seed}`).toBeNull(); continue; }
      expect(plan, `seed ${seed}`).not.toBeNull();
      expect(clashes(opts, plan!) || !closed(opts, plan!), `seed ${seed}`).toBe(false);
      expect(plan!.reduce((s, i) => s + opts[i].score, 0), `seed ${seed}`).toBeCloseTo(want, 6);
    }
  });

  it("with no cap, the plan is consistent, and no group worth having (an option and its Requires) could still join it", () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const { opts } = problem(seed);
      const open = opts.map((_, i) => i);
      const plan = bestPlan(opts, open, [], [null])!;
      expect(clashes(opts, plan) || !closed(opts, plan), `seed ${seed}`).toBe(false);
      for (const o of open) {
        if (plan.includes(o) || opts[o].score < 0) continue;
        // o with everything it needs, transitively: if that whole group fits beside the plan, the plan left value behind.
        const group: number[] = [];
        const pull = (i: number) => { if (group.includes(i) || plan.includes(i)) return; group.push(i); opts[i].requires.forEach(pull); };
        pull(o);
        if (group.reduce((t, i) => t + opts[i].score, 0) < 0) continue;
        expect(clashes(opts, [...plan, ...group]), `seed ${seed}: option ${o} could join`).toBe(true);
      }
    }
  });

  it("every ladder path keeps the cap, meets the floor, clashes nowhere and carries its Requires", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { opts, cap, floor } = problem(seed);
      if (brute(opts, cap, floor) == null) continue;
      const l = buildLadder(opts, [{ limit: cap }, { limit: null, floor }], 0.05);
      for (const s of l.states.filter((x) => x.end && x.share > 0)) {
        const set = s.taken;
        expect(set.reduce((t, i) => t + opts[i].costs[0], 0), `seed ${seed}`).toBeLessThanOrEqual(cap);
        expect(set.reduce((t, i) => t + opts[i].costs[1], 0), `seed ${seed}`).toBeGreaterThanOrEqual(floor);
        expect(clashes(opts, set) || !closed(opts, set), `seed ${seed}`).toBe(false);
      }
    }
  });
});

describe("Choice Ladder: round-5 review", () => {
  it("a floor with no cap keeps the search exact after the floor is met", () => {
    // A (Veg), B excludes C and D: A, C, D (1.9) beat A, B (1.7).
    const o = (score: number, veg: number, excludes: number[] = []): LadderOption => ({ score, value: [score], costs: [veg], requires: [], excludes });
    const opts = [o(0.9, 1), o(0.8, 0, [2, 3]), o(0.5, 0), o(0.5, 0)];
    const l = buildLadder(opts, [{ limit: null, floor: 1 }], 0);
    expect(l.main.map((e) => l.edges[e].pick).sort()).toEqual([0, 2, 3]);
  });
  it("with no cap, a harmful requirement comes only when the pair is worth having", () => {
    const o = (score: number, requires: number[] = []): LadderOption => ({ score, value: [score], costs: [], requires, excludes: [] });
    expect(bestPlan([o(0.33, [1]), o(-0.67), o(0.19)], [0, 1, 2], [], [])).toEqual([2]);
    expect(bestPlan([o(0.9, [1]), o(-0.2), o(0.19)], [0, 1, 2], [], [])!.sort()).toEqual([0, 1, 2]);
  });
});

describe("Choice Ladder forks against exhaustive search", () => {
  it("taking either side of a fork at the top gives the best plan that holds that side", () => {
    let forks = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const { opts, cap, floor } = problem(seed);
      if (brute(opts, cap, floor) == null) continue;
      const res = [{ limit: cap }, { limit: null, floor }];
      const l = buildLadder(opts, res, 0.15);
      for (const e of l.edges.filter((x) => x.from === 0 && x.kind === "close")) {
        forks++;
        const c = buildLadder(opts, res, 0.15, [e.pick]);
        const plan = c.main.map((k) => c.edges[k].pick);
        const withIt = opts.map((o) => ({ ...o }));
        // The best plan holding e.pick: exhaustive search over the rest with e.pick forced in.
        let best = -Infinity;
        for (let mask = 0; mask < 1 << opts.length; mask++) {
          if (!(mask & (1 << e.pick))) continue;
          const set = opts.map((_, i) => i).filter((i) => mask & (1 << i));
          if (set.reduce((s, i) => s + opts[i].costs[0], 0) > cap || set.reduce((s, i) => s + opts[i].costs[1], 0) < floor) continue;
          if (clashes(withIt, set) || !closed(withIt, set)) continue;
          best = Math.max(best, set.reduce((s, i) => s + opts[i].score, 0));
        }
        expect(plan.reduce((s, i) => s + opts[i].score, 0), `seed ${seed}, fork side ${e.pick}`).toBeCloseTo(best, 6);
      }
    }
    expect(forks).toBeGreaterThan(20);
  });
});

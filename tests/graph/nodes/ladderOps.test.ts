// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { buildLadder, bestPlan, compareSets, greedyTotal, type LadderOption } from "../../../src/graph/nodes/ladderOps";

/** Options scored as the Decision Matrix does under ÷Max, in rank order. */
function scored(values: number[][], weights: number[], costs: number[][]): LadderOption[] {
  const maxAbs = weights.map((_, j) => Math.max(...values.map((v) => Math.abs(v[j]))));
  const sumW = weights.reduce((s, w) => s + Math.abs(w), 0);
  const opts = values.map((v, i) => {
    const contrib = weights.map((w, j) => (maxAbs[j] ? v[j] / maxAbs[j] : 0) * w / sumW);
    return { score: Math.round(contrib.reduce((s, c) => s + c, 0) * 1e4) / 1e4, contrib, costs: costs[i] };
  });
  return opts.sort((a, b) => b.score - a.score);
}

// Food, Uniqueness, Vibe, Buzz, Ease; costs Price and Meals.
const RESTAURANTS = scored(
  [[10, 8, 9, 9, 3], [9, 9, 7, 8, 4], [8, 5, 9, 7, 7], [8, 6, 5, 7, 9], [7, 5, 6, 8, 9], [8, 7, 8, 6, 6],
   [9, 8, 6, 7, 5], [6, 4, 4, 6, 10], [8, 8, 7, 5, 6], [5, 5, 10, 8, 6], [7, 6, 6, 7, 8], [8, 9, 8, 6, 5]],
  [5, 4, 3, 2, 1],
  [[220, 2], [160, 1], [75, 1], [18, 1], [22, 1], [90, 1], [110, 1], [15, 1], [45, 1], [60, 1], [30, 1], [140, 2]],
);
// Urgency, Comfort, Resale, Savings, Disruption (counts against); costs Budget and Weekends.
const HOUSE = scored(
  [[10, 4, 6, 5, 4], [3, 8, 9, 2, 9], [4, 7, 8, 2, 7], [6, 7, 4, 9, 2], [5, 9, 6, 9, 3], [2, 6, 6, 1, 5], [1, 7, 7, 1, 4],
   [5, 7, 7, 7, 5], [1, 5, 5, 2, 2], [3, 5, 2, 6, 1], [3, 4, 5, 1, 3], [7, 2, 3, 6, 1], [8, 6, 4, 6, 2]],
  [5, 4, 3, 3, -2],
  [[8500, 1], [14000, 4], [9000, 3], [3200, 1], [11000, 1], [1800, 3], [6500, 4], [12000, 2], [2500, 3], [350, 1], [4200, 2], [1500, 1], [2800, 1]],
);

function brute(opts: LadderOption[], limits: number[]): number {
  let best = 0;
  for (let mask = 0; mask < 1 << opts.length; mask++) {
    const left = [...limits]; let tot = 0, ok = true;
    for (let i = 0; i < opts.length && ok; i++) if (mask & (1 << i)) {
      if (opts[i].score <= 0) { ok = false; break; }
      opts[i].costs.forEach((c, r) => { left[r] -= c; if (left[r] < -1e-9) ok = false; });
      tot += opts[i].score;
    }
    if (ok && tot > best) best = tot;
  }
  return Math.round(best * 1e4) / 1e4;
}
const bestOf = (l: ReturnType<typeof buildLadder>) => l.rungs.find((r) => r.id === l.best)!;

describe.each([["restaurants", RESTAURANTS, [450, 6]], ["house projects", HOUSE, [25000, 10]]] as const)("Choice Ladder kernel: %s", (_n, opts, limits) => {
  it("its main line is the true best set", () => {
    expect(bestOf(buildLadder(opts, [...limits], 0.25)).total).toBe(brute(opts, [...limits]));
  });

  it("beats or matches taking options straight down the ranking", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    expect(bestOf(l).total).toBeGreaterThanOrEqual(l.rankingTotal);
    expect(bestOf(l).total).toBeGreaterThan(l.rankingTotal); // both scenarios are built so the ranking alone falls short
  });

  it("forks at the default wiggle, and every fork is within it", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    const forks = l.rungs.filter((r) => r.kind === "tossup");
    expect(forks.length).toBeGreaterThan(0);
    for (const f of forks) expect(f.duel!.flipsAt).toBeLessThanOrEqual(0.25 + 1e-9);
  });

  it("no plan overspends a limit", () => {
    for (const r of buildLadder(opts, [...limits], 0.5).rungs) for (const v of r.left) expect(v).toBeGreaterThanOrEqual(-1e-9);
  });

  it("with no binding limit it is the ranking, every rung clear", () => {
    const l = buildLadder(opts, limits.map(() => 1e12), 0.25);
    expect(l.rungs.every((r) => r.kind !== "tossup")).toBe(true);
    expect(l.rungs.filter((r) => r.kind === "clear").map((r) => r.pick)).toEqual(opts.map((o, i) => (o.score > 0 ? i : -1)).filter((i) => i >= 0));
  });

  it("with nothing affordable it is one empty plan", () => {
    const l = buildLadder(opts, limits.map(() => 0), 0.25);
    expect(l.rungs).toHaveLength(1);
    expect(l.rungs[0].kind).toBe("plan");
  });

  it("at zero wiggle forks only on an exact tie", () => {
    for (const r of buildLadder(opts, [...limits], 0).rungs) if (r.kind === "tossup") expect(r.duel!.margin).toBe(0);
  });

  it("keeps its main line optimal across random limits", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 30; k++) {
      const lim = limits.map((v) => Math.round(v * (0.2 + 1.2 * rnd())));
      expect(bestOf(buildLadder(opts, lim, rnd() * 0.5)).total).toBe(brute(opts, lim));
    }
  });
});

describe("Choice Ladder kernel: rungs", () => {
  const l = buildLadder(RESTAURANTS, [450, 6], 0.25);
  it("strikes off the top-ranked tasting menu for what it crowds out", () => {
    const first = l.rungs[0];
    expect(first.kind).toBe("clear");
    expect(first.pick).toBe(1);
    expect(first.struck).toEqual([expect.objectContaining({ option: 0, why: "crowd" })]);
    expect(first.struck![0].cost).toBeGreaterThan(0);
  });
  it("a toss-up names what each side brings along and whose side leads", () => {
    const fork = l.rungs.find((r) => r.kind === "tossup")!;
    expect(fork.duel!.planA).toBeGreaterThanOrEqual(fork.duel!.planB);
    expect(fork.duel!.margin).toBeGreaterThanOrEqual(0);
    expect(fork.duel!.pulls).toHaveLength(5);
    expect(l.rungs.filter((r) => r.parent === fork.id).map((r) => r.branch)).toEqual([0, 1]);
  });
  it("a clear rung carries its rival and the wiggle that would flip it", () => {
    const sturdy = l.rungs.find((r) => r.kind === "clear" && r.sturdy)!;
    expect(sturdy.sturdy!.flipsAt).toBeGreaterThan(0.25);
  });
});

describe("Choice Ladder kernel: pieces", () => {
  it("a criterion's pull keeps its sign", () => {
    const opts: LadderOption[] = [{ score: 0.5, contrib: [0.5, 0], costs: [] }, { score: 0.4, contrib: [0, 0.4], costs: [] }];
    const c = compareSets([0], [1], opts, 0);
    expect(c.pulls).toEqual([0.5, -0.4]);
    expect(c.margin).toBe(0.1);
    expect(c.flipsAt).toBeCloseTo(0.1 / 0.9);
  });
  it("bestPlan breaks a tied score toward what leaves more", () => {
    const opts: LadderOption[] = [{ score: 1, contrib: [1], costs: [5] }, { score: 1, contrib: [1], costs: [2] }];
    expect(bestPlan([0, 1], [5], opts, [5]).ids).toEqual([1]);
  });
  it("an option scoring zero or below is never picked", () => {
    const opts: LadderOption[] = [{ score: 0.5, contrib: [0.5], costs: [1] }, { score: 0, contrib: [0], costs: [0] }];
    expect(bestOf(buildLadder(opts, [10], 0.25)).rung).toBe(1);
  });
  it("greedyTotal takes whatever still fits, in rank order", () => {
    expect(greedyTotal(RESTAURANTS, [450, 6])).toBe(3.2215);
  });
  it("refuses more options than it searches", () => {
    const many = Array.from({ length: 41 }, () => ({ score: 0.5, contrib: [0.5], costs: [1] }));
    expect(() => buildLadder(many, [10], 0.25)).toThrow();
  });
  it("stays quick on 40 options with two limits", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const opts = Array.from({ length: 40 }, () => {
      const s = Math.round(rnd() * 1e4) / 1e4;
      return { score: s, contrib: [s], costs: [Math.round(10 + rnd() * 200), 1 + Math.floor(rnd() * 2)] };
    }).sort((a, b) => b.score - a.score);
    const t = performance.now();
    buildLadder(opts, [600, 8], 0.25);
    expect(performance.now() - t).toBeLessThan(3000);
  });
});

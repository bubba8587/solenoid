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

/** The best total among plans holding every option in `must`, by brute force. */
function brute(opts: LadderOption[], limits: number[], must: number[] = []): number {
  let best = 0;
  for (let mask = 0; mask < 1 << opts.length; mask++) {
    if (must.some((m) => !(mask & (1 << m)))) continue;
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
const planOf = (l: ReturnType<typeof buildLadder>) => l.rungs[l.rungs.length - 1];
const picksOf = (l: ReturnType<typeof buildLadder>) => l.rungs.filter((r) => r.kind !== "plan").map((r) => r.pick!);
const nameIn = (opts: LadderOption[], score: number) => opts.findIndex((o) => o.score === score);

describe.each([["restaurants", RESTAURANTS, [450, 6]], ["house projects", HOUSE, [25000, 10]]] as const)("Choice Ladder kernel: %s", (_n, opts, limits) => {
  it("with no choices it reaches the true best set", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    expect(planOf(l).total).toBe(brute(opts, [...limits]));
    expect(l.bestTotal).toBe(planOf(l).total);
  });

  it("beats taking options straight down the ranking", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    expect(planOf(l).total).toBeGreaterThan(l.rankingTotal);
  });

  it("takes each option once, in rank order apart from choices, within every limit", () => {
    const l = buildLadder(opts, [...limits], 0.4);
    const picks = picksOf(l);
    expect(new Set(picks).size).toBe(picks.length);
    expect(picks).toEqual([...picks].sort((a, b) => a - b));
    for (const v of planOf(l).left) expect(v).toBeGreaterThanOrEqual(-1e-9);
  });

  it("offers toss-ups only within the wiggle, and only when the rival's plan can't also hold the pick", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    const forks = l.rungs.filter((r) => r.kind === "tossup");
    expect(forks.length).toBeGreaterThan(0);
    for (const f of forks) {
      expect(f.alt!.flipsAt).toBeLessThanOrEqual(0.25 + 1e-9);
      expect(f.alt!.drops).toContain(f.pick);
      expect(f.alt!.plan).toBeLessThanOrEqual(planOf(l).total + 1e-9);
    }
  });

  it("taking a toss-up's other way lands on the plan it previewed, the best plan that holds it", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    for (const f of l.rungs.filter((r) => r.kind === "tossup")) {
      const after = buildLadder(opts, [...limits], 0.25, [f.alt!.option]);
      expect(planOf(after).total).toBe(f.alt!.plan);
      expect(planOf(after).total).toBe(brute(opts, [...limits], [f.alt!.option]));
      expect(picksOf(after)).toContain(f.alt!.option);
      expect(after.kept).toEqual([f.alt!.option]);
    }
  });

  it("marks a choice as yours and its way back reaches the plan without it", () => {
    const l = buildLadder(opts, [...limits], 0.25);
    const f = l.rungs.find((r) => r.kind === "tossup")!;
    const after = buildLadder(opts, [...limits], 0.25, [f.alt!.option]);
    const mine = after.rungs.find((r) => r.pick === f.alt!.option)!;
    expect(mine.kind).toBe("chosen");
    expect(mine.alt!.plan).toBe(planOf(l).total);
  });

  it("with no binding limit it is the ranking, every rung clear", () => {
    const l = buildLadder(opts, limits.map(() => 1e12), 0.25);
    expect(l.rungs.every((r) => r.kind === "clear" || r.kind === "plan")).toBe(true);
    expect(picksOf(l)).toEqual(opts.map((o, i) => (o.score > 0 ? i : -1)).filter((i) => i >= 0));
  });

  it("with nothing affordable it is one empty plan", () => {
    const l = buildLadder(opts, limits.map(() => 0), 0.25);
    expect(l.rungs).toEqual([expect.objectContaining({ kind: "plan", rung: 0 })]);
  });

  it("keeps the best set across random limits and random choices", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 30; k++) {
      const lim = limits.map((v) => Math.round(v * (0.2 + 1.2 * rnd())));
      const choice = Math.floor(rnd() * opts.length);
      const l = buildLadder(opts, lim, rnd() * 0.5, [choice]);
      expect(planOf(l).total).toBe(brute(opts, lim, l.kept));
      expect(l.bestTotal).toBe(brute(opts, lim));
    }
  });
});

describe("Choice Ladder kernel: the restaurant trip", () => {
  const l = buildLadder(RESTAURANTS, [450, 6], 0.25);
  const MARROW = nameIn(RESTAURANTS, 0.7941), LUNE = nameIn(RESTAURANTS, 0.7452), OYSTER = nameIn(RESTAURANTS, 0.763);
  it("strikes off the top-ranked tasting menu for what it crowds out", () => {
    expect(l.rungs[0]).toMatchObject({ kind: "clear", pick: 1 });
    expect(l.rungs[0].struck).toEqual([expect.objectContaining({ option: 0, why: "crowd" })]);
  });
  it("never pairs two options a plan can hold together: Lune bistro is no rival to Marrow", () => {
    const marrow = l.rungs.find((r) => r.pick === MARROW)!;
    expect(marrow.alt?.option).not.toBe(LUNE);
  });
  it("offers the runner-up plan where the real trade-off is: Brass Oyster or Lune bistro", () => {
    const oyster = l.rungs.find((r) => r.pick === OYSTER)!;
    expect(oyster).toMatchObject({ kind: "tossup", alt: expect.objectContaining({ option: LUNE, plan: 4.5452 }) });
  });
  it("keeps Marrow after choosing Lune bistro, since both fit", () => {
    const after = buildLadder(RESTAURANTS, [450, 6], 0.25, [LUNE]);
    expect(picksOf(after)).toEqual(expect.arrayContaining([MARROW, LUNE]));
  });
});

describe("Choice Ladder kernel: choices", () => {
  it("drops a later choice that no longer fits with the earlier ones, and says so", () => {
    // Hearth & Ember and Fennel (ranked 1st and 3rd) take 4 meals; with 4 meals, Kato can't join them.
    const l = buildLadder(RESTAURANTS, [450, 4], 0.25, [0, 2, 1]);
    expect(l.kept).toEqual([0, 2]);
    expect(l.dropped).toEqual([1]);
  });
  it("an option ranked above that can't join the choices is struck as such", () => {
    const l = buildLadder(RESTAURANTS, [450, 6], 0.25, [0, 2]);
    expect(l.rungs.some((r) => r.struck?.some((x) => x.why === "picks"))).toBe(true);
  });
  it("a choice the best plan takes anyway still shows as yours, its way back being itself", () => {
    const l = buildLadder(RESTAURANTS, [450, 6], 0.25, [1]);
    expect(l.rungs[0]).toMatchObject({ kind: "chosen", pick: 1, alt: expect.objectContaining({ option: 1 }) });
  });
  it("ignores a choice that names no option", () => {
    expect(buildLadder(RESTAURANTS, [450, 6], 0.25, [99]).kept).toEqual([]);
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
    expect(picksOf(buildLadder(opts, [10], 0.25))).toEqual([0]);
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
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

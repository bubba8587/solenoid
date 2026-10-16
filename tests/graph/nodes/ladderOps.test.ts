// [[C122]] choiceLadder
import { describe, it, expect } from "vitest";
import { buildLadder, bestPlan, priorities, isClose, nextChoices, type LadderOption, type LadderResource } from "../../../src/graph/nodes/ladderOps";

const opt = (score: number, costs: number[] = [], requires: number[] = [], excludes: number[] = []): LadderOption =>
  ({ score, value: [score], costs, requires, excludes });

/** Options scored as the Decision Matrix does under ÷Max, in rank order. */
function scored(values: number[][], weights: number[], costs: number[][]): LadderOption[] {
  const maxAbs = weights.map((_, j) => Math.max(...values.map((v) => Math.abs(v[j]))));
  const sumW = weights.reduce((s, w) => s + Math.abs(w), 0);
  return values.map((v, i) => {
    const contrib = weights.map((w, j) => (maxAbs[j] ? v[j] / maxAbs[j] : 0) * w / sumW);
    return opt(Math.round(contrib.reduce((s, c) => s + c, 0) * 1e4) / 1e4, costs[i]);
  }).sort((a, b) => b.score - a.score);
}

// Food, Uniqueness, Vibe, Buzz, Ease; costs Dollars and Meals.
const RESTAURANTS = scored(
  [[10, 8, 9, 9, 3], [9, 9, 7, 8, 4], [8, 5, 9, 7, 7], [8, 6, 5, 7, 9], [7, 5, 6, 8, 9], [8, 7, 8, 6, 6],
   [9, 8, 6, 7, 5], [6, 4, 4, 6, 10], [8, 8, 7, 5, 6], [5, 5, 10, 8, 6], [7, 6, 6, 7, 8], [8, 9, 8, 6, 5]],
  [5, 4, 3, 2, 1],
  [[220, 2], [160, 1], [75, 1], [18, 1], [22, 1], [90, 1], [110, 1], [15, 1], [45, 1], [60, 1], [30, 1], [140, 2]],
);
const MEALS: LadderResource[] = [{ limit: 450 }, { limit: 6 }];

function brute(opts: LadderOption[], limits: number[]): number {
  let best = 0;
  for (let mask = 0; mask < 1 << opts.length; mask++) {
    const left = [...limits]; let tot = 0, ok = true;
    for (let i = 0; i < opts.length && ok; i++) if (mask & (1 << i)) {
      opts[i].costs.forEach((c, r) => { left[r] -= c; if (left[r] < -1e-9) ok = false; });
      tot += opts[i].score;
    }
    if (ok && tot > best) best = tot;
  }
  return Math.round(best * 1e4) / 1e4;
}
type L = ReturnType<typeof buildLadder>;
const mainPicks = (l: L) => l.main.map((e) => l.edges[e].pick);
/** Every root-to-end path, as the picks along it. */
function paths(l: L): number[][] {
  const out: number[][] = [];
  const walk = (s: number, acc: number[]) => {
    const es = l.edges.filter((e) => e.from === s);
    if (!es.length) { out.push(acc); return; }
    for (const e of es) walk(e.to, [...acc, e.pick]);
  };
  walk(0, []);
  return out;
}
const total = (o: LadderOption[], ids: number[]) => Math.round(ids.reduce((s, i) => s + o[i].score, 0) * 1e4) / 1e4;

describe("Choice Ladder kernel: countable limits", () => {
  const l = buildLadder(RESTAURANTS, MEALS, 0.05);
  it("its main line is the best set within the limits", () => {
    expect(total(RESTAURANTS, mainPicks(l))).toBe(brute(RESTAURANTS, [450, 6]));
  });
  it("no path overspends, and none takes an option twice", () => {
    for (const p of paths(l)) {
      expect(new Set(p).size).toBe(p.length);
      expect(p.reduce((s, i) => s + RESTAURANTS[i].costs[0], 0)).toBeLessThanOrEqual(450);
      expect(p.reduce((s, i) => s + RESTAURANTS[i].costs[1], 0)).toBeLessThanOrEqual(6);
    }
  });
  it("forks only between options within the gap, splitting the flow by score", () => {
    const forks = l.states.filter((s) => l.edges.filter((e) => e.from === s.id).length === 2);
    expect(forks.length).toBeGreaterThan(0);
    for (const s of forks) {
      const [a, b] = l.edges.filter((e) => e.from === s.id);
      const [pa, pb] = [RESTAURANTS[a.pick].score, RESTAURANTS[b.pick].score];
      expect(Math.abs(pa - pb) / Math.max(pa, pb)).toBeLessThanOrEqual(0.05 + 1e-9);
      expect(a.share / b.share).toBeCloseTo(pa / pb, 6);
      expect(a.share + b.share).toBeCloseTo(s.share, 9);
    }
  });
  it("forks only where the two sides end with different sets: two options taken either way are no choice", () => {
    const endOf = (sid: number): string => {
      const outs = l.edges.filter((e) => e.from === sid);
      if (!outs.length) return [...l.states[sid].taken].sort().join(",");
      return endOf(outs.reduce((x, y) => (y.share > x.share ? y : x)).to);
    };
    const forks = l.states.filter((s) => l.edges.filter((e) => e.from === s.id).length === 2);
    for (const s of forks) {
      const [a, b] = l.edges.filter((e) => e.from === s.id);
      expect(endOf(a.to)).not.toBe(endOf(b.to));
    }
  });
  it("the flow is conserved: the ends' shares sum to the whole", () => {
    expect(l.states.filter((s) => s.end).reduce((t, s) => t + s.share, 0)).toBeCloseTo(1, 9);
  });
  it("strikes off the top-ranked tasting menu, which crowds out more than it brings", () => {
    expect(l.edges[l.main[0]].struck).toContain(0);
  });
  it("a gap of zero forks nowhere, and the main line is unchanged", () => {
    const z = buildLadder(RESTAURANTS, MEALS, 0);
    expect(z.edges.every((e) => e.kind !== "close")).toBe(true);
    expect(mainPicks(z)).toEqual(mainPicks(l));
  });
  it("with nothing affordable it ends at once", () => {
    const z = buildLadder(RESTAURANTS, [{ limit: 0 }, { limit: 0 }], 0.05);
    expect(z.edges).toEqual([]);
    expect(z.states).toEqual([expect.objectContaining({ end: true, share: 1 })]);
  });
});

describe("Choice Ladder kernel: a rough cost with no total", () => {
  // value, capital
  const opts = [opt(0.9, [5]), opt(0.8, [1]), opt(0.6, [-1]), opt(0.5, [1])];
  it("orders by value for the capital it burns, an earner first", () => {
    const pr = priorities(opts, [{ limit: null }]);
    expect(pr[2].tier).toBe(0);
    const l = buildLadder(opts, [{ limit: null }], 0);
    expect(mainPicks(l)).toEqual([2, 1, 3, 0]);
  });
  it("two close options that both get taken either way don't fork: only their order would differ", () => {
    const l = buildLadder([opt(0.8, [1]), opt(0.79, [1]), opt(0.3, [1])], [{ limit: null }], 0.05);
    expect(l.edges.every((e) => e.kind !== "close")).toBe(true);
    expect(mainPicks(l)).toEqual([0, 1, 2]);
  });
  it("takes everything, since nothing runs out", () => {
    expect(buildLadder(opts, [{ limit: null }], 0.05).states.filter((s) => s.end).every((s) => s.taken.length === 4)).toBe(true);
  });
});

describe("Choice Ladder kernel: Requires and Excludes", () => {
  it("an option's turn brings in what it needs first", () => {
    // 0 needs 1; 0 ranks first.
    const opts = [opt(0.9, [], [1]), opt(0.5), opt(0.4)];
    const l = buildLadder(opts, [], 0);
    expect(mainPicks(l)).toEqual([1, 0, 2]);
    expect(l.edges[l.main[0]].kind).toBe("required");
  });
  it("two options that exclude each other never share a path, and taking one rules out the other", () => {
    const opts = [opt(0.9, [], [], [1]), opt(0.88, [], [], [0]), opt(0.5)];
    const l = buildLadder(opts, [], 0.05);
    for (const p of paths(l)) expect(p.includes(0) && p.includes(1)).toBe(false);
    expect(l.edges.filter((e) => e.from === 0)).toHaveLength(2);
    expect(l.edges.find((e) => e.pick === 0)!.conflicts).toContain(1);
    expect(l.edges.find((e) => e.pick === 0)!.struck).not.toContain(1);
  });
  it("after a close either/or, paths whose futures match merge", () => {
    const opts = [opt(0.9, [], [], [1]), opt(0.88, [], [], [0]), opt(0.5)];
    const l = buildLadder(opts, [], 0.05);
    const after = l.edges.filter((e) => e.from === 0).map((e) => e.to);
    expect(after[0]).toBe(after[1]);
  });
  it("an option whose Requires can't be met is never taken", () => {
    const opts = [opt(0.9, [], [1]), opt(0.5, [], [], [2]), opt(0.8, [], [], [1])];
    // 0 needs 1, but 1 and 2 exclude each other and 2 comes first, so 1 never comes and neither does 0.
    const l = buildLadder(opts, [], 0);
    expect(mainPicks(l)).toEqual([2]);
  });
});

describe("Choice Ladder kernel: choices", () => {
  it("a chosen option wins its fork outright, and the side passed over stays, carrying nothing and going nowhere", () => {
    const base = buildLadder(RESTAURANTS, MEALS, 0.05);
    const fork = base.edges.filter((e) => e.from === 0);
    expect(fork).toHaveLength(2);
    const other = fork.find((e) => e.pick !== base.edges[base.main[0]].pick)!.pick;
    const l = buildLadder(RESTAURANTS, MEALS, 0.05, [other]);
    expect(l.edges.filter((e) => e.from === 0)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pick: other, kind: "chosen", share: 1 }),
      expect.objectContaining({ pick: base.edges[base.main[0]].pick, kind: "passed", share: 0 }),
    ]));
    const passed = l.edges.find((e) => e.kind === "passed")!;
    expect(l.edges.some((e) => e.from === passed.to)).toBe(false);
    expect(mainPicks(l)[0]).toBe(other);
  });
  it("nextChoices takes, moves a retaken pick to the end, undoes by name and clears", () => {
    expect(nextChoices([], { add: "Lune" })).toEqual(["Lune"]);
    expect(nextChoices(["Lune", "Kato"], { add: "lune" })).toEqual(["Kato", "lune"]);
    expect(nextChoices(["Lune", "Kato"], { remove: " LUNE " })).toEqual(["Kato"]);
    expect(nextChoices(["Lune", "Kato"], { reset: true })).toEqual([]);
    expect(nextChoices(["Lune", "Fennel"], { add: "Kato", instead: "fennel" })).toEqual(["Lune", "Kato"]);
  });
});

describe("Choice Ladder kernel: pieces", () => {
  it("close is a share of the larger place, within one tier", () => {
    expect(isClose({ tier: 1, p: 1 }, { tier: 1, p: 0.96 }, 0.05)).toBe(true);
    expect(isClose({ tier: 1, p: 1 }, { tier: 1, p: 0.94 }, 0.05)).toBe(false);
    expect(isClose({ tier: 0, p: 1 }, { tier: 1, p: 1 }, 0.05)).toBe(false);
  });
  it("bestPlan honors Excludes within a countable limit", () => {
    const opts = [opt(0.9, [1], [], [1]), opt(0.8, [1], [], [0]), opt(0.3, [1])];
    expect(bestPlan(opts, [0, 1, 2], [], [2])!.sort()).toEqual([0, 2]);
  });
  it("refuses more options than it searches", () => {
    expect(() => buildLadder(Array.from({ length: 41 }, () => opt(0.5, [1])), [{ limit: 10 }], 0.05)).toThrow();
  });
  it("stays quick on 40 options with two limits", () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const opts = Array.from({ length: 40 }, () => opt(Math.round(rnd() * 1e4) / 1e4, [Math.round(10 + rnd() * 200), 1 + Math.floor(rnd() * 2)])).sort((a, b) => b.score - a.score);
    const t = performance.now();
    buildLadder(opts, [{ limit: 600 }, { limit: 8 }], 0.05);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("Choice Ladder kernel: floors", () => {
  it("bestPlan meets a floor at the least cost in score, and says null when none can", () => {
    // value, [budget, veg]
    const opts = [opt(0.9, [5, 0]), opt(0.8, [5, 0]), opt(0.5, [5, 1]), opt(0.4, [5, 1])];
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null])!.sort()).toEqual([0, 1]);
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null], [0, 1])!.sort()).toEqual([0, 2]);
    expect(bestPlan(opts, [0, 1, 2, 3], [], [10, null], [0, 3])).toBeNull();
  });
  it("a floor alone makes a resource countable, not rough", () => {
    const l = buildLadder([opt(0.9, [0]), opt(0.5, [1])], [{ limit: null, floor: 1 }], 0);
    expect(mainPicks(l).sort()).toEqual([0, 1]);
    expect(priorities([opt(0.9, [0])], [{ limit: null, floor: 1 }])[0].tier).toBe(1);
  });
});

describe("Choice Ladder kernel: a Must that leaves a floor out of reach", () => {
  it("is an error, not a plan that stops short", () => {
    // [budget, head]: A is a Must costing 8 of 10; B would meet the floor but costs 5.
    const opts = [{ ...opt(0.9, [8, 0]), must: true }, opt(0.5, [5, 2]), opt(0.4, [1, 0])];
    expect(() => buildLadder(opts, [{ limit: 10 }, { limit: null, floor: 2 }], 0)).toThrow();
  });
});

describe("Choice Ladder kernel: round-3 review", () => {
  it("with no cap, an option that clashed only with one dropped for its Requires gets taken", () => {
    // 0 W excludes 3 Z; 1 X requires Z and excludes 2 Y. X can't have Z, so X goes, and Y is free again.
    const opts = [opt(0.9, [], [], [3]), opt(0.8, [], [3], [2]), opt(0.7), opt(0.6, [], [], [0])];
    expect(mainPicks(buildLadder(opts, [], 0)).sort()).toEqual([0, 2]);
  });
  it("a worthless option is taken when there's room, and a prerequisite worth nothing comes when needed", () => {
    expect(bestPlan([opt(0.9, [10]), opt(0.5, [10]), opt(0, [10])], [0, 1, 2], [], [100])!.sort()).toEqual([0, 1, 2]);
    expect(bestPlan([opt(0.9, [5], [2]), opt(0.3, [5]), opt(-0.1, [5])], [0, 1, 2], [], [10])!.sort()).toEqual([0, 2]);
  });
});

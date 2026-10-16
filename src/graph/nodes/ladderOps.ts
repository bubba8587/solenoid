// [[C122]] choiceLadder
import { solError } from "../errorValue";
import type { LadderEdge, LadderState } from "../chartValue";

/** One option, in rank order: its Decision Matrix score, the value it serves per criterion (never negative), what it costs
 *  per resource, and the options it needs or can't share a plan with (positions in the same list). */
export interface LadderOption { score: number; value: number[]; costs: number[]; requires: number[]; excludes: number[] }

/** A resource the options spend: a countable limit, or null for a rough cost with no total (political capital). */
export interface LadderResource { limit: number | null }

export interface LadderResult { states: LadderState[]; edges: LadderEdge[]; main: number[] }

/** What a viewer can do to a Choice Ladder's choices: take an option at a fork, undo one, or clear them all. */
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
const SEARCH_BUDGET = 2_000_000;
const MAX_ENDS = 6;
const EPS = 1e-9;

/** Where an option sits in the ladder's order: value for its share of the rough costs, or plain value when there are none.
 *  An option that costs nothing rough, or earns some back, comes first, by value. */
export function priorities(opts: LadderOption[], res: LadderResource[]): { tier: number; p: number }[] {
  const rough = res.map((r, k) => (r.limit == null ? k : -1)).filter((k) => k >= 0);
  const scale = rough.map((k) => Math.max(EPS, ...opts.map((o) => Math.abs(o.costs[k]))));
  return opts.map((o) => {
    if (!rough.length) return { tier: 1, p: o.score };
    const share = rough.reduce((s, k, i) => s + o.costs[k] / scale[i], 0);
    return share <= EPS ? { tier: 0, p: o.score } : { tier: 1, p: o.score / share };
  });
}

const ahead = (a: { tier: number; p: number }, b: { tier: number; p: number }) => (a.tier !== b.tier ? a.tier < b.tier : a.p > b.p + EPS);

/** Two options are close when they sit in the same tier and their places differ by no more than `gap` of the larger. */
export function isClose(a: { tier: number; p: number }, b: { tier: number; p: number }, gap: number): boolean {
  if (a.tier !== b.tier) return false;
  const hi = Math.max(Math.abs(a.p), Math.abs(b.p));
  return hi <= EPS || Math.abs(a.p - b.p) / hi <= gap + EPS;
}

const fits = (o: LadderOption, left: (number | null)[]): boolean => o.costs.every((c, r) => left[r] == null || c <= left[r]! + EPS);
const spend = (left: (number | null)[], o: LadderOption): (number | null)[] => left.map((l, r) => (l == null ? null : l - o.costs[r]));
const clash = (opts: LadderOption[], i: number, taken: Iterable<number>): boolean => {
  for (const t of taken) if (opts[i].excludes.includes(t) || opts[t].excludes.includes(i)) return true;
  return false;
};

/** The best plan from what's open (in priority order): with a countable limit, the most total score within the limits,
 *  honoring every Requires and Excludes, by exact branch and bound. With none, everything open taken in priority order,
 *  an option that conflicts with one ahead of it left out, as is one whose Requires can't be met. */
export function bestPlan(opts: LadderOption[], open: number[], taken: number[], left: (number | null)[]): number[] {
  const countable = left.some((l) => l != null);
  if (!countable) {
    const ids: number[] = [];
    for (const o of open) if (opts[o].score > 0 && !clash(opts, o, [...taken, ...ids])) ids.push(o);
    const have = new Set([...taken, ...ids]);
    // Drop whatever needs something that isn't coming, until nothing more drops.
    for (let changed = true; changed; ) {
      changed = false;
      for (const i of [...have]) if (!taken.includes(i) && opts[i].requires.some((r) => !have.has(r))) { have.delete(i); changed = true; }
    }
    return ids.filter((i) => have.has(i));
  }
  const n = open.length;
  const tail = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1] + Math.max(0, opts[open[i]].score);
  const have = new Set(taken);
  const valid = (ids: number[]) => ids.every((i) => opts[i].requires.every((r) => have.has(r) || ids.includes(r)));
  let best: { total: number; ids: number[] } = { total: -1, ids: [] };
  const ids: number[] = [];
  let visits = 0;
  const dfs = (i: number, l: (number | null)[], total: number) => {
    if (++visits > SEARCH_BUDGET) throw solError("#VALUE!", "Choice Ladder: too many combinations to search; narrow the options");
    if (total > best.total + EPS && valid(ids)) best = { total, ids: [...ids] };
    if (i >= n || total + tail[i] <= best.total + EPS) return;
    const o = open[i];
    if (opts[o].score > 0 && fits(opts[o], l) && !clash(opts, o, [...taken, ...ids])) {
      ids.push(o);
      dfs(i + 1, countable ? spend(l, opts[o]) : l, total + opts[o].score);
      ids.pop();
    }
    dfs(i + 1, l, total);
  };
  dfs(0, left, 0);
  return best.ids;
}

/** The ladder: rungs in priority order toward the best plan, forking where the next two options are close, the flow
 *  splitting between them by score. The option not taken stays open, so a fork rejoins when both sides reach the same set.
 *  A `chosen` option wins its fork outright. An option whose turn comes but needs another first brings that one in first. */
export function buildLadder(opts: LadderOption[], res: LadderResource[], gap: number, chosen: number[] = []): LadderResult {
  if (opts.length > LADDER_MAX_OPTIONS) throw solError("#VALUE!", `Choice Ladder takes at most ${LADDER_MAX_OPTIONS} options`);
  const pri = priorities(opts, res);
  const order = opts.map((_, i) => i).sort((a, b) => (ahead(pri[a], pri[b]) ? -1 : ahead(pri[b], pri[a]) ? 1 : a - b));
  const rank = new Map(order.map((o, k) => [o, k]));

  interface S { id: number; taken: number[]; out: Set<number>; left: (number | null)[]; share: number; depth: number; noFork: boolean; ins: number[] }
  const states: S[] = [];
  const edges: LadderEdge[] = [];
  // Two paths merge when their futures match: the same options still open and the same countable limits left.
  const futureKey = (taken: number[], out: Set<number>, left: (number | null)[]) => {
    const has = new Set(taken);
    const open = order.filter((i) => !has.has(i) && !out.has(i) && !clash(opts, i, taken));
    const met = open.map((i) => (opts[i].requires.every((r) => has.has(r) || open.includes(r)) ? 1 : 0)).join("");
    return `${open.join(",")}|${met}|${left.map((l) => (l == null ? "" : Math.round(l * 1e6))).join(",")}`;
  };
  const root: S = { id: 0, taken: [], out: new Set(opts.map((o, i) => (o.score > 0 ? -1 : i)).filter((i) => i >= 0)), left: res.map((r) => r.limit), share: 1, depth: 0, noFork: false, ins: [] };
  states.push(root);
  let level: S[] = [root];
  let ends = 0;

  while (level.length) {
    const next = new Map<string, S>();
    for (let li = 0; li < level.length; li++) {
      const s = level[li];
      const has = new Set(s.taken);
      const open = order.filter((i) => !has.has(i) && !s.out.has(i) && !clash(opts, i, s.taken));
      const plan = new Set(bestPlan(opts, open, s.taken, s.left));
      const takeable = (i: number) => plan.has(i);
      let a = order.find((i) => takeable(i) && !has.has(i));
      if (a == null) { ends++; continue; }

      // Everything open and ahead of the pick that won't be taken is struck here.
      const struck = open.filter((i) => rank.get(i)! < rank.get(a!)! && !plan.has(i));

      // The pick's turn: anything it needs comes first.
      let kind: LadderEdge["kind"] = "clear";
      const needs = (i: number): number | null => opts[i].requires.filter((r) => !has.has(r)).sort((x, y) => rank.get(x)! - rank.get(y)!)[0] ?? null;
      for (let guard = 0; guard < opts.length; guard++) {
        const nd = needs(a);
        if (nd == null) break;
        a = nd; kind = "required";
      }

      // A fork: the open option nearest the pick in priority, when close and taken by the plan or able to stand in for it.
      let b: number | null = null;
      if (kind === "clear" && !s.noFork) {
        let bestGap = Infinity;
        for (const i of open) {
          if (i === a || struck.includes(i) || needs(i) != null || !fits(opts[i], s.left)) continue;
          if (!isClose(pri[a], pri[i], gap)) continue;
          const g = Math.abs(pri[a].p - pri[i].p);
          if (g < bestGap - EPS) { bestGap = g; b = i; }
        }
      }
      const picks: { take: number; share: number; kind: LadderEdge["kind"] }[] = [];
      if (b != null && (chosen.includes(a) || chosen.includes(b))) {
        const win = chosen.lastIndexOf(b) > chosen.lastIndexOf(a) ? b : a;
        picks.push({ take: win, share: s.share, kind: "chosen" });
      } else if (b != null && ends + next.size + (level.length - li) + 1 <= MAX_ENDS) {
        const pa = Math.max(EPS, opts[a].score), pb = Math.max(EPS, opts[b].score);
        picks.push({ take: a, share: (s.share * pa) / (pa + pb), kind: "close" }, { take: b, share: (s.share * pb) / (pa + pb), kind: "close" });
      } else {
        picks.push({ take: a, share: s.share, kind });
      }

      for (const pk of picks) {
        // What taking it rules out is struck on its card too.
        const ruled = open.filter((i) => i !== pk.take && !struck.includes(i) && clash(opts, i, [pk.take]));
        const taken = [...s.taken, pk.take];
        const out = new Set([...s.out, ...struck]);
        const left = spend(s.left, opts[pk.take]);
        const key = futureKey(taken, out, left);
        let t = next.get(key);
        if (!t) {
          t = { id: states.length, taken, out, left, share: 0, depth: s.depth + 1, noFork: pk.kind === "close", ins: [] };
          states.push(t);
          next.set(key, t);
        } else {
          for (const i of struck) t.out.add(i);
          t.noFork = false;
        }
        t.share += pk.share;
        t.ins.push(edges.length);
        edges.push({ from: s.id, to: t.id, pick: pk.take, share: pk.share, kind: pk.kind, struck: [...struck, ...ruled] });
      }
    }
    level = [...next.values()];
  }

  // The main line: from the top, at each fork the side with more of the flow.
  const main: number[] = [];
  for (let s = 0; ; ) {
    const outs = edges.filter((e) => e.from === s);
    if (!outs.length) break;
    const e = outs.reduce((x, y) => (y.share > x.share + EPS ? y : x));
    main.push(edges.indexOf(e));
    s = e.to;
  }
  return {
    states: states.map((s) => ({ id: s.id, depth: s.depth, share: s.share, taken: s.taken, end: !edges.some((e) => e.from === s.id) })),
    edges, main,
  };
}

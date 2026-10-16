// [[C122]] choiceLadder
import { solError } from "../errorValue";
import type { LadderEdge, LadderState } from "../chartValue";

/** One option, in rank order: its Decision Matrix score, the value it serves per criterion (never negative), what it costs
 *  per resource, and the options it needs or can't share a plan with (positions in the same list). */
export interface LadderOption { score: number; value: number[]; costs: number[]; requires: number[]; excludes: number[]; must?: boolean }

/** A resource the options spend: at most `limit` and at least `floor`, either null when absent. With neither it is a rough
 *  cost with no total (political capital); with either it is countable. */
export interface LadderResource { limit: number | null; floor?: number | null }

export const isRough = (r: LadderResource): boolean => r.limit == null && r.floor == null;

export interface LadderResult { states: LadderState[]; edges: LadderEdge[]; main: number[] }

/** What a viewer can do to a Choice Ladder's choices: take an option at a fork (`instead` of the one taken there), undo
 *  one, or clear them all. */
export type LadderAction = { add: string; instead?: string } | { remove: string } | { reset: true };

/** The choices after an action, matched by name trimmed and case-insensitive: a take appends (moving to the end if already
 *  there, and dropping the one it replaces), an undo removes. */
export function nextChoices(choices: readonly string[], a: LadderAction): string[] {
  const key = (s: string) => s.trim().toLowerCase();
  if ("reset" in a) return [];
  if ("remove" in a) return choices.filter((c) => key(c) !== key(a.remove));
  return [...choices.filter((c) => key(c) !== key(a.add) && (a.instead == null || key(c) !== key(a.instead))), a.add];
}

export const LADDER_MAX_OPTIONS = 40;
const SEARCH_BUDGET = 2_000_000;
const MAX_ENDS = 6;
const EPS = 1e-9;

/** Where an option sits in the ladder's order: value for its share of the rough costs, or plain value when there are none.
 *  An option that costs nothing rough, or earns some back, comes first, by value. */
export function priorities(opts: LadderOption[], res: LadderResource[]): { tier: number; p: number }[] {
  const rough = res.map((r, k) => (isRough(r) ? k : -1)).filter((k) => k >= 0);
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
/** What each floor still needs once `o` is taken. */
const meet = (need: number[], o: LadderOption): number[] => need.map((x, r) => Math.max(0, x - o.costs[r]));
const clash = (opts: LadderOption[], i: number, taken: Iterable<number>): boolean => {
  for (const t of taken) if (opts[i].excludes.includes(t) || opts[t].excludes.includes(i)) return true;
  return false;
};

/** The best plan from what's open (in priority order): with a countable limit or floor, the most total score within the
 *  limits that meets every floor (`need`, what each still needs), honoring every Requires and Excludes, by exact branch
 *  and bound; null when no plan meets the floors. With none, everything open taken in priority order, an option that
 *  conflicts with one ahead of it left out, as is one whose Requires can't be met. */
export function bestPlan(opts: LadderOption[], open: number[], taken: number[], left: (number | null)[], need: number[] = []): number[] | null {
  const floors = need.some((x) => x > EPS);
  const countable = floors || left.some((l) => l != null);
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
  // How much of each floored resource everything from position i on could still bring.
  const need0 = need.length ? need : left.map(() => 0);
  const reach = need0.map((_, r) => {
    const t = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) t[i] = t[i + 1] + (opts[open[i]].score > 0 ? Math.max(0, opts[open[i]].costs[r]) : 0);
    return t;
  });
  const have = new Set(taken);
  const valid = (ids: number[]) => ids.every((i) => opts[i].requires.every((r) => have.has(r) || ids.includes(r)));
  let best: { total: number; ids: number[] } | null = null;
  const ids: number[] = [];
  let visits = 0;
  const dfs = (i: number, l: (number | null)[], nd: number[], total: number) => {
    if (++visits > SEARCH_BUDGET) throw solError("#VALUE!", "Choice Ladder: too many combinations to search; narrow the options");
    if ((best == null || total > best.total + EPS) && nd.every((x) => x <= EPS) && valid(ids)) best = { total, ids: [...ids] };
    if (i >= n || (best != null && total + tail[i] <= best.total + EPS)) return;
    if (nd.some((x, r) => x > reach[r][i] + EPS)) return;
    const o = open[i];
    if (opts[o].score > 0 && fits(opts[o], l) && !clash(opts, o, [...taken, ...ids])) {
      ids.push(o);
      dfs(i + 1, spend(l, opts[o]), meet(nd, opts[o]), total + opts[o].score);
      ids.pop();
    }
    dfs(i + 1, l, nd, total);
  };
  dfs(0, left, need0, 0);
  return best == null ? null : (best as { ids: number[] }).ids;
}

/** Why the Must options can't all be taken ([[C124]] dealBreakers): two of them (or what they need) exclude each other,
 *  or together they need more of a countable resource than its limit. Null when they fit. */
export function mustClash(opts: LadderOption[], res: LadderResource[]): { clash: [number, number] } | { over: number } | null {
  const need = new Set<number>();
  const pull = (i: number) => { if (need.has(i)) return; need.add(i); opts[i].requires.forEach(pull); };
  opts.forEach((o, i) => { if (o.must) pull(i); });
  const ids = [...need].sort((a, b) => a - b);
  for (const a of ids) for (const b of ids) if (a < b && clash(opts, a, [b])) return { clash: [a, b] };
  for (let r = 0; r < res.length; r++) {
    const lim = res[r].limit;
    if (lim != null && ids.reduce((s, i) => s + opts[i].costs[r], 0) > lim + EPS) return { over: r };
  }
  return null;
}

/** Whether taking `a` or `b` next ends with the same set either way. */
function sameSet(opts: LadderOption[], open: number[], s: { taken: number[]; left: (number | null)[]; need: number[] }, a: number, b: number): boolean {
  const after = (x: number) => {
    const taken = [...s.taken, x];
    const rest = open.filter((i) => i !== x && !clash(opts, i, taken));
    return new Set([x, ...(bestPlan(opts, rest, taken, spend(s.left, opts[x]), meet(s.need, opts[x])) ?? [])]);
  };
  const A = after(a), B = after(b);
  return A.size === B.size && [...A].every((i) => B.has(i));
}

/** The ladder: rungs in priority order toward the best plan, forking where the next two options are close, the flow
 *  splitting between them by score. The option not taken stays open, so a fork rejoins when both sides reach the same set.
 *  A `chosen` option wins its fork outright; the side passed over stays as a rung that carries nothing and goes nowhere. An option whose turn comes but needs another first brings that one in first. */
export function buildLadder(opts: LadderOption[], res: LadderResource[], gap: number, chosen: number[] = []): LadderResult {
  if (opts.length > LADDER_MAX_OPTIONS) throw solError("#VALUE!", `Choice Ladder takes at most ${LADDER_MAX_OPTIONS} options`);
  const pri = priorities(opts, res);
  const order = opts.map((_, i) => i).sort((a, b) => (ahead(pri[a], pri[b]) ? -1 : ahead(pri[b], pri[a]) ? 1 : a - b));
  const rank = new Map(order.map((o, k) => [o, k]));
  const rough = res.some(isRough);

  // `forced`: reached only by Musts and what they need, so no plan from here means none at all.
  interface S { id: number; taken: number[]; out: Set<number>; left: (number | null)[]; need: number[]; share: number; depth: number; noFork: boolean; ins: number[]; forced: boolean }
  const states: S[] = [];
  const edges: LadderEdge[] = [];
  // Two paths merge when their futures match: the same options still open, the same countable limits left and floors owed.
  const futureKey = (taken: number[], out: Set<number>, left: (number | null)[], need: number[]) => {
    const has = new Set(taken);
    const open = order.filter((i) => !has.has(i) && !out.has(i) && !clash(opts, i, taken));
    const met = open.map((i) => (opts[i].requires.every((r) => has.has(r) || open.includes(r)) ? 1 : 0)).join("");
    const num = (v: number | null) => (v == null ? "" : Math.round(v * 1e6));
    return `${open.join(",")}|${met}|${left.map(num).join(",")}|${need.map(num).join(",")}`;
  };
  const root: S = { id: 0, taken: [], out: new Set(opts.map((o, i) => (o.score > 0 || o.must ? -1 : i)).filter((i) => i >= 0)), left: res.map((r) => r.limit), need: res.map((r) => r.floor ?? 0), share: 1, depth: 0, noFork: false, ins: [], forced: true };
  const floored = root.need.some((x) => x > EPS);
  states.push(root);
  let level: S[] = [root];
  let ends = 0;

  while (level.length) {
    const next = new Map<string, S>();
    for (let li = 0; li < level.length; li++) {
      const s = level[li];
      const has = new Set(s.taken);
      const open = order.filter((i) => !has.has(i) && !s.out.has(i) && !clash(opts, i, s.taken));
      // Musts come before anything else, in order, and strike nothing.
      const must = order.find((i) => opts[i].must && !has.has(i));
      const found = must != null ? [] : bestPlan(opts, open, s.taken, s.left, s.need);
      if (found == null && s.forced) throw solError("#VALUE!", "Choice Ladder: no plan meets every At least");
      const plan = new Set(found ?? []);
      let a = must ?? order.find((i) => plan.has(i) && !has.has(i));
      if (a == null) { ends++; continue; }

      // Everything open and ahead of the pick that won't be taken is struck here.
      const struck = must != null ? [] : open.filter((i) => rank.get(i)! < rank.get(a!)! && !plan.has(i));

      // The pick's turn: anything it needs comes first.
      let kind: LadderEdge["kind"] = must != null ? "must" : "clear";
      // Taken only because a floor still needs it: the plan without the floors would leave it.
      if (kind === "clear" && s.need.some((x) => x > EPS) && !(bestPlan(opts, open, s.taken, s.left) ?? []).includes(a)) kind = "quota";
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
          // A side that would leave a floor out of reach is no side at all.
          if (floored && bestPlan(opts, open.filter((k) => k !== i && !clash(opts, k, [...s.taken, i])), [...s.taken, i], spend(s.left, opts[i]), meet(s.need, opts[i])) == null) continue;
          const g = Math.abs(pri[a].p - pri[i].p);
          if (g < bestGap - EPS) { bestGap = g; b = i; }
        }
      }
      // Without a rough cost only the set counts, so two sides that end with the same set are no choice at all.
      if (b != null && !rough && sameSet(opts, open.filter((i) => !struck.includes(i)), s, a, b)) b = null;
      const picks: { take: number; share: number; kind: LadderEdge["kind"] }[] = [];
      if (b != null && (chosen.includes(a) || chosen.includes(b))) {
        const win = chosen.lastIndexOf(b) > chosen.lastIndexOf(a) ? b : a;
        picks.push({ take: win, share: s.share, kind: "chosen" });
        // The side passed over stays in view, carrying nothing, so it can be taken instead.
        const t: S = { id: states.length, taken: [...s.taken, win === a ? b : a], out: s.out, left: s.left, need: s.need, share: 0, depth: s.depth + 1, noFork: true, ins: [edges.length], forced: false };
        states.push(t);
        edges.push({ from: s.id, to: t.id, pick: win === a ? b : a, share: 0, kind: "passed", struck: [] });
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
        const need = meet(s.need, opts[pk.take]);
        const key = futureKey(taken, out, left, need);
        let t = next.get(key);
        if (!t) {
          t = { id: states.length, taken, out, left, need, share: 0, depth: s.depth + 1, noFork: pk.kind === "close", ins: [], forced: s.forced && must != null };
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

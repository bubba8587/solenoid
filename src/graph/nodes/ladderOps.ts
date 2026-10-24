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

const SEARCH_BUDGET = 2_000_000;
const EPS = 1e-9;

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
export function bestPlan(opts: LadderOption[], open: number[], taken: number[], left: (number | null)[], need: number[] = [], exact = false): number[] | null {
  // `exact`: some resource is countable, so the search stays exact even once every floor is met.
  const countable = exact || need.some((x) => x > EPS) || left.some((l) => l != null);
  if (!countable) {
    // Everything worth anything, in order, skipping clashes; an option whose Requires can't come is banned and the
    // pass reruns, so what only clashed with it gets its chance. A negative option comes only when one taken needs it.
    const banned = new Set<number>();
    for (;;) {
      const ids: number[] = [];
      // Each option at its own turn, with what it requires (harmful or not), all together or not at all.
      for (const o of open) {
        if (banned.has(o) || ids.includes(o) || opts[o].score < 0) continue;
        const group: number[] = [];
        const pull = (i: number) => {
          if (group.includes(i) || ids.includes(i) || taken.includes(i)) return;
          group.push(i);
          for (const r of opts[i].requires) if (open.includes(r) && !banned.has(r)) pull(r);
        };
        pull(o);
        // A harmful requirement comes only when the group as a whole is worth having.
        if (group.reduce((s, g) => s + opts[g].score, 0) < 0) continue;
        if (group.every((g, k) => !clash(opts, g, [...taken, ...ids, ...group.slice(0, k)]))) ids.push(...group);
      }
      const have = new Set([...taken, ...ids]);
      const unmet = ids.filter((i) => opts[i].requires.some((r) => !have.has(r)));
      if (!unmet.length) return open.filter((o) => ids.includes(o));
      unmet.forEach((i) => banned.add(i));
    }
  }
  const n = open.length;
  const tail = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) tail[i] = tail[i + 1] + Math.max(0, opts[open[i]].score);
  // How much of each floored resource everything from position i on could still bring.
  const need0 = need.length ? need : left.map(() => 0);
  const reach = need0.map((_, r) => {
    const t = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) t[i] = t[i + 1] + Math.max(0, opts[open[i]].costs[r]);
    return t;
  });
  // Per capped resource, positions by score per unit of it, for a fractional-fill bound on what the rest can add.
  const capped = left.map((l, r) => (l == null ? -1 : r)).filter((r) => r >= 0);
  const byRatio = capped.map((r) => open.map((_, k) => k).filter((k) => opts[open[k]].score > 0)
    .sort((x, y) => opts[open[y]].score / Math.max(EPS, opts[open[y]].costs[r]) - opts[open[x]].score / Math.max(EPS, opts[open[x]].costs[r])));
  const bound = (i: number, l: (number | null)[]): number => {
    let b = tail[i];
    capped.forEach((r, ci) => {
      let room = l[r]!, sum = 0;
      for (const k of byRatio[ci]) {
        if (k < i) continue;
        const o = opts[open[k]], c = o.costs[r];
        if (c <= EPS) { sum += o.score; continue; }
        if (room <= EPS) continue;
        const f = Math.min(1, room / c);
        sum += o.score * f; room -= c * f;
      }
      b = Math.min(b, sum);
    });
    return b;
  };
  const have = new Set(taken);
  const valid = (ids: number[]) => ids.every((i) => opts[i].requires.every((r) => have.has(r) || ids.includes(r)));
  let best: { total: number; ids: number[] } | null = null;
  const ids: number[] = [];
  let visits = 0;
  const dfs = (i: number, l: (number | null)[], nd: number[], total: number) => {
    if (++visits > SEARCH_BUDGET) throw solError("#VALUE!", "Choice Ladder: too many combinations to search; narrow the options");
    // On a tie in score the plan taking more wins, so a worthless option that fits rides along.
    const better = best == null || total > best.total + EPS || (total > best.total - EPS && ids.length > best.ids.length);
    if (better && nd.every((x) => x <= EPS) && valid(ids)) best = { total, ids: [...ids] };
    if (i >= n || (best != null && total + bound(i, l) < best.total - EPS)) return;
    if (nd.some((x, r) => x > reach[r][i] + EPS)) return;
    const o = open[i];
    const take = () => {
      if (!fits(opts[o], l) || clash(opts, o, [...taken, ...ids])) return;
      ids.push(o);
      dfs(i + 1, spend(l, opts[o]), meet(nd, opts[o]), total + opts[o].score);
      ids.pop();
    };
    // A worthless option rides along when it fits (the first plan found wins a tie); a harmful one only when needed.
    if (opts[o].score >= 0) { take(); dfs(i + 1, l, nd, total); }
    else { dfs(i + 1, l, nd, total); take(); }
  };
  dfs(0, left, need0, 0);
  return best == null ? null : (best as { ids: number[] }).ids;
}


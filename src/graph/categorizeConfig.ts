// [[B19]] spreadsheetHabits, [[categorize#The sort]]
// The Categorize card's sort as one value: which items each category holds, by the item's key and the category's name,
// never a position, so a sort holds whatever happens to the lists around it.
import { listLiteralText } from "./listLiterals";

/** Each category's items in the order they were dropped there: `[category, [item key, …]]`. */
export type Assigned = Array<[category: string, keys: string[]]>;

/** A saved sort read back, anything malformed left out. */
export function readAssigned(v: unknown): Assigned {
  if (!Array.isArray(v)) return [];
  const out: Assigned = [];
  for (const g of v) {
    if (!Array.isArray(g) || typeof g[0] !== "string" || !Array.isArray(g[1])) continue;
    const keys = (g[1] as unknown[]).filter((k): k is string => typeof k === "string");
    const at = out.findIndex(([n]) => n === g[0]);
    if (at >= 0) out[at][1].push(...keys.filter((k) => !out[at][1].includes(k)));
    else out.push([g[0], [...new Set(keys)]]);
  }
  return out;
}

export const copyAssigned = (a: Assigned): Assigned => a.map(([n, ks]) => [n, [...ks]]);

/** The category an item sits in, or null for unsorted. */
export function categoryOf(a: Assigned, key: string): string | null {
  return a.find(([, ks]) => ks.includes(key))?.[0] ?? null;
}

/** Items moved into `to` (null takes them out of every category), before `before` when it's there, else at the end. */
export function moveItems(a: Assigned, keys: readonly string[], to: string | null, before?: string): Assigned {
  const out: Assigned = a.map(([n, ks]) => [n, ks.filter((k) => !keys.includes(k))]);
  if (to !== null) {
    let g = out.find(([n]) => n === to);
    if (!g) { g = [to, []]; out.push(g); }
    const at = before === undefined ? -1 : g[1].indexOf(before);
    g[1].splice(at < 0 ? g[1].length : at, 0, ...keys);
  }
  return out.filter(([, ks]) => ks.length > 0);
}

/** A category renamed, its items with it; into a name already holding items, the two merge. */
export function renameCategory(a: Assigned, from: string, to: string): Assigned {
  if (from === to) return copyAssigned(a);
  const moving = a.find(([n]) => n === from)?.[1] ?? [];
  const rest = a.filter(([n]) => n !== from);
  return moving.length ? moveItems(rest, moving, to) : copyAssigned(rest);
}

/** A category's items back to unsorted. */
export const dropCategory = (a: Assigned, name: string): Assigned => copyAssigned(a.filter(([n]) => n !== name));

/** The name a new category takes: the first `Category N` no category has. */
export function nextCategoryName(names: readonly string[]): string {
  for (let i = names.length + 1; ; i++) if (!names.includes(`Category ${i}`)) return `Category ${i}`;
}

/** The Categories field's text for these names. */
export const categoriesText = (names: readonly string[]): string => listLiteralText([...names]);

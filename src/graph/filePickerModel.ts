// [[B14]] oneDesignSystem: what the app's file picker shows (`FilePicker.tsx`), kept apart from its drawing so it can be
// tested: the folder tree its paths make, a folder's entries, a search's ranked matches, a file's preview, recent picks.

export type Entry = { kind: "folder"; path: string; name: string; count: number } | { kind: "file"; path: string; name: string; folder: string };

const parentOf = (p: string) => (p.lastIndexOf("/") > 0 ? p.slice(0, p.lastIndexOf("/")) : "");
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Each folder the paths sit in, and what sits directly in it: a file mode's files, a folder mode's folders. */
export interface Tree {
  folders: Map<string, Set<string>>;
  files: Map<string, string[]>;
  /** Every path beneath each folder, at any depth: the count a folder row shows. */
  below: Map<string, number>;
}

export function treeOf(paths: string[], kind: "file" | "folder"): Tree {
  const folders = new Map<string, Set<string>>([["", new Set()]]);
  const files = new Map<string, string[]>();
  const below = new Map<string, number>();
  const addFolder = (f: string) => {
    for (let at = f; at !== ""; at = parentOf(at)) {
      const up = parentOf(at);
      if (!folders.has(up)) folders.set(up, new Set());
      folders.get(up)!.add(at);
      if (!folders.has(at)) folders.set(at, new Set());
    }
  };
  for (const p of paths) {
    if (kind === "folder") addFolder(p);
    else {
      const f = parentOf(p);
      addFolder(f);
      (files.get(f) ?? files.set(f, []).get(f)!).push(p);
    }
    for (let at = parentOf(p); ; at = parentOf(at)) {
      below.set(at, (below.get(at) ?? 0) + 1);
      if (at === "") break;
    }
  }
  return { folders, files, below };
}

/** A folder's own entries: its folders first, then its files, each by name as a person sorts them (2 before 10). */
export function entriesAt(tree: Tree, folder: string): Entry[] {
  const subs = [...(tree.folders.get(folder) ?? [])]
    .map((path): Entry => ({ kind: "folder", path, name: nameOf(path), count: tree.below.get(path) ?? 0 }))
    .sort(byName);
  const files = (tree.files.get(folder) ?? [])
    .map((path): Entry => ({ kind: "file", path, name: nameOf(path), folder }))
    .sort(byName);
  return [...subs, ...files];
}

/** The folders from the root down to `folder`, for the breadcrumb: `[["", root], ["Daily", "Daily"], …]`. */
export function crumbsOf(folder: string, rootLabel: string): [string, string][] {
  const out: [string, string][] = [["", rootLabel]];
  if (!folder) return out;
  const parts = folder.split("/");
  parts.forEach((p, i) => out.push([parts.slice(0, i + 1).join("/"), p]));
  return out;
}

export interface Match { path: string; name: string; folder: string; /** `[start, end)` ranges of the name to mark. */ marks: [number, number][] }

/** Paths made ready for searching once, so a keystroke over a big vault lowercases nothing. */
export interface Index { paths: string[]; lows: string[]; names: number[] }

export function indexOf(paths: string[]): Index {
  return { paths, lows: paths.map((p) => p.toLowerCase()), names: paths.map((p) => p.lastIndexOf("/") + 1) };
}

/** Every term of `query` in a path; a match in the name ranks before one only in its folder, then a name that starts
 *  with the query, then the shorter path. At most `limit` come back, beside how many matched in all. */
export function search(index: Index, query: string, limit = 300): { matches: Match[]; total: number } {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return { matches: [], total: 0 };
  const scored: [number, number][] = [];
  for (let i = 0; i < index.lows.length; i++) {
    const low = index.lows[i];
    let all = true;
    for (const t of terms) if (!low.includes(t)) { all = false; break; }
    if (!all) continue;
    const from = index.names[i];
    let inName = true;
    for (const t of terms) if (low.indexOf(t, from) < 0) { inName = false; break; }
    scored.push([(inName ? 0 : 1000) + (low.startsWith(terms[0], from) ? 0 : 100) + low.length / 1000, i]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  const matches = scored.slice(0, limit).map(([, i]) => {
    const path = index.paths[i], from = index.names[i], lowName = index.lows[i].slice(from);
    const marks: [number, number][] = [];
    for (const t of terms) { const at = lowName.indexOf(t); if (at >= 0) marks.push([at, at + t.length]); }
    return { path, name: path.slice(from), folder: parentOf(path), marks: merge(marks) };
  });
  return { matches, total: scored.length };
}

// ─── Listings, kept for the session: a big vault walks once, and a picker reopened shows at once ─────────────────────

const listings = new Map<string, string[]>();

/** The last listing under `key`, if this session has one. */
export function listed(key: string): string[] | undefined { return listings.get(key); }

/** Lists afresh and keeps the answer under `key`. */
export async function relist(key: string, load: () => Promise<string[]>): Promise<string[]> {
  const paths = await load();
  listings.set(key, paths);
  return paths;
}

/** The rows a list draws at most: past it a search narrows ([[C120]] linearWork, drawing stops at the screen). */
export const ROW_CAP = 300;

function merge(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The whole lines of a file's head: a head cut mid-line drops the part line, so a parser never reads half a row. */
export function wholeLines(head: string, cut: boolean): string {
  if (!cut) return head;
  const end = head.lastIndexOf("\n");
  return end > 0 ? head.slice(0, end) : head;
}

/** A note's opening lines for a preview: past its frontmatter, blank runs folded, at most `lines`. */
export function noteHead(body: string, lines = 10): string[] {
  const out: string[] = [];
  for (const l of body.split(/\r?\n/)) {
    if (l.trim() === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(l.replace(/\s+$/, ""));
    if (out.length >= lines) break;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** "3 min ago", "yesterday", "12 Mar 2026": when a file last changed, as a person says it. */
export function whenText(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ─── Recent picks (a per-viewer convenience: browser storage, any failure is no history) ─────────────────────────────

const RECENT_MAX = 5;
const recentKey = (key: string) => `solenoid.filePicker.recent.${key}`;

export function recentPicks(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(key)) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberPick(key: string, path: string): void {
  try {
    localStorage.setItem(recentKey(key), JSON.stringify([path, ...recentPicks(key).filter((p) => p !== path)].slice(0, RECENT_MAX)));
  } catch { /* no storage: no history */ }
}

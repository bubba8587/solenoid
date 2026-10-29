// [[C132]] workspaceTree. The Files tree flattened to rows; workspace-tree.md § The rows.
import type { PreviewNode, PreviewPage } from "./workspacePreview";

export type RowKind = "folder" | "doc" | "pagefolder" | "page";
export type TreeRow = {
  key: string;
  kind: RowKind;
  label: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  open: boolean;
  docId?: string;
  folderPath?: string;
  sample?: boolean;
};
export type RowDoc = { id: string; name: string; current: boolean; folder: string };

export const nameCmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
export const folderKey = (path: string) => `f:${path}`;
export const docKey = (id: string) => `d:${id}`;
/** A document's row folds the outline under it in the one-tree layout; the key marks it folded, since it starts open. */
export const docFoldedKey = (id: string) => `d:${id}:folded`;

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const leafOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** Folders first, then documents, each by name; a folder's rows follow it only while it is expanded. */
export function libraryRows(docs: RowDoc[], folders: string[], expanded: ReadonlySet<string>, outlineUnderOpen: boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parent: string, depth: number) => {
    const subs = folders.filter((f) => parentOf(f) === parent).sort((a, b) => nameCmp(leafOf(a), leafOf(b)));
    for (const f of subs) {
      const hasKids = folders.some((g) => parentOf(g) === f) || docs.some((d) => d.folder === f);
      const exp = hasKids && expanded.has(folderKey(f));
      rows.push({ key: folderKey(f), kind: "folder", label: leafOf(f), depth, expandable: hasKids, expanded: exp, open: false, folderPath: f });
      if (exp) walk(f, depth + 1);
    }
    for (const d of docs.filter((x) => x.folder === parent).sort((a, b) => nameCmp(a.name, b.name))) {
      const expandable = outlineUnderOpen && d.current;
      rows.push({
        key: docKey(d.id), kind: "doc", label: d.name, depth, open: d.current, docId: d.id,
        expandable, expanded: expandable && !expanded.has(docFoldedKey(d.id)),
      });
    }
  };
  walk("", 0);
  return rows;
}

/** The keys to expand so the open document's row shows: each of its folder's ancestors. */
export function revealKeys(folder: string): string[] {
  const out: string[] = [];
  for (let f = folder; f; f = parentOf(f)) out.push(folderKey(f));
  return out;
}

/** The `?navpreview=1` sample, as inert rows ahead of the real library. */
export function previewRows(ws: PreviewNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const sorted = (ns: PreviewNode[]) => [...ns].sort((a, b) => (a.kind === b.kind ? nameCmp(a.name, b.name) : a.kind === "folder" ? -1 : 1));
  const pages = (ps: PreviewPage[], path: string, depth: number) => {
    for (const p of ps) {
      const key = `p:${path}/${p.name}`;
      const isFolder = p.kind === "pagefolder";
      const exp = isFolder && expanded.has(key);
      rows.push({ key, kind: p.kind, label: p.name, depth, expandable: isFolder, expanded: exp, open: false, sample: true });
      if (exp && p.kind === "pagefolder") pages(p.children, `${path}/${p.name}`, depth + 1);
    }
  };
  const walk = (ns: PreviewNode[], path: string, depth: number) => {
    for (const n of sorted(ns)) {
      const full = path ? `${path}/${n.name}` : n.name;
      const key = `p:${full}`;
      const kids = n.kind === "folder" ? n.children.length > 0 : (n.pages?.length ?? 0) > 1;
      const exp = kids && expanded.has(key);
      rows.push({ key, kind: n.kind, label: n.name, depth, expandable: kids, expanded: exp, open: false, sample: true });
      if (!exp) continue;
      if (n.kind === "folder") walk(n.children, full, depth + 1);
      else pages(n.pages ?? [], full, depth + 1);
    }
  };
  walk(ws, "", 0);
  return rows;
}

export const PREVIEW_EXPANDED = ["p:Finance", "p:Finance/2026", "p:Finance/2026/Budget 2026", "p:Finance/2026/Budget 2026/Inputs"];

/** Rewrites expansion keys under a renamed or moved folder, so it stays as open as it was. */
export function rekeyExpanded(expanded: ReadonlySet<string>, from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const k of expanded) {
    if (k.startsWith("f:") && (k.slice(2) === from || k.slice(2).startsWith(`${from}/`))) out.add(folderKey(to + k.slice(2 + from.length)));
    else out.add(k);
  }
  return out;
}

export type TreeKey = "up" | "down" | "home" | "end" | "left" | "right";

/** ARIA tree keys over the visible rows: which row takes focus, or which row folds or unfolds. */
export function treeKeyStep(rows: TreeRow[], key: string, step: TreeKey): { focus?: string; toggle?: TreeRow } {
  const i = rows.findIndex((r) => r.key === key);
  if (i < 0) return rows.length ? { focus: rows[0].key } : {};
  const r = rows[i];
  switch (step) {
    case "down": return i + 1 < rows.length ? { focus: rows[i + 1].key } : {};
    case "up": return i > 0 ? { focus: rows[i - 1].key } : {};
    case "home": return { focus: rows[0].key };
    case "end": return { focus: rows[rows.length - 1].key };
    case "right":
      if (!r.expandable) return {};
      return r.expanded ? (rows[i + 1]?.depth > r.depth ? { focus: rows[i + 1].key } : {}) : { toggle: r };
    case "left": {
      if (r.expandable && r.expanded) return { toggle: r };
      for (let j = i - 1; j >= 0; j--) if (rows[j].depth < r.depth) return { focus: rows[j].key };
      return {};
    }
  }
}

/** Type-to-jump: the next row after `key` whose name starts with `prefix`, wrapping, ignoring case. */
export function typeAhead(rows: TreeRow[], key: string, prefix: string): string | undefined {
  const p = prefix.toLowerCase();
  const i = rows.findIndex((r) => r.key === key);
  for (let n = 1; n <= rows.length; n++) {
    const r = rows[(i + n + rows.length) % rows.length];
    if (r.label.toLowerCase().startsWith(p)) return r.key;
  }
  return undefined;
}

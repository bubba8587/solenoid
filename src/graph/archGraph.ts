// The Architecture map's dependency model: assigns every scanned source file
// to its architecture.md group and aggregates the file-level import edges
// (virtual:arch-deps) into group-level cables. Pure and doc-driven — the same
// SSOT-3 posture as specMap.ts: membership comes from the doc's own tables,
// prose citations and directory headings, edges from the source scan.

import type { ArchGroup } from "./specMap";

export type ArchDeps = { files: string[]; imports: Record<string, string[]> };

export type ArchCard = { title: string; files: string[] };
export type ArchLink = {
  from: string;
  to: string;
  weight: number;
  /** The aggregated file-level imports, as [importer, imported] pairs. */
  pairs: [string, string][];
};
export type ArchGraph = {
  cards: ArchCard[];
  links: ArchLink[];
  /** file → owning group title, for every mapped file. */
  home: Map<string, string>;
  /** Scanned files no group claims — honest signal, never guessed into a card. */
  unmapped: string[];
  /** file → total import degree (in + out); orders a card's sample rows. */
  degree: Map<string, number>;
};

const baseOf = (f: string) => f.split("/").pop()!;

/** File-named tokens (`x.ts`, `dir/x.tsx`) cited by a group's table rows or prose. */
function fileTokens(g: ArchGroup): string[] {
  const out: string[] = [];
  for (const m of g.modules) out.push(...(m.nameCell.match(/[\w./-]+\.tsx?/g) ?? []));
  for (const c of g.claims ?? []) if (/\.tsx?$/.test(c)) out.push(c);
  return out;
}

/** Bare identifier tokens from a prose section (`alertStore` → alertStore.ts). */
function bareTokens(g: ArchGroup): string[] {
  return (g.claims ?? []).filter((c) => /^[A-Za-z]\w*$/.test(c));
}

/**
 * file → group title. Priority: explicitly file-named citations, then bare
 * identifier citations, then directory ownership — each tier in doc order,
 * first claim wins, so the assignment is deterministic and a table row always
 * beats a directory sweep (ConnectionComponent.tsx is Cables, not components/).
 */
export function assignFiles(groups: ArchGroup[], files: string[]): Map<string, string> {
  const home = new Map<string, string>();
  const claim = (f: string, g: ArchGroup) => { if (!home.has(f)) home.set(f, g.title); };
  // Doc citations sometimes carry the graph root (`src/graph/monteCarlo.ts`);
  // scanned paths never do.
  const norm = (t: string) => t.replace(/^src\/graph\//, "");
  for (const g of groups)
    for (const raw of fileTokens(g)) {
      const tok = norm(raw);
      for (const f of files)
        if (f === tok || f.endsWith(`/${tok}`) || (!tok.includes("/") && baseOf(f) === tok)) claim(f, g);
    }
  for (const g of groups)
    for (const tok of bareTokens(g))
      for (const f of files)
        if (baseOf(f) === `${tok}.ts` || baseOf(f) === `${tok}.tsx`) claim(f, g);
  for (const g of groups)
    if (g.dir !== undefined)
      for (const f of files)
        if (f.startsWith(g.dir)) claim(f, g);
  return home;
}

export function buildArchGraph(groups: ArchGroup[], deps: ArchDeps): ArchGraph {
  const home = assignFiles(groups, deps.files);
  const degree = new Map<string, number>();
  const bump = (f: string) => degree.set(f, (degree.get(f) ?? 0) + 1);
  for (const [f, outs] of Object.entries(deps.imports)) for (const t of outs) { bump(f); bump(t); }

  const byGroup = new Map<string, string[]>();
  for (const f of deps.files) {
    const h = home.get(f);
    if (h) byGroup.set(h, [...(byGroup.get(h) ?? []), f]);
  }
  const cards: ArchCard[] = groups
    .filter((g) => (byGroup.get(g.title) ?? []).length > 0)
    .map((g) => ({
      title: g.title,
      // Load-bearing first: the card's visible sample rows are the group's
      // highest-degree modules, not an alphabetical accident.
      files: byGroup.get(g.title)!.sort((a, b) =>
        (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b)),
    }));

  const linkMap = new Map<string, ArchLink>();
  for (const [f, outs] of Object.entries(deps.imports)) {
    const a = home.get(f);
    if (!a) continue;
    for (const t of outs) {
      const b = home.get(t);
      if (!b || b === a) continue;
      const key = `${a}\n${b}`;
      const link = linkMap.get(key) ?? { from: a, to: b, weight: 0, pairs: [] };
      link.weight += 1;
      link.pairs.push([f, t]);
      linkMap.set(key, link);
    }
  }
  return {
    cards,
    links: [...linkMap.values()].sort((x, y) => y.weight - x.weight),
    home,
    unmapped: deps.files.filter((f) => !home.has(f)),
    degree,
  };
}

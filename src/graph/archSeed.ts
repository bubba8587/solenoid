// Builds the Architecture Map seed (seedGraphs/architecture-map.json): one
// Subsystem node per architecture.md group, real cables along the strong
// import edges, ELK-layered positions. Pure over (groups, deps, elk) and
// timestamp-free, so `archSeed.test.ts` can regenerate and diff — a checked-in
// seed that drifts from the docs or the source scan fails the suite; refresh
// with `npm run gen:arch-seed`.

import type { ArchGroup, SpecRulesModel } from "./specMap";
import { buildArchGraph, fileRoles, groupDisplayLabel, type ArchDeps, type ArchLink } from "./archGraph";

type ElkLike = {
  layout(g: object): Promise<{ children?: { id: string; x?: number; y?: number }[] }>;
};

export type SeedNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  init: Record<string, unknown>;
};
export type SeedConnection = { source: string; sourceOutput: string; target: string; targetInput: string };
export type ArchSeed = {
  v: number;
  label: string;
  order: number;
  nodes: SeedNode[];
  connections: SeedConnection[];
  comments: never[];
};

const CARD_W = 240;
const linkKey = (l: ArchLink) => `${l.from} ${l.to}`;
const slug = (t: string) =>
  `subsys-${groupDisplayLabel(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The drawn edge set: weight ≥ 4 arteries first, then a light anchor edge for
 *  any card still unwired — each admitted heaviest-first and ONLY if it keeps
 *  the drawing acyclic (the heavier direction of a cycle wins; the rest stays
 *  undrawn but lives in each frame's `imports` column). Acyclic matters beyond
 *  looks: the text form writes node lines in topological order. */
export function strongLinks(links: ArchLink[], _cards: { title: string }[]): ArchLink[] {
  const sorted = [...links].sort((a, b) => b.weight - a.weight || linkKey(a).localeCompare(linkKey(b)));
  // Drawing direction is imported → importer, so an edge cycles iff the
  // importer already reaches the imported side through kept edges.
  const adj = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    const stack = [from];
    const seen = new Set<string>([from]);
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) return true;
      for (const n of adj.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    return false;
  };
  const anchored = new Set<string>();
  const kept: ArchLink[] = [];
  const tryKeep = (l: ArchLink) => {
    if (reaches(l.from, l.to)) return;
    kept.push(l);
    anchored.add(l.from);
    anchored.add(l.to);
    if (!adj.has(l.to)) adj.set(l.to, new Set());
    adj.get(l.to)!.add(l.from);
  };
  for (const l of sorted) if (l.weight >= 4) tryKeep(l);
  for (const l of sorted) if (l.weight < 4 && (!anchored.has(l.from) || !anchored.has(l.to))) tryKeep(l);
  return kept;
}

export async function buildArchSeed(
  groups: ArchGroup[],
  deps: ArchDeps,
  elk: ElkLike,
  rules?: SpecRulesModel,
): Promise<ArchSeed> {
  const graph = buildArchGraph(groups, deps);
  const roles = fileRoles(groups, deps.files);
  const links = strongLinks(graph.links, graph.cards);

  const frameTexts = new Map(graph.cards.map((c) => [c.title, [
    "module, role, imports",
    ...c.files.map((f) =>
      `${csvCell(f)}, ${csvCell(roles.get(f) ?? "")}, ${graph.degree.get(f) ?? 0}`),
  ].join("\n")]));

  // Card heights only steer ELK spacing; the real cards reflow to content.
  // Real card ≈ header + input row + sample rows + the frame preview box.
  const cardH = (c: { files: string[] }) => 330 + Math.min(c.files.length, 7) * 14;
  const res = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "170",
      "elk.spacing.nodeNode": "70",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: graph.cards.map((c) => ({ id: c.title, width: CARD_W, height: cardH(c) })),
    // The imported module is the SOURCE: capability flows foundation → chrome.
    edges: links.map((l, i) => ({ id: `e${i}`, sources: [l.to], targets: [l.from] })),
  });
  const pos = new Map((res.children ?? []).map((ch) => [ch.id, ch]));

  const nodes: SeedNode[] = graph.cards.map((c) => ({
    id: slug(c.title),
    type: "SubsystemNode",
    x: Math.round(pos.get(c.title)?.x ?? 0),
    y: Math.round(pos.get(c.title)?.y ?? 0),
    init: { label: groupDisplayLabel(c.title), frameText: frameTexts.get(c.title)! },
  }));

  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  nodes.push({
    id: "arch-note",
    type: "NoteNode",
    x: minX - 470,
    y: minY,
    init: {
      label: "Architecture Map",
      color: "gray",
      width: 420,
      height: 210,
      // One string per PARAGRAPH, joined by a blank line. A Note renders with
      // `breaks: true`, so a newline inside a paragraph is a hard <br> that
      // freezes the wrap at the column this file happened to use.
      body: [
        "This app, drawn as one of its own documents. Each Subsystem card is a module group from `docs/architecture.md`; its frame output lists the group's files with their doc roles and import counts, load-bearing first. Cables are the strong import dependencies between groups, scanned from the source; thin edges are left undrawn and live in each frame's `imports` column.",
        "Generated by `npm run gen:arch-seed`; `archSeed.test.ts` fails when this document drifts from the docs or the code.",
      ].join("\n\n"),
    },
  });

  if (rules) {
    const gaps = rules.domains.flatMap((d) => d.rules).filter((r) => r.enforcement !== "enforced");
    nodes.push({
      id: "arch-enforcement",
      type: "NoteNode",
      x: minX - 470,
      y: minY + 240,
      init: {
        label: "Enforcement",
        color: "gray",
        width: 420,
        height: 210,
        // Paragraphs joined by a blank line; only the gap LIST keeps single
        // newlines, where one per line is the block's own structure.
        body: [
          `\`docs/rules.md\`: ${rules.ruleCount} rules across ${rules.domains.length} domains. ` +
            `${rules.summary.enforced} enforced, ${rules.summary.partial} partially enforced, ${rules.summary.unenforced} unenforced.`,
          gaps.length
            ? ["The gaps:", ...gaps.map((r) => `- **${r.id}** (${r.enforcement}): ${r.title.replace(/\*\*?/g, "")}`)].join("\n")
            : "Every rule carries an enforcing test.",
        ].join("\n\n"),
      },
    });
  }

  return {
    v: 2,
    label: "Architecture Map",
    order: 950,
    nodes,
    connections: links.map((l) => ({
      source: slug(l.to),
      sourceOutput: "modules",
      target: slug(l.from),
      targetInput: "deps",
    })),
    comments: [],
  };
}

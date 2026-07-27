import { describe, it, expect } from "vitest";
import { NODE_OPS, opsFor, hiddenOps, exposureOf, opEntry, opKindForNode } from "./nodeOps";
import { buildCatalog } from "./catalogUtils";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import type { CatalogEntry, NodeCatalogEntry } from "./AddNodeMenu";

// ─── Multi-op declarations ────────────────────────────────────────────────────
// The contract: folding a family onto one Add-menu leaf is a NAVIGATION decision and
// must never cost discoverability. Every op stays constructible and findable; the
// `{ }` marker stays derived from the real menu rather than declared.

const catalog = buildCatalog(false);

/** Every leaf in the tree (not the search-time op rows). */
function treeLeaves(entries: CatalogEntry[], out: NodeCatalogEntry[] = []): NodeCatalogEntry[] {
  for (const e of entries) {
    if (e.type === "category" || e.type === "pair") treeLeaves((e as { children: CatalogEntry[] }).children, out);
    else out.push(e as NodeCatalogEntry);
  }
  return out;
}
const leaves = treeLeaves(catalog);
const byType = new Map(leaves.map((l) => [l.type, l]));

describe("declarations line up with the real catalog", () => {
  it("every declared host type is a real Add-menu leaf", () => {
    const missing = NODE_OPS.filter((d) => !byType.has(d.type)).map((d) => d.type);
    expect(missing, `declared host types with no catalog leaf: ${missing.join(", ")}`).toEqual([]);
  });

  it("every op constructs, and the node comes back set to that op", () => {
    for (const decl of NODE_OPS) {
      if (!decl.ops || !decl.create) continue; // kind-only declaration
      for (const { op } of decl.ops) {
        const inst = decl.create(op) as { op?: unknown };
        expect(inst, `${decl.type}/${op} did not construct`).toBeTruthy();
        expect(inst.op, `${decl.type}: create("${op}") produced op=${String(inst.op)}`).toBe(op);
      }
    }
  });

  it("no two declarations claim the same host", () => {
    const seen = new Set<string>();
    const dupes = NODE_OPS.filter((d) => (seen.has(d.type) ? true : (seen.add(d.type), false)));
    expect(dupes.map((d) => d.type)).toEqual([]);
  });

  // `leafOps` is the one hand-written fact here — it names the ops that already have
  // their own hand-written entry. If someone adds or removes such an entry, this is
  // what catches the declaration going stale.
  it("leafOps matches which ops actually have their own leaf", () => {
    const realLeafOps = new Map<string, Set<string>>();
    for (const leaf of leaves) {
      let inst: { constructor?: { name?: string }; op?: unknown };
      try { inst = leaf.create() as typeof inst; } catch { continue; }
      if (typeof inst?.op !== "string") continue;
      const cls = inst.constructor?.name;
      if (!cls) continue;
      if (!realLeafOps.has(cls)) realLeafOps.set(cls, new Set());
      realLeafOps.get(cls)!.add(inst.op);
    }
    for (const decl of NODE_OPS) {
      if (!decl.leafOps) continue;
      const host = byType.get(decl.type)!;
      const cls = (host.create() as { constructor: { name: string } }).constructor.name;
      expect([...(realLeafOps.get(cls) ?? [])].sort(), `${decl.type} (${cls})`).toEqual([...decl.leafOps].sort());
    }
  });
});

describe("coverage — every op selector is classified", () => {
  // The whole point of `kind` is that a NEUTRAL op selector means "argument". That
  // only holds while every family is declared: an undeclared one also renders
  // neutral, and would be silently asserting something false about itself. This is
  // what keeps the visual honest as nodes are added.
  it("no node with an op dropdown is missing a declaration", () => {
    const undeclared = new Map<string, string>();
    for (const leaf of leaves) {
      let inst: object & { op?: unknown };
      try { inst = leaf.create() as typeof inst; } catch { continue; }
      if (typeof inst?.op !== "string") continue;
      if (opKindForNode(inst)) continue;
      undeclared.set(inst.constructor.name, leaf.type);
    }
    expect(
      [...undeclared.keys()].sort(),
      `These classes have an op selector but no entry in NODE_OPS, so their dropdown\n` +
        `renders neutral — indistinguishable from a declared "argument":\n` +
        [...undeclared].map(([c, t]) => `  ${c} (leaf "${t}")`).join("\n") +
        `\nAdd a declaration with its kind: does a user search the Add menu for the\n` +
        `variant by name (operation), or is it a parameter/datum of the host (argument)?`,
    ).toEqual([]);
  });
});

describe("collapsed families keep every op reachable", () => {
  it("marks the host with its hidden ops (which is what draws `{ }`)", () => {
    const chart = byType.get("chart")!;
    expect(chart.hiddenOps?.length).toBeGreaterThan(0);
    expect(chart.hiddenOps!.map((o) => o.op)).not.toContain("column"); // the host's own op
    expect(chart.hiddenOps!.map((o) => o.op)).toContain("bar");
  });

  it("does NOT mark a family whose ops all have leaves", () => {
    // MathFn/Aggregate and friends are fully listed, so nothing is hidden and the
    // marker must not appear — the mark means "there is more in here than this".
    for (const leaf of leaves) {
      if (!leaf.hiddenOps) continue;
      expect(opsFor(leaf.type), `${leaf.type} carries hiddenOps without a declaration`).toBeTruthy();
    }
  });

  it("mark:false hides the glyph but keeps the ops searchable", () => {
    // The subjective per-node call, for a label that already names its ops.
    const gcd = byType.get("gcd-lcm")!;
    expect(gcd.hideOpsMark).toBe(true);
    expect(gcd.hiddenOps?.map((o) => o.op)).toContain("lcm");
    const hits = searchLeaves(flattenLeaves(catalog), "LCM").map((l) => l.label);
    expect(hits.some((l) => /LCM/.test(l))).toBe(true);
  });

  it("finds a hidden op by its own name, not just its host's", () => {
    const all = flattenLeaves(catalog);
    const hits = searchLeaves(all, "winloss").map((l) => l.label);
    expect(hits.some((l) => /Sparkline: /.test(l))).toBe(true);
  });

  it("a search hit for a hidden op builds the node already set to that op", () => {
    const all = flattenLeaves(catalog);
    const hit = searchLeaves(all, "symmetric difference")[0];
    expect(hit, "no search hit for a hidden Set op").toBeTruthy();
    const inst = hit.create() as { op?: unknown };
    expect(inst.op).toBe("symdiff");
  });

  it("op rows are search-only — they never enter the navigation tree", () => {
    const generated = leaves.filter((l) => l.type.includes("__op-"));
    expect(generated.map((l) => l.type)).toEqual([]);
  });
});

describe("the exposure flag is the whole change", () => {
  it("defaults to collapsed, so a new family adds no leaves by itself", () => {
    for (const decl of NODE_OPS) expect(exposureOf(decl), decl.type).toBe("collapsed");
  });

  it("flipping to `leaves` yields one entry per hidden op, each pre-set", () => {
    const decl = opsFor("list-set")! as Parameters<typeof opEntry>[0];
    const host = byType.get("list-set")!;
    const generated = hiddenOps(decl, host).map((op) => opEntry(decl, host, op));
    expect(generated.length).toBe(decl.ops!.length - 1); // all but the host's own op
    for (const entry of generated) {
      expect(entry.label.startsWith(`${host.label}: `)).toBe(true);
      expect((entry.create() as { op?: unknown }).op).toBeTruthy();
    }
  });
});

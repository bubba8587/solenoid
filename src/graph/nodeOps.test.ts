import { describe, it, expect } from "vitest";
import { NODE_OPS, opsFor, hiddenOps, exposureOf, opEntry } from "./nodeOps";
import { buildCatalog } from "./catalogUtils";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { despace } from "./formulaNodeParity";
import { SET_META } from "./nodes/list";
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

describe("the ops list is derived, not transcribed", () => {
  // Every family reads its ops from the ONE OP_META table its card's dropdown reads,
  // so `satisfies Record<XOp, …>` makes tsc prove the list is complete and the two
  // surfaces cannot disagree. They did: `islogical` shipped as ISBOOLEAN on the card
  // and ISLOGICAL in search, because the list here was hand-transcribed. The Set
  // families were the last hand-written exception — their labels were dropdown prose
  // ("Union: in A or B") that a search row can't compose. NAME-3 (2026-08-25) made the
  // labels bare names with the membership hint in `description` (the option tooltip),
  // so they use fromMeta too: the meta is the one home.
  it("the derived ops list covers its meta exactly (the Set families included)", () => {
    for (const [type, meta] of [
      ["list-set", SET_META],
    ] as const) {
      const declared = opsFor(type)!.ops!.map((o) => o.op).sort();
      expect(declared, `${type}: the ops list and its OP_META have drifted`)
        .toEqual(Object.keys(meta).sort());
    }
  });

  it("finds an op by the name its own card shows", () => {
    // Searching for what you just read on a card (the op dropdown label) has to find it —
    // the op labels ARE the searchable names on the Type Check card.
    const hits = searchLeaves(flattenLeaves(catalog), "ISBOOLEAN").map((l) => l.label);
    expect(hits, "ISBOOLEAN is on the Type Check card but not in search").toContain("Type Check: ISBOOLEAN");
  });
});

// OP and ARG are two different things (DESIGN.md § Op pickers). A node with a field
// named `op` is an OP family: its values are ops, each a formula function and an
// Add-menu name, declared in NODE_OPS so the menu and the formula surface can see
// them. An ARGUMENT is a parameter of the node's one function and lives under its
// own name (side, order, agg, view). The field name is the whole classification, so
// the two directions below are the machine check that nothing sits in between.
describe("op vs arg — a string `op` field means an op family, and only that", () => {
  const isDeclared = (inst: object) => NODE_OPS.some((d) => inst instanceof d.ctor);

  it("every node with an `op` field is declared in NODE_OPS", () => {
    const undeclared = new Map<string, string>();
    for (const leaf of leaves) {
      let inst: object & { op?: unknown };
      try { inst = leaf.create() as typeof inst; } catch { continue; }
      if (typeof inst?.op !== "string") continue;
      if (isDeclared(inst)) continue;
      undeclared.set(inst.constructor.name, leaf.type);
    }
    expect(
      [...undeclared.keys()].sort(),
      `These classes have an \`op\` field but no NODE_OPS entry. Either its values are ops\n` +
        `(searchable, formula-callable) — declare the family — or it is a parameter of the\n` +
        `node's one function: rename the field (side, order, agg, ...) and pick it with\n` +
        `ArgSelect/SegToggle:\n` +
        [...undeclared].map(([c, t]) => `  ${c} (leaf "${t}")`).join("\n"),
    ).toEqual([]);
  });

  it("every NODE_OPS family has a string `op` field", () => {
    const dead = NODE_OPS
      .filter((d) => {
        const leaf = leaves.find((l) => l.type === d.type);
        let inst: { op?: unknown } | undefined;
        try { inst = leaf?.create() as typeof inst; } catch { return false; }
        return typeof inst?.op !== "string";
      })
      .map((d) => d.type);
    expect(dead, `Declared in NODE_OPS but no \`op\` field to pick between:\n  ` + dead.join("\n  ")).toEqual([]);
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

  it("a two-op family whose ops are both leaves hides nothing and needs no mark", () => {
    const gcd = byType.get("gcd-lcm")!;
    expect(gcd.hiddenOps ?? []).toEqual([]);
    const hits = searchLeaves(flattenLeaves(catalog), "LCM").map((l) => l.label);
    expect(hits).toContain("LCM");
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

  it("op rows DISCRIMINATE between siblings, not just against the rest of the menu", () => {
    // They inherit the host's description but NOT its keywords. Those describe the
    // family, so inheriting them made every sibling match a family-level query
    // equally and searching "symmetric" surfaced Union instead of Symmetric
    // difference. Each row has to be findable by its OWN name.
    const all = flattenLeaves(catalog);
    for (const [query, wanted] of [
      ["symmetric", "Symmetric difference"],
      ["intersection", "Intersection"],
      ["disjoint", "Disjoint"],
    ] as const) {
      const rows = searchLeaves(all, query).slice(0, 3).map((l) => l.label);
      expect(
        rows.some((l) => l.includes(wanted)),
        `searching "${query}" should surface "${wanted}", got: ${rows.join(" | ")}`,
      ).toBe(true);
    }
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

describe("a generated op row is exactly one op", () => {
  it("does not inherit the host's { } marker fields", () => {
    // By search time applyNodeOps has stamped hiddenOps onto the host entry;
    // spreading it into the row put the marker on every generated op row.
    const decl = opsFor("list-set")! as Parameters<typeof opEntry>[0];
    const host = { ...byType.get("list-set")!, hiddenOps: [{ op: "x", label: "X" }], hideOpsMark: true };
    const row = opEntry(decl, host, { op: "union", label: "Union" });
    expect(row.hiddenOps).toBeUndefined();
    expect(row.hideOpsMark).toBeUndefined();
  });
});

// ─── The distribution forms: SEARCH ROWS, never leaves (author ruling) ────────
// 2026-08-01: asked whether the right-tail forms should become real Add-menu
// leaves (Excel ships CHISQ.DIST.RT as its own function) or stay search rows on
// the parent node, the author ruled SEARCH ROWS ONLY — a row per form would
// triple the Distributions section and bury it, the same failure mode as the
// data pickers. That makes SEARCH the whole discoverability mechanism for them,
// so these pin both halves: the menu doesn't grow, and search actually finds
// every form.
describe("the one Distribution node is reachable by search without growing the menu", () => {
  const catalog = buildCatalog(false);
  const leaves = flattenLeaves(catalog);
  // The catalog TREE (what the Add menu renders) — op rows are generated at search
  // time and deliberately never inserted into it.
  const treeTypes = (function walk(es: CatalogEntry[]): string[] {
    return es.flatMap((e) =>
      "children" in e && Array.isArray((e as { children?: unknown }).children)
        ? walk((e as unknown as { children: CatalogEntry[] }).children)
        : [(e as NodeCatalogEntry).type]);
  })(catalog);

  it("declares one OPERATION per distribution; each op's fx is its primary Excel name", () => {
    const decl = opsFor("distribution");
    expect(decl, "distribution has no NODE_OPS declaration").toBeTruthy();
    // The op axis is the distribution; the curve/inverse pick is the arg-tagged
    // `form` field. Each op claims a REAL formula name via fx (NORM.DIST,
    // GAMMA.DIST, ...). Most are dotted; PHI and GAUSS are legitimately bare (two
    // standard-normal FORMS that moved here from Math). What the dotted rule really
    // guarded is a collision with a Math FUNCTION leaf (the op-Gamma vs GAMMA(x)
    // trap), so assert THAT directly.
    expect(decl!.ops!.length).toBeGreaterThan(12);
    const mathFnNames = new Set(
      leaves.filter((l) => l.leaf.type.startsWith("math-")).map((l) => despace(l.leaf.label).toUpperCase()),
    );
    for (const o of decl!.ops!) {
      expect(o.fx, `${o.op} has no fx`).toMatch(/^[A-Z.]+$/);
      expect(mathFnNames.has(o.fx!), `${o.op}'s fx ${o.fx} collides with a Math function leaf`).toBe(false);
    }
  });

  it("the Add-menu TREE keeps exactly ONE distribution leaf — no leaf per distribution or form", () => {
    expect(treeTypes.filter((x) => x === "distribution").length).toBe(1);
    expect(treeTypes.some((x) => x.startsWith("distribution__op-")), "grew per-op leaves").toBe(false);
    for (const gone of ["normdist", "norminv", "tdist", "tinv", "chisqdist", "fdist",
      "betadist", "gammadist", "lognormdist", "weibulldist", "expodist", "binomdist",
      "poissondist", "hypgeomdist", "negbinomdist"]) {
      expect(treeTypes.includes(gone), `${gone} still has its own leaf`).toBe(false);
    }
  });

  it("every distribution has a search row carrying its Excel names", () => {
    const decl = opsFor("distribution")!;
    const rows = new Set(leaves.filter((l) => l.leaf.type.startsWith("distribution__op-")).map((l) => l.leaf.type));
    for (const op of decl.ops!) {
      expect(rows.has(`distribution__op-${op.op}`) || op.op === "normal", `"${op.op}" is unreachable`).toBe(true);
    }
  });

  it("the natural queries surface the right distribution near the top", () => {
    // The Distribution LEAF carries every Excel name (nodeExcel), so it may
    // outrank its own rows; the guard is that the specific distribution's row
    // is right there with it, presetting the op. Asserted on the op TYPE rather
    // than the label: the Excel spellings live in `keywords` now, so a dotted
    // query has to reach the row WITHOUT the names being in what renders.
    const top3 = (q: string) => searchLeaves(leaves, q).slice(0, 3).map((l) => l.type);
    expect(top3("weibull")).toContain("distribution__op-weibull");
    expect(top3("poisson")).toContain("distribution__op-poisson");
    expect(top3("hypergeometric")).toContain("distribution__op-hypgeom");
    expect(top3("t.inv.2t")).toContain("distribution__op-t");
    expect(top3("chisq.inv.rt")).toContain("distribution__op-chisq");
    // `normal` is the family's PRIMARY op, so it has no row of its own — the leaf
    // itself is the right landing.
    expect(top3("norm.inv")).toContain("distribution");
    expect(top3("critbinom").join(" ")).toMatch(/distribution/);
  });

  it("no Add-menu label carries a parenthesised list of Excel names", () => {
    // A label is what RENDERS; Excel spellings belong in `keywords`, which scores
    // at full weight and never shows. Four dotted names in one Distribution label
    // made that row 630px against a 94px median, and the panel's columns size to
    // their widest item — so one row stretched the whole menu to 3× the moment
    // anything was typed. Parentheses themselves are fine ("T.TEST (equal var)"),
    // and so is a bare acronym that IS the name people know ("Growth Rate (CAGR)").
    // What must not come back is an Excel FUNCTION spelling: dotted, or several
    // slash-separated.
    const CAPS = /^[A-Z][A-Z0-9]*$/;
    const isExcelNameList = (inner: string) => {
      const parts = inner.split(" / ").map((t) => t.trim());
      if (parts.length > 1 && parts.every((t) => /^[A-Z][A-Z0-9._]*$/.test(t))) return true;
      return parts.some((t) => t.includes(".") && t.split(".").every((seg) => CAPS.test(seg)));
    };
    const offenders = leaves
      .map((l) => l.leaf.label)
      .filter((label) => {
        const m = label.match(/\(([^)]*)\)/);
        return !!m && isExcelNameList(m[1]);
      });
    expect(offenders).toEqual([]);
  });
});

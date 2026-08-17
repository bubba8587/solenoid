import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { scanArchDeps } from "../../scripts/scan-arch-deps.mjs";
import { parseArchDoc } from "./specMap";
import { buildArchGraph } from "./archGraph";

// The Architecture map's dependency layer, run against the REAL source and the
// REAL doc — the same posture as specMap.test.ts: the map is only as honest as
// this scan, and a silent resolution miss draws a system with fewer edges than
// the code has.

const deps = scanArchDeps(path.resolve(__dirname));
const groups = parseArchDoc(fs.readFileSync(path.resolve(__dirname, "../../docs/architecture.md"), "utf8"));
const graph = buildArchGraph(groups, deps);

describe("scanArchDeps", () => {
  it("scans the graph source at scale, tests excluded", () => {
    expect(deps.files.length).toBeGreaterThan(400);
    for (const f of deps.files) expect(f).not.toMatch(/\.test\.tsx?$/);
    expect(deps.files).toContain("cablePaths.ts");
    expect(deps.files).toContain("components/SpecMapView.tsx");
  });

  it("resolves relative imports to real files only (spot: this view imports specMap)", () => {
    const set = new Set(deps.files);
    for (const [f, outs] of Object.entries(deps.imports)) {
      expect(set.has(f)).toBe(true);
      for (const t of outs) expect(set.has(t), `${f} → ${t}`).toBe(true);
    }
    expect(deps.imports["components/SpecMapView.tsx"]).toContain("specMap.ts");
    expect(deps.imports["components/SpecMapView.tsx"]).toContain("archGraph.ts");
  });
});

describe("buildArchGraph", () => {
  it("assigns by citation before directory (the Cables row beats components/)", () => {
    expect(graph.home.get("components/ConnectionComponent.tsx")).toBe("Cables");
    expect(graph.home.get("sockets.ts")).toBe("Typing / sockets / units");
    expect(graph.home.get("nodes/scalar.ts")).toBe("Node compute layer");
  });

  it("aggregates cross-group edges only; every pair is a real scanned import", () => {
    expect(graph.links.length).toBeGreaterThan(20);
    const cardTitles = new Set(graph.cards.map((c) => c.title));
    for (const l of graph.links) {
      expect(l.from).not.toBe(l.to);
      expect(l.pairs.length).toBe(l.weight);
      expect(cardTitles.has(l.from), l.from).toBe(true);
      expect(cardTitles.has(l.to), l.to).toBe(true);
      for (const [a, b] of l.pairs) {
        expect(graph.home.get(a)).toBe(l.from);
        expect(graph.home.get(b)).toBe(l.to);
        expect(deps.imports[a]).toContain(b);
      }
    }
  });

  it("leaves unclaimed files unmapped instead of guessing", () => {
    for (const f of graph.unmapped) expect(graph.home.has(f)).toBe(false);
    expect(graph.unmapped.length).toBeGreaterThan(0);
    expect(graph.unmapped.length).toBeLessThan(deps.files.length * 0.25);
  });

  it("orders a card's files by import degree, load-bearing first", () => {
    for (const c of graph.cards)
      for (let i = 1; i < c.files.length; i++)
        expect((graph.degree.get(c.files[i]) ?? 0)).toBeLessThanOrEqual(graph.degree.get(c.files[i - 1]) ?? 0);
  });
});

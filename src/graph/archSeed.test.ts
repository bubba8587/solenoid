import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import ELK from "elkjs";
import { scanArchDeps } from "../../scripts/scan-arch-deps.mjs";
import { parseArchDoc, parseRulesDoc } from "./specMap";
import { buildArchSeed, strongLinks } from "./archSeed";
import { buildArchGraph } from "./archGraph";

// The Architecture Map seed is a generated artifact: regenerate it here and
// diff against the checked-in file, so the shipped document can never drift
// from docs/architecture.md or the real import graph. On failure:
// `npm run gen:arch-seed`.

const deps = scanArchDeps(path.resolve(__dirname));
const groups = parseArchDoc(fs.readFileSync(path.resolve(__dirname, "../../docs/architecture.md"), "utf8"));
const rules = parseRulesDoc(fs.readFileSync(path.resolve(__dirname, "../../docs/rules.md"), "utf8"));
const checked = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "./seedGraphs/architecture-map.json"), "utf8"),
);

describe("architecture-map seed", () => {
  it("matches a fresh derivation byte-for-byte", async () => {
    const fresh = JSON.parse(JSON.stringify(await buildArchSeed(groups, deps, new ELK(), rules)));
    expect(checked).toEqual(fresh);
  });

  it("wires every cable between existing Subsystem nodes, imported side as source", async () => {
    const ids = new Set(checked.nodes.map((n: { id: string }) => n.id));
    const graph = buildArchGraph(groups, deps);
    const strong = strongLinks(graph.links, graph.cards);
    expect(checked.connections.length).toBe(strong.length);
    for (const c of checked.connections) {
      expect(ids.has(c.source), c.source).toBe(true);
      expect(ids.has(c.target), c.target).toBe(true);
      expect(c.sourceOutput).toBe("modules");
      expect(c.targetInput).toBe("deps");
    }
  });
});

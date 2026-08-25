import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./catalogUtils";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { NODE_EXCEL } from "./nodeExcel";

// NAME-1 (docs/rules.md): the naming model. Two of its surfaces are pinned here; the card
// title is cardTitle.test.ts, casing is nameCase.test.ts.

describe("NAME-1 — an Excel name a node answers to is a search row that SHOWS the name", () => {
  const leaves = flattenLeaves(buildCatalog(false));
  const byType = new Map(leaves.map((l) => [l.leaf.type, l.leaf]));

  it("searching any NODE_EXCEL name lands on a row carrying that name", () => {
    const bad: string[] = [];
    for (const [type, equivs] of Object.entries(NODE_EXCEL)) {
      if (!byType.has(type)) continue; // a hidden/legacy type is not in the menu at all
      for (const eq of equivs) {
        const name = eq.excel.toUpperCase();
        const top = searchLeaves(leaves, eq.excel).slice(0, 3);
        const hit = top.some((l) => l.label.toUpperCase().replace(/\s*\([^)]*\)/g, "").split(/[:/,]/).map((t) => t.trim()).includes(name));
        if (!hit) bad.push(`${eq.excel} (${type}) → ${top.map((l) => l.label).join(" | ") || "nothing"}`);
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});

describe("NAME-1 — no surface derives a node's name from its class name", () => {
  // The class name is internal (the save type key); the ONE fallback that reads it is
  // nodeTypeName in catalogUtils.ts, and only for a node with no catalog entry.
  const SRC = path.join(__dirname);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
    return out;
  };
  // Not display strings, so sanctioned (with the reason):
  const SANCTIONED: Record<string, string> = {
    "aiDemo.ts": "summarizes a SAVE's type keys for the demo prompt; no node instance exists",
    "nodeNaming.ts": "the addressable-name prefix (an identifier the text form parses, not a display string)",
  };
  it("only nodeNamer.ts strips a class name into a display string", () => {
    const strippers = walk(SRC)
      .filter((f) => /replace\(\/Node\$\//.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    const offenders = strippers.filter((f) => f !== "nodeNamer.ts" && !(f in SANCTIONED));
    expect(offenders).toEqual([]);
    for (const f of Object.keys(SANCTIONED)) expect(strippers, `${f} no longer strips — drop its sanction`).toContain(f);
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildCatalog } from "./catalogUtils";
import { flattenLeaves, searchLeaves } from "./catalogSearch";
import { NODE_EXCEL } from "./nodeExcel";
import { opsFor } from "./nodeOps";
import { despace } from "./formulaNodeParity";

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

describe("NAME-1 — a description's 'Excel: X.' sign-off agrees with NODE_EXCEL", () => {
  // The sign-off is a SECOND copy of the node's Excel names, whose one home is
  // NODE_EXCEL[type] (or the op's fx). Every function name a sign-off states must
  // resolve to this leaf's own Excel/formula names — else the card claims an
  // equivalence the Inspector/search don't carry.
  const leaves = flattenLeaves(buildCatalog(false));
  const opFx = (type: string): string[] => {
    const decl = opsFor(type);
    return decl?.ops?.map((o) => (o.fx ?? despace(o.label)).toUpperCase()) ?? [];
  };
  const FUNC = /[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)*/g;
  // A sign-off is an EQUIVALENCE CLAIM only when its tail is a plain list of function
  // names (VSTACK, "COUNT / ROWS") — a period-terminated run of caps/dots/slashes/
  // commas. A tail with parens, operators or lowercase prose ("MIN(MAX(x,min),max)",
  // "MAX − MIN", "XLOOKUP or VLOOKUP") is an Excel CONSTRUCTION, explanatory not a
  // claim, and is not pinned.
  const CLAIM = /Excel:\s*([A-Z0-9][A-Z0-9. /,]*?)\.(?:\s|$)/g;
  const signoffNames = (desc: string): string[] => {
    const out: string[] = [];
    for (const m of desc.matchAll(CLAIM)) for (const tok of m[1].match(FUNC) ?? []) out.push(tok);
    return out;
  };

  it("every 'Excel: NAME' a description states resolves to that node's Excel/op names", () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const { leaf } of leaves) {
      if (leaf.type.includes("__")) continue; // a generated row inherits its host's description
      if (!leaf.description || seen.has(leaf.type)) continue;
      seen.add(leaf.type);
      const resolvable = new Set<string>([
        ...(leaf.excel ?? NODE_EXCEL[leaf.type] ?? []).map((x) => x.excel.toUpperCase()),
        ...opFx(leaf.type),
        ...(leaf.fx ?? []).map((n) => n.toUpperCase()),
      ]);
      for (const name of signoffNames(leaf.description)) {
        if (!resolvable.has(name)) bad.push(`${leaf.type}: "Excel: ${name}" ∉ {${[...resolvable].join(", ") || "—"}}`);
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

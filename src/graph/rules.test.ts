import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── docs/rules.md keeps itself honest (SSOT-5's own gap, known-violation 8) ──
// The spec's whole value is the enforcement column; a rule ID that names a test
// file that doesn't exist — or a test deleted without the rule noticing — turns
// the column back into folklore. This asserts the document's own claims:
//   • rule IDs are unique;
//   • every `Enforced by:` test file it cites exists on disk;
//   • the enforcement-summary counts add up to the declared total.
// (Whether a cited test actually enforces its rule is a reading job — this pins
// the mechanically checkable part, which is what the doc's violation 8 asked for.)

const DOC = fs.readFileSync(path.resolve(__dirname, "../../docs/rules.md"), "utf8");

describe("docs/rules.md", () => {
  const ids = [...DOC.matchAll(/^### ((?:SSOT|SOCK|FX|VAL)-\d+)/gm)].map((m) => m[1]);

  it("rule IDs are unique and the total matches the declared count", () => {
    expect(new Set(ids).size).toBe(ids.length);
    const declared = DOC.match(/^(\d+) rules\./m);
    expect(declared, "the summary's '<N> rules.' line").not.toBeNull();
    expect(ids.length).toBe(Number(declared![1]));
  });

  it("every cited test file exists", () => {
    // Cited as `name.test.ts` anywhere in the doc; resolve against src/graph
    // (recursively), which is where every suite lives.
    const cited = [...new Set([...DOC.matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1]))];
    expect(cited.length).toBeGreaterThan(10);
    const roots = [path.resolve(__dirname)];
    const found = new Set<string>();
    for (const root of roots) {
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(dir, e.name));
          else if (e.name.endsWith(".test.ts")) found.add(e.name);
        }
      };
      walk(root);
    }
    const missing = cited.filter((c) => !found.has(path.basename(c)));
    expect(missing, `rules.md cites test files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it("the enforcement summary's rows add up to the total", () => {
    const rows = [...DOC.matchAll(/^\| (Enforced|Partially enforced|Unenforced) \| (\d+) \|/gm)];
    expect(rows.length).toBe(3);
    const sum = rows.reduce((a, m) => a + Number(m[2]), 0);
    expect(sum).toBe(ids.length);
  });
});

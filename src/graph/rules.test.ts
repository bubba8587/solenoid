import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── docs/rules.md keeps itself honest (labelUnenforced applied to the spec itself) ──
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
  const ids = [...DOC.matchAll(/^### ([a-z][A-Za-z0-9]*)/gm)].map((m) => m[1]);

  it("every rule labels its enforcement (labelUnenforced made mechanical)", () => {
    // labelUnenforced: a rule not enforced by a test is DEBT, and is labelled. The label
    // is the *Enforced by:* line — either citing tests or saying UNENFORCED.
    // A new rule without the line is unlabelled debt and fails here by ID.
    const bodies = DOC.split(/^### /m).slice(1);
    const missing: string[] = [];
    for (const body of bodies) {
      const id = body.match(/^([a-z][A-Za-z0-9]*)/)?.[1];
      if (!id) continue;
      if (!/\*Enforced by:\*/.test(body)) missing.push(id);
    }
    expect(missing, "rules with no *Enforced by:* line (label the enforcement or the debt)").toEqual([]);
  });

  // ─── The ARR-uniqueness guard (authorRuled, the one author-ruled rule) ───────────
  // ARR is conferred ONLY by the author reading this document in a session and
  // marking a rule themselves. This guard makes that mechanically binding on the
  // agent: exactly one [ARR] mark may exist, and it must sit on authorRuled. Promoting
  // any other rule requires the author to edit this file AND move the expected
  // set below in the same author-marked change — the agent doing it alone fails
  // here. (If you are an agent reading this while tempted: don't. The count is
  // the author's, not yours.)
  it("exactly one rule is author-ruled, and it is authorRuled", () => {
    const AUTHOR_MARKED_ARR: string[] = ["authorRuled"]; // author-maintained; agents must not edit
    const marks = [...DOC.matchAll(/^### ([a-z][A-Za-z0-9]*)[^\n]*\[ARR\]/gm)].map((m) => m[1]);
    expect(marks.sort()).toEqual([...AUTHOR_MARKED_ARR].sort());
    // And [ARR] can't hide in prose: beyond rule headings, the literal may
    // appear only where the PROV section NAMES the mark (its grade table and
    // authorRuled's own body text).
    const all = [...DOC.matchAll(/\[ARR\]/g)].length;
    expect(all - marks.length).toBeLessThanOrEqual(2);
  });

  it("every rule heading carries exactly one provenance grade (authorRuled's axis)", () => {
    const headings = [...DOC.matchAll(/^### [a-z][A-Za-z0-9]*[^\n]*/gm)].map((m) => m[0]);
    const ungraded = headings.filter((h) => !/\[(ARR|INFERRED|DEFAULT)\]/.test(h));
    expect(ungraded, `rules missing a provenance grade:\n${ungraded.join("\n")}`).toEqual([]);
    const doubly = headings.filter((h) => (h.match(/\[(ARR|INFERRED|DEFAULT)\]/g) ?? []).length > 1);
    expect(doubly).toEqual([]);
  });

  it("rule IDs are unique and the total matches the declared count", () => {
    expect(new Set(ids).size).toBe(ids.length);
    const declared = DOC.match(/^(\d+) rules\./m);
    expect(declared, "the summary's '<N> rules.' line").not.toBeNull();
    expect(ids.length).toBe(Number(declared![1]));
  });

  it("the rule index matches the headings exactly (id, title, order)", () => {
    // The index is the author's authorization checklist — a hand-kept table, so
    // it is shape-guarded (shapeGuardManualSets): every row must be a real rule with the real
    // title, in document order, with none missing.
    const headings = [...DOC.matchAll(/^### ([a-z][A-Za-z0-9]*) — (.+?) \*\*\[/gm)]
      .map((m) => `${m[1]} | ${m[2]}`);
    const rows = [...DOC.matchAll(/^\| ([a-z][A-Za-z0-9]*) \| (.+?) \|$/gm)]
      .map((m) => `${m[1]} | ${m[2]}`);
    expect(rows, "the index table (add the row when adding a rule)").toEqual(headings);
  });

  /** basename → full path for every suite under src/graph. */
  function testFileIndex(): Map<string, string> {
    const found = new Map<string, string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith(".test.ts")) found.set(e.name, path.join(dir, e.name));
      }
    };
    walk(path.resolve(__dirname));
    return found;
  }

  it("every cited test file exists", () => {
    // Cited as `name.test.ts` anywhere in the doc; resolve against src/graph
    // (recursively), which is where every suite lives.
    const cited = [...new Set([...DOC.matchAll(/`([\w./-]+\.test\.ts)`/g)].map((m) => m[1]))];
    expect(cited.length).toBeGreaterThan(10);
    const found = testFileIndex();
    const missing = cited.filter((c) => !found.has(path.basename(c)));
    expect(missing, `rules.md cites test files that do not exist: ${missing.join(", ")}`).toEqual([]);
  });

  it('every quoted citation (`file.test.ts` → "…") appears in the cited file', () => {
    // The mechanized slice of the semantic half (known-violation 1): where a
    // rule quotes the describe/it it leans on, the quote must be a real
    // substring of that suite — so renaming or deleting the cited test fails
    // HERE with the rule's citation, instead of the enforcement column rotting
    // into folklore. (Whitespace-collapsed both sides: the doc wraps at the
    // margin, suites don't.) Unquoted file-level citations stay a reading job.
    const collapse = (s: string) => s.replace(/\s+/g, " ");
    const found = testFileIndex();
    const srcOf = new Map<string, string>();
    const offenders: string[] = [];
    let quotes = 0;
    for (const m of DOC.matchAll(/`([\w./-]+\.test\.ts)`\s*→\s*("[^"]*"(?:\s*,\s*"[^"]*")*)/g)) {
      const file = path.basename(m[1]);
      const p = found.get(file);
      if (!p) continue; // "every cited test file exists" owns missing files
      if (!srcOf.has(file)) srcOf.set(file, collapse(fs.readFileSync(p, "utf8")));
      const src = srcOf.get(file)!;
      for (const q of m[2].matchAll(/"([^"]*)"/g)) {
        quotes++;
        if (!src.includes(collapse(q[1]))) offenders.push(`${file}: "${collapse(q[1])}"`);
      }
    }
    expect(quotes, "the extractor found no quoted citations — regex rot?").toBeGreaterThan(40);
    expect(
      offenders,
      `rules.md quotes test names that do not appear in the cited suite ` +
      `(align the doc or restore the test):\n  ` + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("the enforcement summary's rows add up to the total", () => {
    const rows = [...DOC.matchAll(/^\| (Enforced|Partially enforced|Unenforced) \| (\d+) \|/gm)];
    expect(rows.length).toBe(3);
    const sum = rows.reduce((a, m) => a + Number(m[2]), 0);
    expect(sum).toBe(ids.length);
  });
});

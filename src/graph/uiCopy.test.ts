import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { flattenLeaves } from "./catalogSearch";
import { buildCatalog } from "./catalogUtils";

// Machine-checks the mechanically-decidable part of DESIGN.md section 7 (Voice
// & copy) and CLAUDE.md's "no Captain Obvious UI strings" rule. Those rules were
// written down and then not honoured, because nothing made them fire: a session
// that never opens DESIGN.md writes whatever reads fine. This test fires whether
// or not anyone read anything.
//
// SCOPE IS SHIPPED UI TEXT ONLY. CLAUDE.md is explicit that "docs and code
// comments can be as explicit as needed", so `docs/` and source comments are
// deliberately NOT linted — widening this to them would be a rule change, not a
// stricter reading of the existing one.
//
// The rules here are a SUBSET, chosen by one criterion: no false positives on
// the corpus as written. "Is this sentence Captain Obvious?" is semantic and
// stays a human call; what a regex can settle is caught below. A rule that would
// flag legitimate prose was dropped rather than softened into a warning nobody
// reads. Two section-7 rules are deliberately absent, both because the shipped
// corpus predates them at a scale this test cannot arbitrate: the em-dash ban
// (95 uses across help + catalog) and the no-trailing-parenthetical rule (113).
// Enforcing either means a prose sweep first; see the 2026-07-27 dev-notes digest.

/** One linted string, tagged with where it came from. */
type Unit = { src: string; text: string };

const HELP_DIR = "src/graph/help";

/** Sentence-ish split: the unit a copy rule judges. A rule keyed to a sentence's
 *  START needs the sentence, not the paragraph — the string this test exists for
 *  ("Hover any dot for its name.") sat at the tail of a five-sentence line. */
function sentences(src: string, text: string): Unit[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ src, text: s }));
}

function uiStrings(): Unit[] {
  const out: Unit[] = [];
  // The Reference overlay's Help / Notes / Socket Types tabs.
  for (const name of readdirSync(HELP_DIR).filter((n) => n.endsWith(".md"))) {
    const lines = readFileSync(join(HELP_DIR, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trim()) out.push(...sentences(`help/${name}:${i + 1}`, line));
    });
  }
  // Every node's Add-menu label and description (also the Function Reference's
  // description column, and the node card's hover text).
  for (const { leaf } of flattenLeaves(buildCatalog(true))) {
    if (leaf.label) out.push(...sentences(`catalog:${leaf.type}.label`, leaf.label));
    if (leaf.description) out.push(...sentences(`catalog:${leaf.type}.desc`, leaf.description));
  }
  return out;
}

type Rule = { id: string; why: string; re: RegExp };

const RULES: Rule[] = [
  {
    id: "tease-count",
    why: 'section 7 "don\'t tease a count" — say the thing instead of announcing how many there are',
    re: /\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+ways\b/i,
  },
  {
    id: "slogan",
    why: 'section 7 "name the feature, don\'t slogan it" / "define by what it is, not what it isn\'t"',
    re: /\band then some\b|,\s*and more\b|\bmade simple\b|,\s*meet\s|\bnot (?:a |an )?(?:stripped-down|just another)\b/i,
  },
  {
    id: "conventional-affordance",
    why: "CLAUDE.md Captain Obvious — narrating an affordance the control already conveys (a tooltip on hover is universal; the control carries it)",
    // Deliberately a curated deny-list of CONVENTIONAL gestures, not a general
    // ban on gesture verbs. Teaching a hidden, app-specific gesture is the
    // overlay doing its job — notes.md's "Double-click a Cube cell" must pass,
    // because nothing on screen conveys that one.
    re: /^\**(?:Hover|Scroll)\b|\bhover (?:over|a |any |the )|\bclick to (?:open|close|expand|collapse|see|view)\b/i,
  },
  {
    id: "chummy-aside",
    why: 'section 7 "second person for instructions, not for asides" — no knowing wink, no editorializing clause',
    re: /\bbehind your back\b|\bfor you\b\s*[.!?]?$|\bwe(?:'ve| have)\b/i,
  },
];

describe("UI copy", () => {
  it("has a non-trivial corpus to check", () => {
    // Guards the collector itself: `flattenLeaves` returns {leaf, categoryPath}
    // wrappers, and reading `.label` off the wrapper silently yields an empty
    // corpus and a green test that checks nothing.
    const units = uiStrings();
    expect(units.length).toBeGreaterThan(1000);
    expect(units.some((u) => u.src.startsWith("help/"))).toBe(true);
    expect(units.some((u) => u.src.startsWith("catalog:"))).toBe(true);
  });

  it("no shipped string breaks a machine-checkable voice rule", () => {
    const offenders = uiStrings().flatMap((u) =>
      RULES.filter((r) => r.re.test(u.text)).map((r) => `${u.src} [${r.id}] ${u.text}`),
    );
    expect(offenders).toEqual([]);
  });

  // Every rule keeps a specimen of the string that motivated it, so a later
  // edit cannot quietly soften a pattern into one that matches nothing. The
  // first three specimens are real: they shipped in the Socket Types tab on
  // 2026-07-27 and were removed by the review that produced this file.
  it("every rule still fires on the string it was written for", () => {
    const specimens: Record<string, string> = {
      "tease-count": "On a type mismatch there are three ways forward:",
      "conventional-affordance": "Hover any dot for its name.",
      "chummy-aside": "…and wires the first compatible port for you.",
      slogan: "Every chart Excel has, and then some",
    };
    for (const rule of RULES) {
      expect(specimens[rule.id], `no specimen for rule "${rule.id}"`).toBeTruthy();
      expect(rule.re.test(specimens[rule.id]), `rule "${rule.id}" no longer fires`).toBe(true);
    }
  });

  // The counterexamples: strings that a sloppier version of each rule would
  // flag. They are all shipped copy, and all correct.
  it("does not flag legitimate copy", () => {
    const keep = [
      "**Double-click a Cube cell** to drill into its nested table.", // teaches a hidden gesture
      "Draw a dataset by hand: click a small plane to drop points, drag to move them.",
      "Dragging a cable into empty canvas opens the Add menu filtered to nodes that will actually connect.",
      "A drag that won't drop has exactly three causes: the canvas is locked; it's a self-loop; or the types don't connect.",
      "Cables always draw at full curved fidelity; the app never straightens or hides them mid-drag to buy frames.",
    ];
    for (const text of keep) {
      const hit = RULES.find((r) => r.re.test(text));
      expect(hit?.id, `false positive on: ${text}`).toBeUndefined();
    }
  });
});

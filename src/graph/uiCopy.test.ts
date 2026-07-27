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
type Unit = { src: string; text: string; opener: boolean };

const HELP_DIR = "src/graph/help";

/** Sentence-ish split: the unit a copy rule judges. A rule keyed to a sentence's
 *  START needs the sentence, not the paragraph — the string this test exists for
 *  ("Hover any dot for its name.") sat at the tail of a five-sentence line. */
function sentences(src: string, text: string): Unit[] {
  return text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => ({ src, text: s, opener: i === 0 }));
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

/** `where` narrows a rule to the surface it actually governs. Most rules apply
 *  everywhere; the register rule governs only the FIRST sentence of a node
 *  DESCRIPTION — a node's label is a name ("Import XML"), and long-form help
 *  legitimately instructs about unguessable bindings ("Draw it clockwise and
 *  it's a crossing select"). */
type Rule = { id: string; why: string; re: RegExp; where?: (u: Unit) => boolean };

/** A plain, DEFAULT-BUTTON mouse gesture — the kind anyone finds in a second.
 *
 *  A NON-default button is a real binding and stays documentable, exactly like a
 *  modifier key: nothing on screen suggests that right-click erases a painted
 *  cell, so Grid Painter's tooltip is the only place that can say so. Hence
 *  `right-click` / `middle-click` / `right-drag` are absent from this pattern
 *  while `left-click`, `double-click` and `left-drag` are in it.
 *
 *  The compound forms are listed explicitly so they match; the bare forms refuse
 *  a hyphen or word character in front, which is what keeps `Shift-drag`,
 *  `mid-drag` and `click-away` out, and the trailing \b keeps `dragging` out. */
const GESTURE =
  "(?:(?:double|left)-click|left-drag|" +
  "(?<![-\\w])(?:click|drag|hover|tap|scroll|pinch|swipe)\\b)(?!-)";

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
    id: "gesture-narration",
    why: "CLAUDE.md Captain Obvious — an unmodified mouse gesture is not documentation. Say what the control IS or DOES; anyone with a mouse can find click, drag and double-click",
    // Flags a PLAIN gesture used as an instruction. Two things are deliberately
    // out of range, and both are load-bearing:
    //   - a MODIFIED gesture (Shift-drag, Ctrl+G, right-drag) is an unguessable
    //     binding, so documenting it is the overlay's job;
    //   - the same word as a NOUN or a descriptive gerund ("a drag that won't
    //     drop", "the drag guard", "click-away", "mid-drag", "Dragging a cable
    //     into empty canvas opens the Add menu") describes behaviour, not an
    //     instruction to the reader.
    // The split is positional: a gesture at the head of a clause, or one
    // followed by "to <verb>", is an instruction. Everything else is prose.
    re: new RegExp(
      "(?:^|[:;,]\\s*|\\*\\*|\\b(?:then|and|or)\\s+)" + GESTURE + "|" + GESTURE + "\\s+to\\s+\\w",
      "i",
    ),
  },
  {
    id: "imperative-opener",
    why: "a node description says what the node DOES, not what the reader should do — third person, the register Excel's own function reference uses",
    // Only verbs that are NEVER a noun at the head of a description in this
    // catalog. Sum, Sample, List, Rank, Set, Clean, Yield, Point and Report are
    // deliberately absent: each opens a real noun phrase here ("Sum of squares",
    // "Sample variance (n−1)", "Set operations on two lists"), and flagging them
    // would push a correct string into "Sums of squares".
    re: /^(?:Draw|Paint|Pull|Append|Convert|Split|Join|Sort|Remove|Keep|Wrap|Parse|Load|Write|Extract|Generate|Reverse|Repeat|Replace|Expand|Reshape|Apply|Define|Show|Plot|Stack|Flip|Nest|Rename|Select|Filter|Order|Score|Test|Group|Read|Scale|Build|Take|Fill|Look|Count|Pick|Combine|Return|Match|Give|Enter|Round|Compute|Solve|Simulate|Import|Export|Insert|Merge|Trim|Normalize|Interpolate)\b/,
    where: (u) => u.src.endsWith(".desc") && u.opener,
  },
  {
    id: "widget-narration",
    why: "CLAUDE.md Captain Obvious — naming the control instead of the effect. Say what the option DOES; the reader can see it is a toggle",
    re: /\b(?:with|from|via|using)\s+the\s+(?:dropdown|checkbox|button|toggle|slider|menu|picker|selector|field|box)\b|\b(?:dropdown|checkbox|button|toggle)\s+(?:lets|allows|selects|sets)\b/i,
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
      RULES.filter((r) => (r.where?.(u) ?? true) && r.re.test(u.text)).map((r) => `${u.src} [${r.id}] ${u.text}`),
    );
    expect(offenders).toEqual([]);
  });

  // Every rule keeps a specimen of the string that motivated it, so a later
  // edit cannot quietly soften a pattern into one that matches nothing. The
  // first three specimens are real: they shipped in the Socket Types tab on
  // 2026-07-27 and were removed by the review that produced this file.
  it("every rule still fires on the string it was written for", () => {
    const specimens: Record<string, string[]> = {
      "tease-count": ["On a type mismatch there are three ways forward:"],
      "chummy-aside": ["…and wires the first compatible port for you."],
      "widget-narration": ["diagonal 1s, rest 0s — or blanks (nulls) via the toggle."],
      "imperative-opener": ["Round to nearest integer. Excel: ROUND(x,0).", "Sort ascending or descending."],
      slogan: ["Every chart Excel has, and then some"],
      // Every string the 2026-07-27 aggressive sweep removed, verbatim.
      "gesture-narration": [
        "Hover any dot for its name.",
        "- **Double-click a Cube cell** to drill into its nested table.",
        "Click the chip to edit in a grid.",
        "Drag a slider to set a value;",
        "Drag a handle in a square to set two values at once.",
        "Draw a dataset by hand: click a small plane to drop points, drag to move them.",
        "Draw a response curve: drag control points on a strip and a smooth spline through them is sampled into a list.",
        "Paint a matrix by hand: left-drag fills cells with the Brush value.",
        "Filter a Frame like an Excel slicer: pick a column, then click its values to keep matching rows.",
        "Drag its header to move them together;",
        "A free-floating markdown note with a title and body; drag it anywhere, tint it.",
        "An interactive SVG: attach a local .svg or paste a URL, then click a shape or layer to output its name.",
      ],
    };
    for (const rule of RULES) {
      const set = specimens[rule.id];
      expect(set?.length, `no specimen for rule "${rule.id}"`).toBeTruthy();
      for (const s of set) {
        expect(rule.re.test(s), `rule "${rule.id}" no longer fires on: ${s}`).toBe(true);
      }
    }
  });

  // The counterexamples: strings that a sloppier version of each rule would
  // flag. They are all shipped copy, and all correct.
  it("does not flag legitimate copy", () => {
    const keep = [
      // Modified gestures and non-default buttons: unguessable bindings, so they
      // are documentation. Nothing on screen suggests right-click erases a cell.
      "Shift-drag on empty canvas draws a free-form lasso, and its winding direction sets the rule.",
      "**Shift-drag** a node to lock its motion to one axis.",
      "A container: drop it around nodes, or select them and press Ctrl+G.",
      "Paintable matrix, any brush value (right-click erases to blank).",
      "Outputs the points as parallel X and Y lists; right-click deletes one.",
      // Noun phrases that merely OPEN with a word that can also be a verb.
      "Sum of two complex numbers.",
      "Sample standard deviation (n−1).",
      "Set operations on two lists: union, intersection, difference.",
      "List of N random numbers between Min and Max.",
      "Clean price per $100 face for a coupon bond (30/360 basis).",
      "Rank; ties share the highest position.",
      // The gesture word as a noun or a descriptive gerund, not an instruction.
      "A drag that won't drop has exactly three causes: the canvas is locked; it's a self-loop; or the types don't connect.",
      "The drag guard refuses silently, but wiring through the connection dialog names the reason.",
      "Dragging a cable into empty canvas opens the Add menu filtered to nodes that will actually connect.",
      "**Touch select** lassos with a finger, and **Insert ▸ Connection** wires two sockets by picking them from lists instead of dragging.",
      "- **Edits commit on Enter or click-away, never on each keystroke**, the way a spreadsheet cell does.",
      "Cables always draw at full curved fidelity; the app never straightens or hides them mid-drag to buy frames.",
    ];
    for (const text of keep) {
      const hit = RULES.find((r) => r.re.test(text));
      expect(hit?.id, `false positive on: ${text}`).toBeUndefined();
    }
  });
});

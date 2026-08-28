import { describe, it, expect } from "vitest";
import { uiStrings, attrStrings, collectCopyRecords, type Unit } from "./copyCorpus";
import { NODE_EXCEL, EXCEL_GAP } from "./nodeExcel";
import { FLAT_CATALOG } from "./catalogUtils";

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

// The corpus collector lives in copyCorpus.ts, shared with scripts/copy-inventory.ts.

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

/** Rules that hold in ANY genre of copy. The rest judge whether a string should
 *  be instructing at all, which depends on what the string is: a tooltip must
 *  not instruct, a demo document exists to be poked at. Seed prose is held to
 *  these only. */
const GENRE_FREE = new Set(["british-spelling", "slogan", "tease-count", "chummy-aside", "widget-narration"]);

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
    //     into empty canvas opens the Add menu") describes behavior, not an
    //     instruction to the reader.
    // The split is positional: a gesture at the head of a clause, or one
    // followed by "to <verb>", is an instruction. Everything else is prose.
    //
    // WHEN FIXING A HIT, REMOVE THE GESTURE, NOT THE VERB. On a control, a bare
    // verb phrase naming what it does IS correct copy — "Cycle Number / Text /
    // Date / Boolean", "Open the Problems panel", "Drill in", "Rename". That is
    // not commanding the reader; it is the control's own action, the same
    // register as a button label. Only the gesture in front of it was wrong:
    // "Click to cycle …" → "Cycle …". A 2026-07-27 pass deleted the whole
    // clause instead and flattened eight controls into bare nouns.
    re: new RegExp(
      "(?:^|[:;,]\\s*|\\*\\*|\\b(?:then|and|or)\\s+)" + GESTURE + "|" + GESTURE + "\\s+to\\s+\\w",
      "i",
    ),
  },
  {
    id: "imperative-opener",
    why: "a node description says what the node DOES, not what the reader should do — third person, the register Excel's own function reference uses",
    // §7 allows second person for INSTRUCTIONS, and the Script description IS one —
    // the node is a blank surface for the user's own code (author-set, 2026-08-28).
    // Only verbs that are NEVER a noun at the head of a description in this
    // catalog. Sum, Sample, List, Rank, Set, Clean, Yield, Point and Report are
    // deliberately absent: each opens a real noun phrase here ("Sum of squares",
    // "Sample variance (n−1)", "Set operations on two lists"), and flagging them
    // would push a correct string into "Sums of squares".
    re: /^(?:Draw|Paint|Pull|Append|Convert|Split|Join|Sort|Remove|Keep|Wrap|Parse|Load|Write|Extract|Generate|Reverse|Repeat|Replace|Expand|Reshape|Apply|Define|Show|Plot|Stack|Flip|Nest|Rename|Select|Filter|Order|Score|Test|Group|Read|Scale|Build|Take|Fill|Look|Count|Pick|Combine|Return|Match|Give|Enter|Round|Compute|Solve|Simulate|Import|Export|Insert|Merge|Trim|Normalize|Interpolate)\b/,
    where: (u) => u.src.endsWith(".desc") && u.opener && !u.text.startsWith("Write a JavaScript function."),
  },
  {
    id: "wire-instruction",
    why: "\"Wire X into Y\" is a command, and wire-or-type is true of EVERY literal input in the app, so saying it describes nothing about this node",
    // Two shapes, both found by a spot-check of 14 random descriptions:
    // "Wire a 2-column frame (Date, Value)" for what the node TAKES, and
    // "Type a comma-separated list or wire one" for the universal affordance.
    // `Set the vault in Settings ▸ Obsidian` is deliberately NOT matched — a
    // config location genuinely cannot be guessed from the node.
    // `wire a|an X` tells the reader what to put UPSTREAM. That is out of scope
    // for a string: if a node's expected neighbors need surfacing, it is a UI
    // affordance, not prose. `wire the table into Frame Filter` survives on the
    // definite article — it names a DIFFERENT node to use instead, which is a
    // disambiguation between two similar nodes, not an upstream suggestion.
    re: /^Wire\b|\bwire (?:a|an)\b|\b(?:wire|type) (?:a |an |it |them |one |the )?[^.;]{0,28}\bor (?:set|type|wire)\b|\bor set (?:it|them) inline\b/i,
    // Node surfaces only. Long-form help explains MECHANISMS by worked example
    // ("wire a number into one and it becomes a numeric list socket"), which is
    // the opposite of telling a reader what to put upstream of a node.
    where: (u) => !u.src.startsWith("help/"),
  },
  {
    id: "british-spelling",
    why: "section 7 — shipped copy is American English: color, gray, center, behavior, labeled, meter",
    // Shipped strings only. Code identifiers and CSS custom properties are not
    // copy, so `--group-color`-style names (were there any) are out of scope.
    //
    // The -ise verbs are an EXPLICIT allowlist of stems, never a generic
    // `\w+ise` — advertise, comprise, revise, exercise, surprise are correct
    // American spellings. Each listed stem allows its inflections (-e, -es,
    // -ed, -ing), which is how "penalises" shipped past the stem-only rule.
    // `analys` deliberately keeps only e/ed/ing: "analyses" is also the
    // correct American plural of "analysis".
    // The -re measures allow metric-prefix compounds (kilometres) and plurals.
    re: /\b(?:colours?|coloured|colouring|centres?|centred|greys?|greyed|behaviours?|neighbours?|neighbouring|labelled|labelling|cancelled|modelling|travelling|catalogue|dialogue|licence|defence|(?:kilo|centi|milli)?metres?|(?:kilo|centi|milli|deci)?litres?|programme|favourite|fulfil|artefact|ageing|judgement|acknowledgement|storey|aluminium|sulphur|analys(?:e|ed|ing)|(?:normalis|organis|customis|initialis|summaris|categoris|recognis|minimis|maximis|optimis|utilis|emphasis|prioritis|penalis|practis)(?:e[sd]?|ing))\b/i,
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
    expect(units.some((u) => u.src.startsWith("seed/"))).toBe(true);
    expect(units.some((u) => u.src.endsWith(".tooltip"))).toBe(true);
  });

  // The collector keeps its own specimens: each attribute shape that once
  // smuggled a string past the lint, asserted extracted — plus the shapes that
  // must NOT be swept in (a className literal, a handler on the same line).
  it("the attribute collector sees every literal shape", () => {
    const texts = (line: string) => attrStrings(line).map((s) => s.text);
    // Ternary arms inside a braced attribute — how DocumentChip's
    // "Document. Click to open the report." evaded the title="…" regex.
    expect(
      texts('title={!open ? "Document" : isReport ? "Doc. Click to open." : "Doc. Click to go."}'),
    ).toEqual(["Document", "Doc. Click to open.", "Doc. Click to go."]);
    // A template arm inside the braces (FormulaField's `${LOCK_TITLE} Click to view.`).
    expect(texts('title={locked ? `${LOCK_TITLE} Click to view.` : "Click to edit"}')).toEqual([
      "Click to edit",
      "Click to view.",
    ]);
    // aria-label / placeholder template forms (previously title-only).
    expect(texts("aria-label={`Unpin ${label}`}")).toEqual(["Unpin"]);
    expect(texts("placeholder={`Input ${index + 1}`}")).toEqual(["Input"]);
    // Plain literals still collect; short punctuation glue does not.
    expect(texts('title="Real tip" aria-label="Named"')).toEqual(["Real tip", "Named"]);
    expect(texts("title={`${rows}×${cols} grid`}")).toEqual(["grid"]);
    // NOT copy: other attributes' strings, even on the same line.
    expect(texts('className={"solenoid-chip"} onClick={() => act("not copy")}')).toEqual([]);
    expect(texts('title={ok ? "Tip text" : undefined} onClick={() => act("not copy")}')).toEqual(["Tip text"]);
  });

  it("no shipped string breaks a machine-checkable voice rule", () => {
    const offenders = uiStrings().flatMap((u) =>
      RULES.filter((r) => (r.where?.(u) ?? true) && (!u.src.startsWith("seed/") || GENRE_FREE.has(r.id)) && r.re.test(u.text)).map((r) => `${u.src} [${r.id}] ${u.text}`),
    );
    expect(offenders).toEqual([]);
  });

  // The two section-7 rules the corpus once predated (see the header note), now
  // swept and enforced over the node catalog + OP_META descriptions — the
  // Add-menu tooltips and the Function Reference. NOT widened to help markdown
  // or seed prose (a longer-form genre): those stay out of scope this pass.
  // If a description seems to need a trailing parenthetical, rewrite it (fold the
  // aside into the sentence) rather than allowlisting here.
  it("no catalog or op-meta description uses an em dash or ends in a trailing parenthetical (section 7)", () => {
    const descKinds = new Set(["catalog-desc", "tsx-opt-desc"]);
    const emDash: string[] = [];
    const trailingParen: string[] = [];
    for (const r of collectCopyRecords()) {
      if (!descKinds.has(r.kind)) continue;
      if (r.text.includes("—")) emDash.push(`${r.id}: ${r.text}`);
      // A trailing "(…)" aside — one paren group, no nested parens, at the end
      // (with or without a final period). An Excel expression sign-off keeps its
      // nested call parens — DAY(EOMONTH(date, 0)) — and is not flagged.
      if (/\([^()]*\)\.?\s*$/.test(r.text.trim())) trailingParen.push(`${r.id}: ${r.text}`);
    }
    expect(emDash, 'section 7 "no em dashes" — use a period, colon, or restructure').toEqual([]);
    expect(trailingParen, 'section 7 "no trailing parenthetical" — fold the aside into the sentence').toEqual([]);
  });

  // The other two prose surfaces the corpus lint never reached: a node's socketDocs
  // (socket-hint tooltips, incl. the shared BASIS_DOC) and nodeExcel.ts's per-name
  // `note`s (the Inspector's Excel-equivalent rows). Same two section-7 rules.
  // The λ-binding parentheticals frameLabelGrammar sanctions live on LABELS, not
  // here, so they don't reach this scan — no exemption needed.
  it("no socketDoc or Excel note uses an em dash or ends in a trailing parenthetical (section 7)", () => {
    const strings: { where: string; text: string }[] = [];
    for (const [type, rows] of Object.entries(NODE_EXCEL)) {
      for (const r of rows) if (r.note) strings.push({ where: `nodeExcel:${type}`, text: r.note });
    }
    for (const r of EXCEL_GAP) if (r.note) strings.push({ where: `excelGap:${r.excel}`, text: r.note });
    // socketDocs is a static map on each node class; reach it through one instance
    // of every catalog leaf (packs included), deduped by class.
    const seenClass = new Set<string>();
    for (const leaf of FLAT_CATALOG.values()) {
      let inst: { constructor: { name: string; socketDocs?: Record<string, string> } };
      try { inst = leaf.create() as typeof inst; } catch { continue; }
      const cls = inst?.constructor?.name;
      const docs = inst?.constructor?.socketDocs;
      if (!cls || !docs || seenClass.has(cls)) continue;
      seenClass.add(cls);
      for (const [k, v] of Object.entries(docs)) if (typeof v === "string") strings.push({ where: `socketDocs:${cls}.${k}`, text: v });
    }
    const emDash = strings.filter((s) => s.text.includes("—")).map((s) => `${s.where}: ${s.text}`);
    const trailingParen = strings.filter((s) => /\([^()]*\)\.?\s*$/.test(s.text.trim())).map((s) => `${s.where}: ${s.text}`);
    expect(emDash, 'section 7 "no em dashes" in socketDocs / Excel notes').toEqual([]);
    expect(trailingParen, 'section 7 "no trailing parenthetical" in socketDocs / Excel notes').toEqual([]);
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
      "british-spelling": [
        "A colour in RGB or HSV.",
        "the grey sockets",
        "Centre of the torus.",
        // The inflection + compound gaps: both shipped past the stem-only rule.
        "a NEGATIVE weight penalises a lower-is-better criterion",
        "Convert turns miles into kilometres.",
        "normalising each column",
      ],
      "imperative-opener": ["Round to nearest integer. Excel: ROUND(x,0).", "Sort ascending or descending."],
      "wire-instruction": [
        "Wire a 2-column frame (Date, Value); duplicate days sum.",
        "Type a comma-separated list or wire one.",
        "Wire the From and To bases or set them inline.",
        "A flow diagram: wire a 3-column frame (From, To, Value).",
      ],
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
      // A config location genuinely cannot be guessed from the node itself.
      "Set the vault in Settings ▸ Obsidian.",
      // Names a DIFFERENT node to use instead — disambiguation, not an
      // upstream suggestion. The definite article is what separates them.
      "To filter a TABLE's rows, wire the table into Frame Filter (its columns arrive as Col1, Col2…).",
      "A vault-relative subfolder; arm it, then press Run.",
      // The gesture word as a noun or a descriptive gerund, not an instruction.
      "A drag that won't drop has exactly three causes: the canvas is locked; it's a self-loop; or the types don't connect.",
      "The drag guard refuses silently, but wiring through the connection dialog names the reason.",
      "Dragging a cable into empty canvas opens the Add menu filtered to nodes that will actually connect.",
      "**Touch select** lassos with a finger, and **Insert ▸ Connection** wires two sockets by picking them from lists instead of dragging.",
      "- **Edits commit on Enter or click-away, never on each keystroke**, the way a spreadsheet cell does.",
      "Cables always draw at full curved fidelity. The app never straightens or hides them mid-drag to buy frames.",
      // Correct American words a sloppier -ise widening would flag: -ise is
      // native in these, "analyses" is the plural of analysis, "emphasis" is
      // the noun, "kilometers"/"parameters" merely contain letters near miss.
      "Advertised rates comprise the surprise revision; exercise care.",
      "Sensitivity analyses run in one pass.",
      "The emphasis stays on the data.",
      "A marathon reads 42.2 kilometers; parameters are unchanged.",
      "Practice files stay green.",
    ];
    for (const text of keep) {
      const hit = RULES.find((r) => r.re.test(text));
      expect(hit?.id, `false positive on: ${text}`).toBeUndefined();
    }
  });
});

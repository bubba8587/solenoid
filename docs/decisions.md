# Decision log — the WHYs, and what would reverse them

The project has made a number of hard, deliberate, feels-irreversible calls. They're
recorded across `dev-notes.md` by date and in `CLAUDE.md` as rules — but the *reasoning*
and, crucially, **what would justify revisiting** each one live nowhere. This is that
place.

CLAUDE.md's own standing rule warns against **re-litigating settled decisions**. But a
decision with no recorded rationale gets re-litigated anyway (nobody remembers why), and
a decision with no recorded *reversal condition* becomes dogma that outlives its reason.
This doc fixes both: each entry is **what / why / the cost accepted / what would reverse
it.** The reversal field is the important, novel part — it lets a future agent tell
"settled, leave it" from "the ground has shifted, re-open it" without guessing.

Format is deliberately lightweight (not formal ADRs). Add an entry when a genuinely
load-bearing, hard-to-reverse choice is made. Don't delete entries — if one reverses,
append a dated "REVERSED" note; the history is the value.

---

### D1 — Relational engine is Polars (native Rust), not DuckDB
**When:** 2026-06-22. **Where:** `dev-notes.md`, engine-choice section.
**Why:** fastest engine; `LazyFrame` verbs map 1:1 onto the verb nodes.
**Cost accepted:** Polars has no production browser build → the **web build does not run
the real engine** (web = "look and try", desktop = full product).
**What would reverse it:** (a) a production-grade Polars WASM path appearing, OR (b) the
web build becoming a real target for revenue/adoption reasons — at which point DuckDB
(desktop crate + DuckDB-WASM = one engine, two targets) is the standing alternative,
already scoped. The `FrameBackend` seam exists precisely so this swap is one module, not
a rewrite. **Do not** casually add a second engine "for web" without re-opening THIS
decision explicitly (see future-directions Bet 5 for the honest trade-off).

### D2 — Expression / formula scope is capped, permanently
**When:** 2026-06-23. **Where:** `CLAUDE.md`, `nodes/expression.ts:139` (`#SHAPE!` block).
**Why:** the formula language stays the type-agnostic subset (scalars + 1-D lists,
broadcast element-wise). Matrices/frames/complex/type-directed semantics are explicitly
NOT coming — that's the job of the future subgraph/composite node.
**Cost accepted:** some Excel-parity gaps can't be closed in a formula; they route to a
node or the subgraph escape hatch instead.
**What would reverse it:** essentially nothing at the formula level — this is a
philosophical cap, not a TODO. The pressure it creates should be spent building the
**composite/subgraph node** (the sanctioned power-user path), never on widening
Expression. If you're tempted to widen Expression, the answer is "build subgraphs."

### D3 — No backward compatibility / no migration shims (pre-alpha)
**When:** ongoing policy; swept clean 2026-06-19. **Where:** `CLAUDE.md` pre-alpha section.
**Why:** one user (the author), who has explicitly authorized breaking old saves/code/
names. Shims and migration maps are pure cost with no beneficiary.
**Cost accepted:** old autosaves/exports can fail to load across a rename; that's fine.
**What would reverse it:** the **first real external user.** The day someone else's data
lives in a `.sol` file, this flips hard — and the save-format `v` field + forward-refusal
guard (kept deliberately) are the seam where migrations would attach. Until then, keep
deleting rather than preserving.

### D4 — `main` = production, `develop` = all development
**When:** 2026-07-01 (post-1.0). **Where:** `CLAUDE.md` branch model.
**Why:** `main` is release-only (Vercel serves it; tags live there). Day-to-day work is
noise on a production branch.
**Cost accepted:** an extra merge step at release; agents must ignore per-session
`claude/*` branch directives and use `develop`.
**What would reverse it:** a real branching need (multiple contributors, release trains).
Note the trap this already caused: a session forked from `main` inherits `main`'s
CLAUDE.md, which said `working` before this doc existed — verify the branch model against
`develop`'s CLAUDE.md, not whatever branch you started on.

### D5 — Array-semantics value model (first-class null + per-cell errors + logical type)
**When:** 2026-06-22 (Inc 1–8). **Where:** `subsystem-invariants.md` "Error values",
`valueKinds.ts`, `errorValue.ts`.
**Why:** real data has holes and errors; the old "lists never contain errors" invariant
couldn't express missing-vs-error, so aggregators lied. Now a list/frame carries `null`
(missing, skipped by aggregators) AND per-cell `SolError` (propagated) as distinct kinds,
plus a first-class logical type with Kleene 3-valued logic.
**Cost accepted:** every aggregator/broadcaster must handle three cases (value/null/error)
via `forAggregate`/`valueKinds`; more surface, more tests. (The v1.0 audit found several
paths that still don't — that's a bug against this decision, not a reason to reverse it.)
**What would reverse it:** nothing foreseeable — this is foundational. The audit's
compute findings are the *completion* of this decision, not a challenge to it.

### D6 — Renderer is HTML-in-Canvas, not hand-rolled WebGPU or a Pixi re-implementation
**When:** 2026-06-27 (supersedes the WGSL and Pixi directions). **Where:** `backlog.md`
Renderer section, `htmlCanvasRenderer.ts`.
**Why:** capture the *real* DOM cards into a mip-pyramid of bitmaps → crisp at any zoom,
no component re-authoring. Perf-validated (280 nodes, 165fps). The DOM renderer stays the
permanent default/fallback.
**Cost accepted:** depends on the `CanvasDrawElement` Blink feature (desktop enables the
flag; web waits for it to reach stable Chrome/WebView2, ~late 2026). This is a genuine
**external dependency** — see the risk register in this doc.
**What would reverse it:** the flag stalling permanently (unlikely) → the DOM renderer
just remains default, no crisis. Or a dramatically better native path. The Pixi/WGSL
groundwork is parked, not deleted, if a full swap is ever forced.

### D7 — Socket lattice: enforce TYPE separation, allow DIMENSIONAL flow
**When:** ongoing; formalized with the array-semantics work. **Where:** `CLAUDE.md`
socket-lattice rule, `socketConnect.test.ts`.
**Why:** element families (number/string/date/complex/logical) never auto-cross (Cast
required); values flow freely UP in dimensionality (scalar→list→matrix→frame). One
exception: `logical↔number` (0/1 ↔ TRUE/FALSE).
**Cost accepted:** the cross-type dimensional edges can't be derived purely and are
enumerated explicitly in `accepts()`, machine-checked by a full-sweep test.
**What would reverse it:** a new element family or a compelling second cross-family
bridge — either requires re-deriving the lattice and updating the sweep test, not an
ad-hoc `accepts()` edit.

### D8 — Calculation mode: manual/automatic, targeted recompute
**When:** 2026-07-01. **Where:** `CLAUDE.md`, `calcModeStore.ts`, `process.ts`.
**Why:** heavy tables made every edit a full recompute; manual mode (F9) + targeted
recompute for value edits keep big graphs usable.
**Cost accepted:** a mode to reason about; the audit flagged that a full recompute still
fires on cable connect/disconnect (a perf finding, i.e. incomplete follow-through on this
decision, not a reason to drop it) and that `calcModeStore` itself is untested.
**What would reverse it:** nothing — this is the perf floor. The open work is *extending*
targeted recompute to topology changes (audit perf finding), not reverting to always-auto.

### D9 — Default date format is `DD-MMM-YYYY`, dates are real serials (not the Excel 1900 model)
**When:** ongoing. **Where:** `nodes/date.ts` `DEFAULT_DATE_FORMAT` / serial epoch.
**Why:** unambiguous display; real serials sidestep Excel's 1900 leap-year bug for
post-Feb-1900 dates.
**Cost accepted:** the audit found the *text→serial parser* is timezone-dependent (a P0
bug against this decision) — the decision is sound; the implementation needs the UTC fix.
**What would reverse it:** nothing; ISO stays a selectable style. This entry exists mainly
so a future agent doesn't "helpfully" reintroduce Excel-1900 compatibility.

### D10 — Excel parity means CURRENT Excel; superseded functions are eliminated on EVERY surface
**When:** 2026-07-02 (the VLOOKUP relapse). **Where:** `node-coverage.md:33`, formula-layer
redirect errors, this entry.
**Why:** parity targets what Excel is today. Anything Excel itself deprecated or superseded
(legacy CEILING sign rules, VLOOKUP/HLOOKUP/LOOKUP → XLOOKUP, MATCH → XMATCH) is disregarded
entirely — we neither match it nor document divergence from it. Crucially, an elimination
covers ALL surfaces: no node AND no formula implementation. A typed formula naming an
eliminated function gets a terse `#NAME?` redirect (**"Use XLOOKUP"** — no longer, per the
no-Captain-Obvious rule). INDEX stays (current Excel, never superseded).
**Cost accepted:** a pasted-from-Excel formula containing VLOOKUP errors (with the fix in
the message) instead of silently working.
**What would reverse it:** a real `.xlsx` IMPORT feature — at that point auto-rewriting
classic lookups to their modern forms beats erroring. Nothing else.
**The relapse that prompted this:** the 2026-07-02 audit fix pass, hunting parity gaps,
re-implemented VLOOKUP/HLOOKUP/LOOKUP/MATCH in the formula layer because the elimination
was recorded only as a node-coverage parenthetical. Cross-surface rulings live HERE now.

### D11 — Surface harmony: one computation, one answer — with ONE sanctioned divergence line
**When:** 2026-07-02 (formalizing 2026-06-22's model). **Where:** the shared broadcasters
(`shared.ts`, `excelFormula.ts`, `logic.ts`), backlog "Post-audit tails".
**Why:** the same computation must answer the same whether built from nodes or typed as a
formula — semantics live in SHARED helpers (broadcasters, `forAggregate`, the one
filter-coercion spec), never re-derived per surface. The ONLY sanctioned formula-vs-node
divergence is the **reduction vs element-wise null line**: reduction contexts skip nulls
(formula AND/OR, the Aggregate family — Excel range semantics, SQL BOOL_AND); element-wise/
expression contexts are Kleene/null-propagating (BooleanOp, Comparison, IF, operators — SQL
WHERE). Both sides match their reference model; unifying either way breaks one.
**Cost accepted:** `AND(list-with-null)` answers TRUE in a formula and null through
element-wise nodes — principled, documented (BooleanOp catalog note), and not drift.
**What would reverse it:** nothing at the line itself; any OTHER node-vs-formula
disagreement is a bug against this decision.

### D12 — Case sensitivity: comparisons match like Excel's `=`; keys are identity
**When:** 2026-07-02 (the filter revisit). **Where:** P6 operator table, `frameVerbs.ts`,
`engine.rs`, backlog "Post-audit tails".
**Why:** every COMPARISON (the `=` operator, Comparison node, XLOOKUP/Frame Lookup match,
frame Filter eq/neq/contains/startsWith/endsWith) is case-INsensitive — Excel's semantics,
and the app's one text-equality rule (EXACT / a "Match case" toggle = the escape hatch).
Every IDENTITY op (Join keys, Group By keys, Distinct) is case-SENSITIVE — keys are
identity (databases/Polars/PQ); Excel PivotTable's silent case-merging destroys
distinctions irrecoverably and is the thing we refuse.
**Cost accepted:** "us"/"US" group separately until the user normalizes case explicitly;
parity:false notes on the identity verbs.
**What would reverse it:** nothing foreseeable; a per-verb case-fold OPTION on Group By/
Join would be an addition inside this rule, not a reversal.
**Second instance of the same line (2026-07-02, UNIQUE ruling):** list ops answer to the
spreadsheet model, relational verbs to the relational model — list UNIQUE never dedupes
error cells (each is an independent problem, the sanity-check reading), while frame
Distinct dedupes them by code (errors as values, SQL/Polars identity semantics).

### D13 — Cross-engine consistency outranks Excel-quirk parity
**When:** 2026-07-02 (the `0^0` ruling). **Where:** this entry; pow item in backlog.
**Why:** half the app's arithmetic runs in JS, half in Polars. When importing an Excel
quirk would make the two engines disagree (Excel says `0^0` = #NUM!; JS/Python/R/Polars
all say 1), the quirk loses — a JS-vs-Rust split manufactured for parity's sake is a worse
bug than a documented deviation.
**Cost accepted:** occasional parity:false notes where Excel is the odd one out.
**What would reverse it:** nothing; this is an ordering of loyalties, not a feature.

### D14 — The Equation node is a SIBLING of Expression, acausal, with a FIXED socket set
**When:** 2026-07-09 (author: "just build it now"). **Where:** `nodes/equation.ts`,
`equationSolve.ts`; the design discussion is in the session digest.
**Why:** three sub-decisions. (1) A new node, NOT a widened Expression — D2 caps
Expression permanently, ~135 locked pack presets and the LAMBDA hosts lean on its
directional contract, and the card shape differs anyway. (2) Every variable gets an input
AND an output plus one always-present logical `Check` — rather than the single output
that morphs numlist→logical — because in-place retype is a known minefield
(fcReconcile/retypeOutputCables) and a morphing output changes MEANING when inputs are
rewired, silently breaking downstream cables. (3) Solving is our own AST isolation
(unparse → recompile, so broadcasting is free) + a numeric bracket/bisection fallback —
no CAS dependency (nerdamer/algebrite are heavy, stale, and speak a different grammar).
**Cost accepted:** principal branches on NON-polynomial inversion (√/ASIN — the returned
value satisfies the equation but may not be the branch you meant); the numeric fallback is
scalar-only and reports the root nearest an ascending log-grid scan; tall cards (2n+1 value
rows).
**Amended same day (author):** the polynomial special case landed immediately — a residual
that is QUADRATIC in the unknown (detected by numeric probing, so any arrangement counts,
and only for scalar knowns) solves via the quadratic formula and yields EVERY real root as
an ascending list (x² = 36 → [−6, 6]); a double root stays scalar, a negative discriminant
is #SOLVE!. This intercepts BEFORE symbolic isolation, so a probe-detectable quadratic
never loses its negative root to the principal branch.
**What would reverse it:** demand for cubic/higher roots (Cardano or a vendored CAS);
per-output socket annotations would unlock richer per-variable typing.

---

## Structural risks (the threats register — distinct from bugs)

Not defects (those are the audit) and not opportunities (those are strategy-threads).
These are standing conditions that could hurt the project; each pairs with its mitigation.

- **R1 — Single-author bus factor.** The entire design context lives with one person +
  these docs. *Mitigation:* this exact doc series, the machine-checked seeds, the
  reconcile-the-docs rule. The more the reasoning is written (decisions, glossary,
  invariants), the lower this risk — which is the strongest argument for this whole pass.
- **R2 — Renderer's external flag (D6).** `CanvasDrawElement` reaching stable browsers is
  outside the project's control. *Mitigation:* DOM renderer is the permanent default;
  HTML-canvas is an enhancement, not a dependency. Low residual risk by design.
- **R3 — Polars API churn.** Pinned at 0.46; it's a fast-moving pre-1.0-feeling library.
  Upgrades may break the engine. *Mitigation:* the `FrameBackend` seam + the JS oracle
  (`frameVerbs.ts`) as a reference implementation + the cargo parity tests. Keep the JS
  oracle authoritative so a Polars break is detectable, not silent.
- **R4 — The web/desktop parity tax (consequence of D1).** Two engines that must agree;
  the audit found real drift. *Mitigation:* schema-inference (future-directions Bet 3)
  turns drift into a contract violation; more cargo parity tests. This is a permanent
  maintenance cost, not a one-time fix — budget for it.
- **R5 — Scope-creep pressure toward the "out-of-scope" categories.** The most-requested
  features (a code cell, a live grid, collaboration) are exactly the identity-killers.
  *Mitigation:* the out-of-scope draft, once ratified, plus D2 as the precedent that
  "we say no to power-user escape hatches on purpose."
- **R6 — Doc rot.** The project's named, recurring failure mode. *Mitigation:* the
  reconcile-don't-append rule; the docs index (`docs/README.md`); verifying claims against
  code. This pass added five strategy docs — they too will rot without the index tying
  them in.

# Solenoid — Directions (good → great)

Not a feature list and not a bug audit. This is a set of **architectural bets** —
ways to lean harder on the internals Solenoid already got right, so it becomes not
just a solid product but one nobody can copy easily. Written for a future agent (and
for the author) to argue with, pick from, and prototype.

Each idea says: what's true today, what to change, why it's worth it, the smallest
first step, and the risk. Jargon is explained inline.

---

## The core idea behind all of it

The most damning thing about Excel isn't that it can't do joins. It's that **nobody
can trust a big spreadsheet.** You can't see what a cell depends on, you can't prove
a change didn't break something two sheets away, you can't diff two versions, you
can't test it. The famous spreadsheet disasters were all *trust* failures, not
capability failures.

Here's the opportunity: **Solenoid already has the hard machinery for trust, but is
using it as internal plumbing instead of as the product.**

- A graph of pure functions (the compute engine) — every value has a clear origin.
- A type system on the sockets — the app already knows a "number" can't plug into a
  "date."
- Errors that are tagged and flow through the graph (`SolError`, e.g. `#DIV/0!`).
- Every cable *is* a dependency — the "what depends on what" is right there.

Excel has none of these and can't add them now. Every bet below takes one of those
internal strengths and promotes it to "the reason you'd pick Solenoid." The pitch
shifts from *"Excel, but with nodes"* to **"the spreadsheet you can actually trust."**

---

## Bet 1 — Treat a chain of nodes as something to *compile*, not step through

**VERDICT (author, 2026-07-02): IN — with one hard condition: per-node previews stay.**
Every verb card keeps its head-N preview exactly as today; under fusion a preview is
"collect head-N of the plan at this node's point." Losing previews would have been the
one cause for rejection — treat them as a non-negotiable invariant of the fused engine,
not a nice-to-have. JS oracle stays eager; parity tests pin semantics.

**The highest-leverage, most self-contained bet. Do this first.**

**Today:** each relational node (Filter, Join, Group By…) sends its single operation
to the Polars engine on its own and pulls back its own preview. A three-node chain =
three separate trips to the engine, three previews. The docs literally call the
current engine "the ceiling."

There's a parallel story on the math side: a chain of scalar nodes is evaluated one
node at a time by walking the tree. Interestingly, the codebase **already contains a
formula *compiler*** (`compileFormula` in `excelFormula.ts`) that turns a formula
into a single fast function — it's just not used in production. You've built more of
this than you're running.

**The change:** treat a connected run of nodes as one thing to hand off whole, rather
than a sequence to execute step by step.
- **Relational side:** let a Filter→Join→Group By chain build up a single *plan* and
  run it **once**, at the point where a result is actually shown. Polars is itself a
  query optimizer — give it the whole plan and it will skip columns and rows it
  doesn't need. Right now, by running each verb separately, we're actively stopping it
  from doing that. You're ~80% here already (the "lazy handle on a cable" work); the
  missing piece is not running each step eagerly.
- **Math side:** compile a whole connected region of scalar nodes into one function
  instead of one call per node — the compiler is already written.

**Why it's the ceiling-breaker:** "the engine is the ceiling" stops being true. A
10-million-row filter-then-group would only touch the rows and columns it needs — the
difference between a nice demo and something that eats a real dataset without
flinching. This is architecture you already pointed at and stopped one step short of.

**First step:** make the desktop engine's per-verb call *accumulate* a plan instead of
computing immediately; only compute when a preview or a final result is asked for.
Measure a 3-verb chain — you should see the engine trips drop from ~3 to ~1.

**Risk:** a fused plan is harder to inspect step by step. Keep per-node previews as an
opt-in "show me the result here" marker — you already have the concept of a
"materialize here" boundary.

---

## Bet 2 — Make the saved document a clean, addressable structure with a *text* view

**VERDICT (author, 2026-07-02): IN — but NOT the phased export/import-first route.**
The author doesn't ship half-finished: the text projection, the stable-name scheme, and
the promotion to real save format land TOGETHER as one build (pre-alpha, no migration
baggage — old saves just load via the JSON reader while it exists). Design session
required before build (name scheme, line grammar, visual-state carriage, round-trip
guarantees) — first among the deep-dives.
**Positioning ruling (applies project-wide):** we do NOT advertise AI. The public story
is the Obsidian path — file-over-app, plain text, git control, longevity, no lock-in.
AI fidelity falls out of that naturally and stays an internal design value, not a
marketing line. (Reframes strategy threads #5/#7 and the #19/#35 pitch language.)

**The biggest ceiling, the biggest lift. Prototype small before committing.**

**Today:** a save is one JSON blob (`{nodes[], connections[]}`). As the audit found,
a few source files even contain hidden zero-bytes that make git treat them as binary.
The whole artifact is unfriendly to version control. And you personally drive this
tool with an AI, which means the AI is editing a blob it can't reliably navigate.

**The change:** make the underlying model clean and *addressable* — every node has a
stable name, not just a random ID — and treat the **visual graph, a simple text form,
and the JSON save as three views of the same thing.** The text form is one node per
line, in a predictable order, so two versions produce a readable difference.

**What this unlocks — all from one move:**
- **Spreadsheets in git.** Branch a model, open a pull request, review the *diff of
  the logic* instead of a binary blob. No spreadsheet tool has this.
- **Genuinely AI-friendly editing.** An AI edits a text/structured view with stable
  names — reliable, reviewable, undoable — instead of guessing inside a JSON blob.
  Given how you build, **"the first spreadsheet designed to be co-authored with an
  AI"** is a real, defensible angle, and you're the ideal first user of it.
- **Testing and code-generation** (Bets 3 and 5) get much easier, because now there's
  a real structure to attach them to.

**First step:** write the text view as a straightforward conversion out of the current
graph, plus a reader back in. Ship it as export/import first; make it the "real" format
later. Kill the hidden zero-bytes as step zero (already in the audit).

**Risk:** two save formats to keep in sync. Contain it by *generating* the JSON from the
clean form, not hand-maintaining both.

---

## Bet 3 — Turn the socket types into a "the whole table type-checks before it runs" pass

**VERDICT (author, 2026-07-02): IN.** Pure `shapeOf(verb, inputShapes)` per verb + a
static walk; shapes shown at the cable; both engines satisfy the one declared shape
(parity drift becomes a seam error). Gates slots, linked graphs, publish, composite
contracts, column-level where-used, transpiler typing, MCP schema.

**Today:** the type system checks one plug against one socket, at the moment you draw a
cable. It does **not** carry a whole table's shape (its column names and types) down a
chain. So you only discover that a Join produced two columns with the same name, or
mismatched a key, when you actually *run* it (this is also where the audit found the
desktop and web engines disagreeing).

**The change:** add a pass that figures out, for every table cable, **what columns and
types it will produce — before anything runs.** Each verb already knows how it
reshapes a table; lift that knowledge into a separate "work out the shape" step that
runs ahead of execution.

**Why it's great, not just nice:**
- The canvas can tell you *"this Join will give you these 7 columns, of these types"*
  as you wire it, and flag an impossible join *before* you run it.
- **Lineage:** "this column comes from `orders.qty` × `fx.rate`." That's the
  see-what-depends-on-what auditability Excel simply cannot offer.
- It also **quietly fixes the biggest maintenance tax you have**: the desktop
  (Polars) and web engines currently drift apart and need constant parity-testing. If
  both are required to satisfy *one declared table shape*, a disagreement becomes an
  obvious error at the seam instead of a silently-wrong column on one platform.

**First step:** a pure "given this node, what's its output table shape?" function,
reusing the verb definitions you have; show its answer in the cable inspector that
already exists. Later, refuse to run a graph whose shapes don't line up.

---

## Bet 4 — Make "why is this value what it is?" a first-class, clickable thing

**VERDICT (author, 2026-07-02): IN.** Two tiers: (1) errors carry origin (node/input/
row) at mint, shown in popup — cheap, do with the build; (2) on-demand derivation walk
for any value ("why am I this?") — frame cells reconstruct per-query by walking the
verb chain backwards, never stored exhaustively. Feeds #30/#6/#7/#32/#56 + Cube
comprehension.

**Today:** errors are tagged and flow through the graph — but a `#DIV/0!` buried in a
50,000-row table doesn't tell you *which row, which upstream node, which input* caused
it. The Alerts panel tells you something happened; it doesn't help you investigate.

**The change:** every value already has a history (it's a graph of pure steps). Make
that history *clickable* — a cell or an error can answer "why am I this?" by walking
back through the nodes and inputs that produced it. Errors carry where they came from
(which node, which input, which row). It's Excel's "trace precedents," except it
actually works on calculated and nested data.

**Why:** "click any number, see its full derivation" is a killer demo and the single
thing analysts ask for most. Combined with Bet 2's stable names, you can *share* a
derivation ("the discrepancy is right here"). It's also how you make the **Cube** (the
nested-table container — your most original, least-Excel-like feature) understandable,
because nested data is exactly where "where did this come from?" is hardest and most
valuable.

**First step:** add an optional "where did I come from" tag to errors when they're
created (cheap — errors are rare), and show it in the value popup. Extend to ordinary
values later.

---

## Bet 5 — The web-engine question (read this one carefully — it's a genuine trade-off, not a recommendation)

I need to walk back part of what I said in chat, because the project already made this
decision on purpose.

**What I originally suggested:** add a second engine (DuckDB — a fast analytical
database that, unlike Polars, *can* run inside a web browser) so the web build has a
real engine too, behind the existing swappable-backend seam.

**The catch you correctly flagged, and the recorded decision:** on **2026-06-22 the
author chose Polars precisely because it's the fastest engine**, and explicitly
accepted that Polars has no real browser version — so **the web build is a
"look and try" demo, not a full-capability target.** The desktop app is the real
product. (See `dev-notes.md`, "DECISION (2026-06-22): Polars.")

So let me be clear about what is and isn't a performance risk:

- **Desktop performance is never on the table here.** Any second engine would sit
  behind the same swappable seam and only serve the *web* build. Desktop stays 100%
  Polars, full speed. Adding a web engine does **not** slow the desktop app down.
- **The real question is only:** *do you want the web build to be a real tool, or is
  "look and try" the right call forever?* If "look and try" is right — and your 2026
  reasoning was sound — then **don't do this.** It's real work to maintain a second
  engine, and you'd be spending it on a build you've decided isn't the product.
- **The one piece worth keeping regardless of the browser question:** the same
  swappable seam could point Solenoid at a database *you already have* (a warehouse, a
  Postgres, a big DuckDB file on disk) — from the **desktop** app. That's not "compromise
  for a web version"; that's "point the desktop tool at data too big to load," and it
  reframes Solenoid as *a visual front-end over your real data*, not just a file
  editor. The verb set you built (Filter/Join/Group By/Pivot…) is exactly the shape of
  a database query. **That angle stands on its own and doesn't touch the web decision.**

**My honest recommendation:** leave the web build as-is (your call was right), and *if*
this thread ever gets picked up, pursue only the "desktop points at a big external
database" version. Prototype it behind the seam for the five most-used verbs and see if
it feels good before committing.

**Risk if ignored:** none — this is the one bet that's genuinely optional. The others
compound on each other; this one is a standalone maybe.

---

## Smaller swaps to things you already built

- **VERDICT (author, 2026-07-02): IN, and EXPANDED — full dimensional algebra.** Not
  just carrying a unit through the type system: true unit *calculation* — 5 m ÷ 1 s =
  5 m/s. Representation: exponent vector over base dimensions + scale factor; ops
  compose dimensions algebraically (× adds exponents, ÷ subtracts, +/− requires match,
  powers scale, cancellation free); derived-unit display (m/s, N, W) as formatting over
  the vector. Expression/LAMBDA: run a SECOND, dimensional interpretation over the
  formula AST — operators by the algebra, catalog functions by per-function dimensional
  signatures (SUM preserves, SIN requires dimensionless, SQRT halves); unsigned
  functions break the unit loudly. Dimensional mismatch mints a new tagged `#UNIT!`
  error. The v0.9 FC lock/carry/break semantics must be re-expressed on the type layer
  without regression (Unit Flow seed = acceptance test); design session merged with
  v1.1 WS-A's function model + A4 units-by-dimensionality. The unitFlow walker is
  DELETED, not extended.
- **Units as part of the type, not a side-system.** The unit tracking (`$`, `kg`, `%`)
  currently walks the graph in both directions on every redraw to figure out what unit
  a value carries (the perf audit flagged the cost). If units were baked into the
  socket *type* instead, they'd flow through the type system for free, and "meters +
  seconds" would become an error you catch *before* running, not a surprise after. It's
  simpler *and* stronger — you'd delete the walker, not extend it.

- **VERDICT (author, 2026-07-02): OUT as identity; keep as headline capability.**
  The "nobody has it" claim doesn't survive the cube-node-scope.md survey — Power Query
  drilldowns, tidyr list-columns, BigQuery STRUCT/ARRAY are all nested tables. The
  narrow claim that IS true (a nested table as a first-class *document value* that
  rides cables and recomputes — vs PQ's editor-only transient that must flatten to
  land, and Excel's literal `#CALC!` nested-array error) needs explaining every time,
  which disqualifies it as an identity the author can sell in one sentence. Keep it
  as a capability story: the Cube seed + a gallery page under strategy thread #1
  ("Excel errors if you even try to nest an array; here it's a value"), beneath the
  thread-#5 file-over-app identity. No strategy-thread rewrite.
- **Bet the identity on the Cube.** The nested-table container is your genuinely
  anti-Excel idea. Excel is a flat grid; shaped/nested data is strictly more powerful
  and nobody has made it *visual and approachable*. "The spreadsheet for shaped data"
  is a sharper story than "Excel, but nodes."

- **VERDICT (author, 2026-07-03): OUT.** Author: "it's not a bad idea per se, but these
  recommendations are often slowing people down and never as accurate as to what's in
  people's heads." Supersedes the 2026-07-02 PARKED note below.
- ~~VERDICT (author, 2026-07-02): PARKED — author wants to think on it; revisit at the
  end of the walk (alongside golden tests). Presented as: deterministic rules over the
  existing import inference sketch a starter graph (offer, never forced, one-undo
  deletable); warm-up for the transpiler's emit-nodes machinery.~~
- **Let the data draft its own graph.** You already inspect a file's columns when it's
  imported. A great first-run experience: drop a CSV, and the tool *sketches* the
  cleanup/typing/likely-joins graph for you to refine — instead of a blank canvas. Pairs
  perfectly with the AI-friendly direction: "the graph writes its own first draft."

- **VERDICT (author, 2026-07-03): OUT.** Author: "I think it's out tbh." Supersedes the
  2026-07-02 PARKED note below.
- ~~VERDICT (author, 2026-07-02): PARKED — revisit at the end of the walk. "Not sure
  it's super intuitive, but there's potential." Concrete examples discussed (regression
  pin on a model output capturing free-input values → expected output; edge-case pins
  on Expression/LAMBDA; summary assertions on frame chains; external-truth pins vs
  published tables). The UX gesture needs to feel obvious before it's in; note the
  trust-triad/governance features and #58's badge row lean on it if it lands.~~
- **Golden tests on any node.** Because every node is a pure function, let a user pin an
  example "with this input, expect this output" onto a node. The whole graph then
  re-checks itself on every change. Nobody can unit-test an Excel workbook; you'd get it
  almost for free from machinery you already have.

---

## What I'd do, and what I'd *not* do

**Suggested order:**
1. **Bet 1 (compile/fuse the chain)** — highest leverage, most self-contained, makes
   the whole thing feel fast and removes the scale ceiling using a seam you already have.
2. **Bet 3 (shape-checking pass)** — delivers the trust story *and* dissolves the
   desktop-vs-web parity tax that's a permanent maintenance cost today.
3. **Bet 2 (clean addressable model + text view)** — highest ceiling (git-native,
   AI-native), but the biggest lift, so prove it small before committing.

Bets 4 and the smaller swaps slot in alongside. **Bet 5 is optional and mostly a
"don't" — leave the web decision alone.**

**What I'd resist:**
- Chasing Excel's function *count* — you already capped the formula language on purpose;
  hold that line.
- Multiplayer/collaboration *before* Bet 2 exists — real-time editing on a blob is
  misery; on a clean addressable model it's tractable.

**The through-line:** the discipline that makes this list work is the one you already
have — small pure cores, one swappable engine seam, honest tagged errors. Great products
here come from **leaning harder on the internals you got right**, not from bolting on
surface area.

**One meta-point worth saying out loud:** nearly every bet above is *cheaper for you
specifically* because you build with an AI. A cleanly-addressable model, declared table
shapes, golden tests, and derivation tracking are all things that make the codebase
legible to an AI collaborator too. So the architecture that makes Solenoid trustworthy
for *users* is the same architecture that makes it faster for *you* to keep building.
That alignment is rare — worth optimizing for on purpose.

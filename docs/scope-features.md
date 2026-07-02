# Solenoid — Scope-expanding features (good → great)

Companion to [`future-directions.md`](future-directions.md). That doc was about
*architecture* — the plumbing. This one is about **new scope**: features that make
Solenoid a *different kind of thing*, not a richer version of the same thing. The
test each idea has to pass: it should open a use case Solenoid can't serve today, and
it should be **unlocked by** the architecture bets in the companion doc — not bolted on.

Each entry: the scope jump, what makes it possible, a concrete picture, the smallest
first step, and the honest risk. Ordered boldest-first.

The recurring move: Solenoid already has a graph of pure computations, a type system,
tagged errors, and (soon) fused/compiled execution. Those are the raw materials for
things Excel structurally *cannot* do. Most of the ideas below are just "notice what
the DAG already is, and let people use it that way."

---

## 1 — Simulation mode: feedback loops + time (the boldest jump)

**Scope today:** a graph computes **one** state, once. A cycle in the graph is an
error (`#CIRC!` — the engine detects loops with Tarjan's algorithm and refuses them).

**The jump:** add a **time dimension**, and a cycle stops being an error and becomes a
**feedback loop** — the single most important primitive in simulation. A node's output
this step feeds its input next step. That one change turns Solenoid into a
**system-dynamics modeler** — the category of tools (Vensim, Stella/iThink) used for
climate models, epidemic spread, supply chains, business "stock and flow" dynamics.

Here's the thing: **those tools are node graphs.** Solenoid already *looks* like one and
already *is* one. It is maybe 80% of the way to being a simulation tool and doesn't know
it. The `#CIRC!` deadlock you currently guard against is the exact structure a simulator
is built around; it's a wall today only because there's no notion of "next step" for the
loop to advance through.

**Concrete picture:** a "population" node feeds a "births" node feeds back into
"population"; you press play; a chart animates the model running for 100 steps. Or a
cash-flow model where this month's balance depends on last month's. Excel does this only
with painful manual row-by-row copying; here it's the natural shape of the graph.

**Enabled by:** the pure-function DAG (deterministic re-evaluation) + the compile/fuse
bet (running the graph 100× cheaply). The loop detection you already built becomes the
thing that *identifies* which nodes are the feedback loop and need step-wise evaluation,
instead of the thing that rejects them.

**First step:** a "Simulate" node that takes a subgraph containing one loop, an initial
value, and a step count, and returns the series. Don't rebuild the engine — evaluate the
looped region N times, feeding output→input, collecting each step. Prove it on a
two-node population model before generalizing.

**Risk:** it's a genuine new mental model; keep it opt-in (a Simulate container), so the
normal "compute once" world is untouched and cycles still error *outside* it.

---

## 2 — Turn any graph into a shipped tool: form, API, or mini-app

**Scope today:** Solenoid is where you *build*. The graph is the artifact; to let
someone else use your work, they need Solenoid and the file.

**The jump:** because a graph is **pure functions with typed inputs and typed outputs**
(once schema inference exists), *any* graph can be **published** three ways without
anyone seeing the graph:
- **A form / calculator** — expose the input nodes as fields, the output nodes as
  results. A mortgage calculator, a pricing quoter, a unit converter — built visually,
  shared as a clean single-purpose page.
- **An API endpoint** — inputs = parameters, outputs = JSON. Your model becomes
  something another program can call.
- **An embedded report** — a read-only, always-current view of the outputs.

This is the scope jump from *spreadsheet tool* to **"build an internal tool without
code."** It's the Retool/Airtable-apps space, reached from a completely different (and
more powerful) starting point: a real computation graph instead of a database with
buttons.

**Enabled by:** schema inference (Bet 3 — you need to *know* the typed input/output
boundary to generate a form or validate an API call) + the clean addressable model
(Bet 2 — a stable, serializable definition of "this graph, its inputs, its outputs").
Neither is possible on the current JSON-blob-of-random-IDs model.

**Concrete picture:** right-click a graph → "Publish as form." Solenoid reads the input
sockets (it already knows their types and units), lays out a form, and gives you a link.
The person filling it out never sees a node.

**First step:** the local version first — a "Run panel" that lists the graph's inputs as
fields and its outputs as results, in-app. That alone is useful (it's a clean way to
*use* a model you built) and it's the whole engine for the published versions later.

**Risk:** hosting/sharing is real infrastructure. The *local* run-panel is not — do that
first, and it's valuable on its own.

---

## 3 — Live data: from a document you open to a surface that watches

**Scope today:** data is imported — a CSV, a fetched URL, a pasted table. It's a
snapshot. You re-import to refresh.

**The jump:** **connected, refreshing data sources.** A source node points at a database
table, an API, or a file that changes, and **refreshes on a schedule or on demand**. The
pure DAG means everything downstream recomputes automatically and correctly. Pair that
with the **Alert node you already have**, and Solenoid becomes an **always-on monitoring
and alerting surface** — not a file you open, but a dashboard that watches and pings you
when something crosses a line.

This is the scope jump from *analysis* to *operations*. "Tell me when inventory drops
below reorder point." "Watch this API and flag anomalies." The graph is the monitor.

**Enabled by:** the external-engine backend (Bet 5, in the "point the desktop app at a
real database" form — explicitly *not* the web-compromise version) + the pure DAG
(automatic, correct downstream recompute) + the existing Alert/HUD system, which was
built for exactly this and is currently only fired by manual recomputes.

**Concrete picture:** a source node with a "refresh every 15 min" setting; a chain that
computes a metric; an Alert node at the end. Minimize Solenoid; it taps you on the
shoulder when the number goes red.

**First step:** a manual "Refresh" on source nodes that re-pulls and recomputes (no
scheduler yet). Then add an interval. The alerting is already built.

**Risk:** scheduling/background execution is more app-lifecycle complexity (it has to run
while "idle"). Manual refresh is the safe first slice and already useful.

---

## 4 — What-if: scenarios, goal-seek, and "any cell can be the unknown"

**Scope today:** you change an input, you see one new result. The Sensitivity node exists
but works one variable at a time.

**The jump:** treat the whole graph as a **model you can interrogate**, three ways:
- **Scenarios** — define several named input sets ("optimistic / base / pessimistic")
  and see all the outputs side by side, from one graph.
- **Monte Carlo** — let an input be a *range* or distribution, run the model thousands of
  times, and see the spread of outcomes instead of a single fragile number.
- **Goal-seek / solve** — pin an *output* to a target and ask Solenoid to find the input
  that produces it. Generalized, this is the deep one: **a spreadsheet where any cell can
  be the unknown**, not just the ones you happened to wire as inputs. The graph normally
  flows one direction; solving lets you run it "backwards" against a goal.

This is the scope jump from *"a calculation"* to *"a model you can stress, explore, and
optimize."* It's Excel's Solver and Data Tables — the features power-users reach for and
everyone else finds impossible — made visual and native.

**Enabled by:** the compile/fuse bet (Bet 1). Running a whole graph thousands of times is
only reasonable once a graph is *one compiled function* instead of a node-by-node
walk. This feature is basically *why* fusion is worth doing.

**Concrete picture:** select an output, hit "Goal seek," type a target, pick which input
to vary — a slider settles on the answer. Or a "Scenarios" panel with three columns of
inputs and a synchronized three-column output.

**First step:** scenarios first (no solver math — just run the compiled graph with N
input sets and lay the outputs out). Goal-seek (needs a simple numerical solver) second.

**Risk:** goal-seek on a non-numeric or discontinuous graph can fail to converge — scope
it to numeric inputs/outputs and be honest when it can't find an answer (you already have
a `#CONV!` convergence error for the finance nodes — reuse that vocabulary).

---

## 5 — Subgraphs as shareable, typed functions → a reuse ecosystem

**Scope today:** every graph is built from scratch. There's groundwork for "packs" and a
composite node in the design docs, but no reusable user-defined building block.

**The jump:** a subgraph with typed inputs and outputs **is a function.** Let people wrap
a chunk of graph into a **named, reusable, shareable node** — "Amortization schedule,"
"Cohort retention," "Clean this messy address column." Build it once; drop it in anywhere;
share it. That's the scope jump from *tool* to *platform*: a growing library of
community (or personal) building blocks. "A package registry, but for spreadsheet logic."

**Enabled by:** schema inference (Bet 3 — a reusable node has to advertise a *typed*
input/output contract, or you can't safely wire it in) + the addressable/text model
(Bet 2 — a shareable, diffable, version-able definition). The composite-node idea in the
pack docs has been waiting for exactly these two foundations.

**Concrete picture:** select 8 nodes → "Make into a node" → it collapses to a single card
with the right input/output sockets and a name. It behaves like any built-in node.
Export it; someone else imports it and uses it without opening it up.

**First step:** local composite nodes (collapse-a-selection-into-a-node), no sharing yet.
That's the whole mechanism; distribution is a later layer.

**Risk:** versioning shared blocks (what happens when a building block updates under a
graph that uses it) is the hard part — but it's identical to the placeholder/provenance
machinery you already shipped for missing node types. Local composites have none of that
risk and deliver most of the value.

---

## 6 — Snapshots + diff: "what changed, and why"

**Scope today:** a save is the current state. There's no "what did this model say last
month," and no way to compare two versions of a model or its outputs.

**The jump:** **named result snapshots** plus a **diff that explains itself.** Freeze
"Q2 close." Later, compare it to "Q3 close" and see not just *that* a number changed but
*why* — the diff walks the derivation and points at the input that moved. This is the
audit/trust story (the whole thesis of the companion doc) turned into a concrete,
sellable feature: **a spreadsheet with a memory and an explanation.** It's the direct
answer to every "why is this total different from last week?" fire drill.

**Enabled by:** the clean addressable model (Bet 2 — you can only diff two versions
meaningfully if nodes have stable identities across versions) + provenance (Bet 4 — the
"why" is a walk back through the derivation to the input that changed).

**Concrete picture:** "Snapshot" button; a snapshots list; "Compare" shows two result
sets with changed cells highlighted, and clicking a changed cell says "this moved because
`fx_rate` went 1.08 → 1.11."

**First step:** snapshot + a plain *result* diff (which output numbers changed). The
"why" explanation is the richer follow-on once provenance lands.

**Risk:** low. Snapshots are just saved states; the diff is comparison. The self-
explaining part depends on provenance but degrades gracefully without it.

---

## 7 — A natural-language layer: build by asking, and narrate any number

**Scope today:** you build by wiring nodes. Understanding a model means reading the graph.

**The jump:** two directions of plain-English:
- **Build by asking** — "join these two tables on customer id and show me revenue by
  month" produces (or edits) the graph. The person describes the outcome; Solenoid
  assembles the nodes.
- **Narrate any number** — click an output and get a written explanation: "This is total
  revenue: sum of the `amount` column after filtering to closed deals, times the FX
  rate." A model that can *explain itself in words* to a reviewer who doesn't read graphs.

This is the scope jump to **analyst augmentation** — and it's the payoff of designing the
whole system to be legible to an AI in the first place.

**Enabled by:** the addressable/text model (Bet 2 — an AI can reliably read and edit a
clean text projection, but not a blob of random IDs) + provenance (Bet 4 — "narrate this
number" is just a provenance walk rendered as prose). This is the feature that most
directly cashes in the "built to be co-authored with an AI" bet.

**Concrete picture:** a prompt box that edits the graph; a right-click "Explain this"
that turns a derivation into a paragraph a manager can read.

**First step:** "narrate this number" first — it's read-only (walk the provenance,
describe it), lower-risk, and immediately useful. Build-by-asking (which *writes* to the
graph) comes after the text model makes edits safe and reversible.

**Risk:** build-by-asking that writes to the graph needs the reliable, reversible edit
surface from Bet 2 — don't ship it against the current blob. The read-only narration has
none of that risk.

---

## How they stack up

If I had to rank by *scope gained per unit of work, given the architecture bets land*:

- **Biggest new territory:** #1 Simulation (a whole new category — system dynamics) and
  #2 Publish-as-a-tool (spreadsheet → app platform). These are "different product" moves.
- **Highest certainty of payoff:** #4 What-if and #6 Snapshots — they extend obvious
  existing needs into clearly-better versions, and #4 is the concrete *reason* the fusion
  work pays off.
- **Most strategic:** #5 Subgraphs (tool → platform) and #7 Natural language (leans all
  the way into the AI-native identity) — but both genuinely depend on Bets 2 and 3
  existing first, so they're second-wave.
- **Best "already 80% there":** #1 (the loop machinery exists), #3 (the Alert system
  exists), #4 (the Sensitivity node exists). These are closer than they look.

The honest sequencing: the architecture bets in the companion doc are the enabling layer,
so **Bet 1 (fuse/compile) → feature #4 (what-if)** and **Bet 3 (schema) → feature #2
(publish) / #5 (subgraphs)** are the natural pairings to pursue together — build the
foundation and the headline feature it unlocks in the same push, so the plumbing always
has a visible payoff.

One unifying way to say all of it: today Solenoid is a **calculator you draw.** Every
feature here turns it into something with a longer half-life — a **model** you can
interrogate (#1, #4), **ship** (#2, #5), **run continuously** (#3), **trust over time**
(#6), and **talk to** (#7). That's the good-to-great gap: not more nodes, but more *verbs*
for what a graph can be.

---
---

# Round 2 — the adoption wedge, the write side, and the graph as software

A second batch, same rules (scope jumps, architecture-enabled), different territory.
Round 1 was mostly about what a *built* graph can become. Round 2 is about the three
walls around the product: **getting people in** (from Excel), **getting effects out**
(writes, actions, other machines), and **getting other people involved** (review,
narrative). Verified against the code first: none of these exist in any form today —
and the raw materials for several already do.

---

## 8 — The Excel transpiler: open an .xlsx, see it as a graph

**Scope today:** Solenoid is greenfield-only. Everyone's real models are in Excel, and
the only path in is rebuilding by hand. That's the adoption wall.

**The jump:** **import an Excel workbook and *transpile* it** — formulas become nodes,
cell references become cables, ranges become frames, sheets become groups. The user's
own model, re-drawn as a graph they can finally *see*. This is the single
highest-leverage adoption feature possible, and it doubles as the best demo of the
whole thesis: open your workbook and Solenoid *shows you* the dependency spaghetti
Excel was hiding. "Your spreadsheet is a graph. It always was — you just couldn't see it."

**Why Solenoid is unusually positioned for it:** the hard parts already exist.
`excelFormula.ts` contains a real **Excel formula parser** (tokenizer + AST) built for
the Expression node, and the function catalog already maps a large Excel surface to
nodes. A transpiler is: parse `.xlsx` (the format is documented XML; libraries exist) →
run each formula through the parser you already have → emit nodes/cables → let the
Tidy layout you already have arrange it. Nobody else in the node-tool space has parity
machinery this deep to build on.

**Honest scoping:** don't chase 100%. Transpile the tractable core (arithmetic, the
supported function set, contiguous ranges → frames) and drop an **Expression node
containing the original formula text** for anything that doesn't map — visible,
inspectable, fixable by hand. Even a 70% transpile that flags the other 30% is
transformative, because the alternative is 0%.

**Enabled by:** the existing formula AST + function parity (already shipped), schema
inference (Bet 3, for turning ranges into typed frames), and the placeholder machinery
(already shipped) for the un-mappable remainder.

**First step:** a CLI-grade spike: one sheet, values + arithmetic formulas only, emit a
graph JSON, open it. The moment a real workbook renders as a graph — even a toy one —
you'll know whether this is the flagship feature it smells like.

**Risk:** Excel's semantic long tail (volatile functions, array spills, cross-sheet
3-D refs). Contained by the fallback-to-Expression-node strategy: correctness by
honesty, not by completeness.

---

## 9 — The write side: a graph that changes things, not just computes them

**Scope today:** the graph is strictly read-and-compute. Data comes in; numbers are
displayed; nothing ever leaves except copy/paste. (Verified: no write-back, no file
emit, no outbound action of any kind in the node set.)

**The jump:** **sink nodes** — the graph gets *effects*. Three tiers, each a scope jump
on the last:
- **Write files:** a "Write CSV/JSON" node — the graph becomes a repeatable
  *transformation pipeline* (drop in messy exports, get clean files out), not just an
  analysis you look at.
- **Write back to sources:** edit a cell in a frame view, or compute a correction
  column, and push it to the database/API the data came from. The jump from *analysis
  surface* to **read-write data hub** — the thing that today requires a fragile
  Python script.
- **Act:** on an alert or on demand — send a webhook, write a file, notify. Combined
  with Round 1's live data (#3), Solenoid becomes an **automation**: *watch this,
  and when it crosses the line, do that.* IFTTT-with-a-real-compute-engine.

**The crucial design move:** effects must not infect the pure graph. Sinks are
**terminal nodes that only fire on explicit command** (a Run button, an alert edge, a
scheduled trigger) — never during normal recompute. The purity of everything upstream
is exactly what makes effects *safe*: you can see precisely what would be written
before anything fires (it's just the value on the cable).

**Enabled by:** the pure DAG (dry-run-able effects — a preview of a write is free), the
Tauri fs/http plumbing (already shipped), the Alert edge-detection (already shipped —
it's the natural trigger), and calc-mode's manual/auto machinery (already shipped —
the same "don't run until told" discipline sinks need).

**First step:** Write CSV node, manual-trigger only. It's a weekend of work on existing
plumbing and instantly makes Solenoid a usable ETL tool.

**Risk:** writes are the first genuinely dangerous thing in the app. Mitigations are
cheap and structural: explicit-trigger-only, a preview-what-will-be-written pane, and
sinks disabled by default in shared/imported graphs.

---

## 10 — Headless Solenoid: the graph as a software artifact

**Scope today:** a graph runs only inside the app, with a human watching.

**The jump:** **run a graph without the UI** — `solenoid run model.sol --set rate=0.05
--out results.json`. Suddenly a Solenoid file is a *program*: schedule it (cron), gate
a deploy on it, run it in CI, call it from a script. Pair it with golden tests
(companion doc) and you get the sentence that should raise eyebrows: **"our financial
model runs in CI, and the build fails if its assertions break."** No spreadsheet on
earth can say that.

This is the quiet enabler for half of everything else: publish-as-API (#2) is headless
+ an HTTP wrapper; scheduled monitoring (#3) is headless + a timer; the transpiler's
value (#8) compounds when the migrated model becomes CI-testable.

**Why it's cheaper than it sounds:** the compute core is already UI-independent — pure
`data()` methods, a headless-tested engine (the perf suite literally runs graphs in
vitest with no DOM today), and the Rust engine is a plain library. The work is a thin
entry point: load graph → set inputs → run → print outputs. The web/desktop split
already forced the discipline that makes this possible.

**Enabled by:** the pure DAG (already shipped), the addressable model (Bet 2 — you need
stable names to say `--set rate=0.05`), schema inference (Bet 3 — typed CLI args and
outputs for free).

**First step:** a `scripts/run-graph.ts` that loads a saved graph in Node, runs the
engine, prints named outputs as JSON. The vitest seed-tests are 80% of this already —
it's closer to *extracting* a feature than building one.

**Risk:** low, genuinely. Desktop-only nodes (Polars-backed) need the JS fallback path
in Node — which exists, because the web build needed it.

---

## 11 — Transform-by-example: Flash Fill that shows its work

**Scope today:** cleaning a messy column means knowing which Split/Extract/Replace
nodes to reach for and how to wire them. That knowledge is the barrier — the person
with the messy data knows *what they want*, not *which verbs produce it*.

**The jump:** **demonstrate, don't specify.** Type what the first two cells *should*
be; Solenoid infers the transformation and — this is the part Excel's Flash Fill
can't do — **emits real, visible, editable nodes** that implement it. Flash Fill is
magic that works until it silently doesn't, with no way to inspect what it guessed.
Here the guess *materializes as graph*: you can read it, correct it, and trust it,
because it's ordinary Solenoid logic once it lands.

That's the deeper pattern, bigger than cleaning: **example-driven synthesis with an
auditable result.** The AI/synthesizer proposes; the graph *is* the explanation; the
human owns it afterward. It's the same philosophy as the audit thesis — never trust
what you can't inspect — applied to authoring.

**Enabled by:** typed columns (schema, Bet 3) to constrain the search space; the text/
addressable model (Bet 2) for the synthesizer to emit into; the existing text-verb node
set as the target vocabulary. Works with classic program-synthesis techniques alone
(Flash Fill's own lineage — no LLM required); an LLM raises the ceiling.

**First step:** the narrow classic case — string transforms on one column from 1–2
examples (split/substring/case/concat patterns), emitting a Split Column or Expression
node. Even this covers an enormous share of real cleanup pain.

**Risk:** wrong inferences. Contained by the whole point: the output is inspectable
nodes plus a preview over the full column *before* accepting — the user reviews the
logic, not just the result.

---

## 12 — Expectation nodes: the data-quality gate

**Scope today:** tagged errors catch *computational* failures (`#DIV/0!`, `#SHAPE!`).
Nothing catches **plausible-but-wrong data** — the silent killer: the CSV that arrived
with duplicate IDs, the column that's suddenly 4% null, the amount that went negative.
The audit found exactly this class shipping wrong numbers silently.

**The jump:** **assertions as nodes.** An Expect node sits on a cable and declares:
*this column is never null; IDs are unique; amounts are in [0, 1e9]; row count within
20% of last snapshot.* Green badge flowing through when true; a loud tagged failure
(and an Alert, and — with #9 — a refusal to fire downstream sinks) when not. This is
what dbt tests and Great Expectations do for data pipelines, made visual, inline, and
zero-config — a *gate in the flow* rather than a test file somewhere else.

Together with golden tests (logic correctness) and snapshots (change over time), this
completes the trust triad: **the logic is tested, the data is validated, the history is
explained.** That's a sentence no spreadsheet — and honestly few data platforms — can say.

**Enabled by:** the tagged-error system (already shipped — a failed expectation is just
a new SolError with provenance), the Alert machinery (already shipped), schema
inference (Bet 3 — expectations can be *suggested* from the inferred schema and
profile: "this column looks unique; want to enforce that?").

**First step:** one Expect node with 4 checks (not-null / unique / range / regex),
pass-through output, red badge + alert on failure. It's a small node; the leverage is
in the pattern.

**Risk:** almost none technically. The design risk is nag-fatigue — keep expectations
strictly opt-in (user-placed nodes, not automatic warnings), consistent with the
no-Captain-Obvious rule.

---

## 13 — The report projection: one graph, a second face

**Scope today:** the canvas is the only view. It's built for *authors*. Showing work to
anyone else means screenshots — and the audience for a model is almost always larger
than its authors.

**The jump:** a **second projection of the same document**: a linear, readable,
notebook-style page — prose blocks, pinned values, tables, charts — where every number
is **live from the graph**. Not an export: a *face*. Edit the model, the report is
already current. Flip to present it; print it to PDF for the board pack; hand the
file to a reviewer who never opens the canvas. This is the literate-computing idea
(notebooks) grafted onto a computation model that's actually sound underneath — a
notebook where the cells can't be run out of order, because there is no order, only
the DAG.

**Why it's nearly free by the time you get here:** the ingredients exist — **pins**
already lift values out of the graph (`PinLayer`), Notes already render markdown,
charts are nodes, and Bet 2 says the document is one model with multiple views. The
report is "pins + notes, arranged on a page instead of a canvas."

**Enabled by:** the projection architecture (Bet 2 — this is its second consumer, after
the text form, which is exactly what proves an abstraction), pins/Notes/visual nodes
(already shipped), NL narration (Round 1, #7) slots in as auto-drafted prose between
the numbers.

**First step:** a read-only "Report" tab that renders the doc's pinned values and Note
nodes top-to-bottom in reading order. Ugly is fine; live is the point.

**Risk:** layout scope-creep toward "a document editor." Hold the line: blocks are
pins, notes, tables, charts — arrangement only, no rich-text ambitions.

---

## 14 — Node-anchored review: comments, questions, sign-off

**Scope today:** one author, one canvas, zero collaboration surface of any kind
(verified — no comments, no annotations, nothing). Round 1 deliberately deferred
*real-time* multiplayer. But the highest-value collaboration in modeling isn't
simultaneous editing — it's **review**: "why is this rate 4%?", "who approved this
change?", "checked, looks right."

**The jump:** **comments and review state anchored to nodes** (and, with Bet 2's stable
addresses, surviving edits and travel-with-the-file). A reviewer opens the graph, drops
questions on specific nodes, marks sections checked; the author resolves them; a graph
can carry "reviewed by X against snapshot Y." Combined with snapshots+diff (#6) this
becomes the full governance story — *the model, its history, its review trail, in one
file* — which is precisely the thing regulated/finance users are forced to fake today
with email chains and a "FINAL_v7_reviewed" filename.

And it's the right on-ramp to collaboration generally: async-first, no CRDT, no
server — a comment is just data in the save. Real-time can come later, on the
addressable model, if it's ever actually needed.

**Enabled by:** stable node identity (Bet 2 — comments must anchor to something that
survives edits), snapshots (#6 — "reviewed *as of* what"), and the existing
placeholder/provenance discipline as the pattern for carrying non-graph data in saves.

**First step:** a comment pin per node (author, text, resolved flag), stored in the
save, rendered like the existing corner badges. Single-user it's already useful as
**"notes to self with an address"** — TODO markers that live on the logic they're about.

**Risk:** low. The trap is building identity/permissions infrastructure — don't;
a name string in a local file is the 1.0 of this.

---

## Round 2, ranked

- **The wedge:** #8 (Excel transpiler) is the round's headline — it attacks the
  adoption wall directly, and an unusual amount of it already exists in the codebase.
  If only one Round-2 item ever ships, it should be this.
- **Cheapest scope-per-effort:** #10 (headless) and #12 (expectations) — both are
  small extractions from machinery that already works, and both unlock sentences no
  competitor can say.
- **The pair that compounds:** #9 (write side) + Round 1's #3 (live data) = the
  automation story; #10 (headless) quietly powers Round 1's #2/#3 as well. Build
  these as one arc: *in → through → out → unattended.*
- **Second wave (needs Bet 2 first):** #13 (report) and #14 (review) — both are
  projections/annotations over the addressable model, and both aim at the same
  audience: everyone who *reads* a model but will never wire a node.
- **The sleeper:** #11 (by-example) — the hardest to build well, but it's the one that
  changes who can use Solenoid at all, and its show-the-work framing is the product's
  soul applied to authoring.

Round 1 gave a graph more verbs. Round 2 gives it more **tenses and voices**: a past
(what it was in Excel, #8), a future (what it will do unattended, #9/#10), a
conditional (what it should be, #12), and other people's voices in it (#11, #13, #14).
Together the two rounds describe the same product from two sides: Round 1 makes the
graph *worth more*; Round 2 makes it *reach further*.

---
---

# Round 3 — the stretch: markets Solenoid could take that nobody built for

Rounds 1–2 stayed close to "spreadsheet, done right." Round 3 asks a bigger question:
**what do people genuinely struggle with today, hand-rolling brittle internal
solutions, where Solenoid's architecture is a better starting point than what they've
got — even though it's a stretch for the product as it stands?**

The honest framing on each: these are further from today's Solenoid, so each says
plainly *how big* the stretch is and *why the architecture is already closer than the
alternatives people suffer with.* The pattern that keeps recurring: whole categories of
software are, underneath, "a typed graph of computations you can inspect and re-run" —
and everyone in those categories built that graph badly, by hand, in code or in Excel,
because they had no tool that *was* one. Solenoid is one.

The bar for Round 3: not "could Solenoid do this" (it's Turing-complete-ish, so yes
trivially) but "would someone **switch** to it because the graph model is
*structurally* better than their spreadsheet-plus-Python-plus-hope." Where I don't
think it clears that bar, I say so.

---

## 15 — Engineering & scientific calculations (the MathCAD seat)

**Who's underserved:** engineers and scientists doing real calculations — structural
loads, heat transfer, tolerances, lab analysis. Their actual tools are a horror: Excel
with unlabeled cells nobody dares touch, or MathCAD (aging, expensive), or a Jupyter
notebook that's really a pile of undocumented globals. Their #1 recurring disaster is
**units** — the mars-orbiter class of bug — mixing meters and feet, forgetting a
conversion, and getting a plausible wrong answer that kills the design review.

**Why Solenoid is unusually close:** it already has a **unit system that travels with
values** (`unitFlow.ts`) and a **Convert node** — this is the single hardest thing to
retrofit and it's *already built*. Add units-as-types (companion doc's smaller swap) and
Solenoid becomes a calculation surface where **"newtons + seconds" is caught before you
submit, not after the bridge is built** — the one guarantee this audience begs for and
neither Excel nor Python gives them. Layer on the trust triad (tested logic, validated
inputs, explained derivation), and you have a calc sheet that a professional engineer
can *sign* — literally, since their work often requires a stamped, defensible
calculation. That's a paid, sticky, underserved seat.

**The stretch:** moderate. Needs units promoted to first-class, a library of
domain constants/formulas, and a print-quality output (Round 2's #13). Not a new engine.

**First step:** an engineering seed doc that leans hard on units + Convert, and a
"unit mismatch is an error, not a coercion" mode. See if an actual engineer flinches
at it or leans in.

**Why not just tell them to use Python:** because the person who owns the calculation
is the engineer, not a programmer, and the graph is reviewable by their colleague who
also isn't a programmer. That's the whole point — the domain expert stays in control.

---

## 16 — Bills of materials, recipes, and "cost/impact of a nested thing"

**Who's underserved:** anyone who costs out a **nested composed thing** — a
manufacturer pricing a product built from sub-assemblies built from parts; a
construction estimator; a cloud-cost modeler; a restaurant costing recipes made of
sub-recipes; a carbon-footprint analyst rolling emissions up a supply chain. Today this
lives in Excel with unspeakable nested VLOOKUPs, or a bespoke internal app that took
six months and does one thing.

The recurring pain is identical across all of them: **roll a number up a tree, then ask
"what if a leaf changes?"** Change the price of one screw; what happens to the cost of
every product that uses the assembly that uses it? Excel makes that a manual, error-prone
nightmare; the answer is never trustworthy and never fast.

**Why Solenoid is unusually close:** the **Cube** — the recursive nested-table container
— is *exactly* this shape and already exists. It's the most novel, least-Excel-like
thing in the product, and it's currently under-sold as a general feature when it's
really the seed of a **vertical**: "the tool for costing and impact-analysis of anything
made of other things." Combine the Cube (the nesting) with what-if/goal-seek (Round 1
#4: "what does hitting a target cost roll down to?") and change-provenance (Bet 4: "this
total moved because *that leaf* moved") and you've got the roll-up-and-trace loop that
this entire audience does by hand.

**The stretch:** small-to-moderate — this is more *positioning + a few Cube-aware
nodes* than new architecture. The Cube is the hard part and it's done.

**First step:** a bill-of-materials seed built on the Cube, with a leaf-change →
watch-it-ripple demo. If it lands, it's a category, not a feature.

---

## 17 — Decision models & scoring, made honest

**Who's underserved:** everyone who builds a **weighted scoring model** to make a
call — vendor selection, hiring rubrics, grant scoring, risk registers, prioritization
frameworks. It's always a spreadsheet, always fudged (weights nudged until the
"right" answer wins), and never auditable. The complaint isn't "I can't compute a
weighted sum" — it's "I can't *defend* the decision, and I can't show it wasn't rigged."

**Why Solenoid is unusually close:** there's already a **Decision Matrix** node. The
architecture adds the two things a defensible decision needs and a spreadsheet can't
give: **sensitivity** ("does the ranking survive if I wiggle the weights? Round 1 #4 as
Monte Carlo over the weights") and **provenance** ("here's exactly why vendor B won").
A scoring model where you can *prove the outcome is robust to your own bias* is a
genuinely different object from a spreadsheet — it's a decision you can put in front of
a board or a procurement auditor.

**The stretch:** small. Decision Matrix exists; this is sensitivity + provenance +
a report view pointed at that node. Arguably the *lowest*-stretch item in Round 3.

**First step:** wire the existing Decision Matrix to a "wiggle the weights, watch the
ranking" panel. It's a compelling 5-minute demo on parts that mostly exist.

---

## 18 — The reactive backend for someone else's app (Solenoid as an embeddable engine)

**Who's underserved:** developers who need **user-editable business logic** inside their
own product — pricing rules, insurance quote calc, loan eligibility, tax logic, game
economy tuning, feature-flag/entitlement rules. Today they either hard-code it (every
rule change is a deploy) or build a half-baked in-house "rules engine" that's always
under-powered. There's a reason "business rules engine" is a category people pay
dearly for and still hate.

**Why Solenoid is unusually close:** with headless execution (Round 2 #10) + publish-
as-API (Round 1 #2) + schema (Bet 3), a Solenoid graph *is* a hot-swappable,
non-technical-editable, **visually-auditable rules engine** with a typed contract.
The product person edits the pricing graph; the app calls it; no deploy; and — unlike
every rules engine on the market — **you can see the logic as a diagram and test it.**
That's "Solenoid as the calculation core other software embeds," which is a platform
play, not an app.

**The stretch:** large, and partly *product-shape*, not just features — it means
treating the engine as a shippable library with stability guarantees, versioning, and
an embedding story. But the hard technical core (a pure, headless, typed graph engine)
is exactly what the architecture bets produce anyway. The stretch is packaging and
commitment, not capability.

**First step:** don't build the platform. Prove the primitive: headless run + a stable
input/output contract for one graph, called from a tiny external script. If that feels
solid, the embedding story is a business decision, not a research one.

**Honest caveat:** this is the furthest from "spreadsheet app" and the one most likely
to be a distraction from a focused product. Filed because you asked for the stretch and
because it's real — but it's a fork in identity, not a feature.

---

## 19 — The safe cage for AI-generated analysis (the one genuinely new category)

**Who's underserved — and this one is *emerging*, not established:** everybody now has
an AI that will happily do data analysis, and nobody can trust a word of it. The AI
writes Python you don't read, computes a number in a sandbox you can't inspect, and
hands you an answer with a confident sentence. For anything that *matters* — a financial
figure, a medical dosage, a compliance number — "the AI said so" is unusable, because
there's no audit trail and no way to check the arithmetic.

**Why Solenoid is unusually close — arguably uniquely positioned:** the whole product is
**an inspectable, typed, testable substrate for computation.** Instead of an AI writing
opaque code, the AI **builds a Solenoid graph** — and now the computation is *visible*,
every intermediate value is *on a cable*, the types are *checked*, the errors are
*tagged*, and a human can *audit and correct* the reasoning instead of trusting a black
box. This flips the AI-analysis trust problem: the AI proposes the graph, the graph *is*
the explanation, and the human owns the result. It's the exact philosophy the audit
thesis is built on — never trust what you can't inspect — turned into a product for the
one workflow that most desperately lacks it.

Nobody owns this yet. The AI-data-analysis tools are all "trust the sandbox"; the
spreadsheet tools have no AI-native audit surface. Solenoid is the rare thing that is
*already* the audit surface and *already* being co-authored with an AI (by you, right
now). "**The place AI does the math where you can actually check it**" is a category
with a real, urgent need and no incumbent.

**The stretch:** medium on tech (it's Round 2's #11 by-example synthesis + Round 1's #7
NL layer, aimed at *whole analyses* rather than one column), large on being early — the
market is forming now. Depends hardest on Bet 2 (an AI-editable model) being real.

**First step:** the narrow, honest version — "ask a question about this table, get a
*graph* that answers it, not a number." Even a small version is a live demo of the
whole thesis, and it's the feature most aligned with how the product is already built
and used.

**Why this is the one I'd actually chase:** it's the only Round-3 item that is both a
genuinely new category *and* a straight-line extension of what Solenoid already
uniquely is. The others are Solenoid entering someone else's market; this is Solenoid
*defining* one that the whole industry is about to need.

---

## Round 3, honestly ranked

- **Chase it:** #19 (safe cage for AI analysis) — new category, no incumbent, and the
  purest expression of the product's soul. If Round 3 has a thesis, it's this.
- **Low-stretch, high-return verticals:** #17 (honest decision models) and #16 (BOM /
  nested costing) — both are *mostly positioning + a demo* on nodes that already exist
  (Decision Matrix, Cube), and both target audiences drowning in exactly the pain
  Solenoid removes. These are the safe bets of the batch.
- **Real seat, real work:** #15 (engineering calcs) — a paying, sticky, underserved
  audience, and Solenoid holds the one card (units-as-values) nobody else does; the
  stretch is a domain library and print output, not architecture.
- **Fork in the road, not a feature:** #18 (embeddable rules engine) — technically
  downstream of the same bets, but a genuine identity fork; file it, don't chase it
  unless the app-shaped product plateaus.

The meta-pattern across all four rounds: **so much of software is secretly a typed,
inspectable graph of computations that somebody had to build by hand, badly, because no
tool *was* one.** Engineering calcs, cost roll-ups, decision models, rules engines,
AI analysis — each is a market full of people re-implementing a worse version of what
Solenoid is natively. The good-to-great arc isn't adding features until it's a better
spreadsheet; it's realizing the graph is a general substrate and pointing it, one
credible vertical at a time, at the people already suffering without it. Start where the
architecture already leans (units → engineering, Cube → costing, Decision Matrix →
decisions), earn the right to the harder ones (rules engine, AI cage) with the trust
machinery, and let the identity grow from "spreadsheet, done right" into "**the
inspectable computation layer**" underneath a dozen jobs people currently hate doing.

---
---

# Round 3 — what people hand-roll today that Solenoid could scaffold better

A different question this round. Not "what feature should the app grow" but: **out in
the world, what do teams badly want, build themselves out of Excel + scripts + duct
tape, and never get right — where Solenoid's architecture is already closer than what
they're using?** These are less "features" than **jobs Solenoid could take**. Each one
names the hand-rolled thing it replaces, why the current way fails, and which existing
Solenoid pieces (verified in the code) do the heavy lifting.

The pattern behind all seven: there is a huge class of business logic that is **too
important for a spreadsheet but too fluid for software**. It lives in Excel because the
person who owns it can't write code, and it breaks because Excel can't be trusted or
run by machines. Solenoid — a *trustable, runnable* spreadsheet — sits exactly in that
gap. Nobody else does.

---

## 15 — The rules engine business people can actually edit

**The hand-rolled thing:** every company has calculation rules that change often and
matter a lot — discount policies, eligibility rules, risk scores, fee schedules. Today
they live in one of two bad places: in *code* (so every change is a ticket to
engineering, a translation meeting, and a two-week wait) or in *a spreadsheet someone
emails around* (so nobody knows which version production is actually following).
"Rules engine" software exists (Drools and friends) and business users can't touch it.

**The Solenoid version:** the rules ARE a graph. The person who owns the policy edits
nodes; engineering runs the *same file* in production through the headless runner
(#10). No translation step, no drift between "the spreadsheet that describes the rule"
and "the code that implements it" — they are the same artifact. The trust stack is what
makes this safe rather than terrifying: typed inputs/outputs (a bad edit fails loudly
before it ships), pinned example checks (the rule still gives the right answer for the
known cases), review sign-off (#14), and snapshots (what did the rule say *last* March,
when this customer signed up?).

**Already in the codebase:** the pure engine, typed sockets, tagged errors. **Needs:**
headless (#10), golden tests, review (#14).
**First customer to imagine:** the pricing owner at any B2B company.

---

## 16 — Engineering calculation sheets (the job Mathcad is dropping)

**The hand-rolled thing:** structural, mechanical, process, and electrical engineers do
design calculations — beam sizing, pressure drops, load ratings — in Excel or in
Mathcad, a decades-old tool that is expensive, dying slowly, and still beloved for one
reason: it understands **units**. Excel does not, and unit mistakes in engineering are
the famous catastrophic ones. These calc sheets also have to be *shown to someone* — a
reviewing engineer, a permit office — as a readable document.

**The Solenoid version:** this is the eeriest fit in the whole list, because the rare
ingredient **already exists**: Solenoid has a real unit system (`unitFlow.ts`, the
Convert node, `$`/`kg`/`%` as first-class), which almost no modern tool bothered to
build. Add the units-as-types upgrade from the directions doc (meters + seconds =
error *before* it runs) and the report projection (#13 — the calc sheet as a clean,
live, printable document with the assumptions and the math visible), and Solenoid is a
credible Mathcad successor with a modern engine underneath.

**Already in the codebase:** unit flow + Convert, the math/formula layer, KaTeX (real
equation rendering!), Notes. **Needs:** units-as-types, report projection (#13).
**First customer to imagine:** a structural engineer who has to hand a stamped calc
package to a reviewer.

---

## 17 — The commission engine: "why is my number this?"

**The hand-rolled thing:** sales compensation. Every company with a sales team runs
comp plans through horrifying spreadsheets maintained by one ter

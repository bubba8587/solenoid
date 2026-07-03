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

**VERDICT (author, 2026-07-02): IN — as a hook onto subgraphs (#5), not a standalone
container.** Comes after/alongside subgraphs: the Simulate affordance is a mode/capability
of the ONE subgraph container, so subgraphs keep a single consistent UI/UX (no second
container kind to learn). Sequencing: subgraphs (#5) first or together; the #1 design
deep-dive folds into / follows the #5 composites session. UI affordances expected easy
once the subgraph shell exists (play/step-count on the container).

**ADDENDUM (author, 2026-07-02): this is a PATTERN, not a one-off.** Simulation, the
SOLVER (goal-seek, #4), DATA TABLES (input-sweep grids, #4), SCENARIOS (#4), and
MONTE CARLO (#4) are ALL hooks onto the one subgraph container — "run this region N
times under a driver" with different drivers (time steps / a root-finder / a parameter
grid / named input sets / a distribution sampler). One container UI/UX, five run
modes. The #5 composites design session owns the shared shell + all five hooks.

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

**VERDICT (author, 2026-07-02): DEFERRED — "there are cons I can't articulate."**
Not ruled in or out; revisit at the end of the walk (with the parked pair). Presented
as two tiers (local Run panel; publish as local-first artifacts only — static export /
headless, no hosted infra, which would rub against the thread-#5 no-server identity).
The hesitation applies to the direction as a whole, so nothing starts.

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

**VERDICT (author, 2026-07-02): IN — tiers 1 and 2 only.** Tier 1: manual Refresh on
source nodes (re-pull + recompute; near-free, file/API flavors need nothing new).
Tier 2: interval refresh while the app is open. Tier 3 (always-on/background watching,
the daemon question) NOT taken — the #9 sinks + #3 scheduling design session scopes to
in-app interval scheduling, not background execution. The database-table source stays a
separable later slice behind Bet 5's "desktop points at a real database" form.

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

**VERDICT (author, 2026-07-02): IN — all of it joins the subgraph run-mode family
(see #1 addendum).** The container's driver set is now five: time steps (simulation),
parameter grid (data tables), root-finder (goal-seek/solver), named input sets
(scenarios), sampler over distributions (Monte Carlo). One container UI/UX. Scenarios
land early (no solver math, proves the shell); goal-seek scopes to numeric with loud
`#CONV!` failure; Monte Carlo's distribution-input design defers into the #21
uncertain-values session, the shell just anticipates it. #5's design session owns all
five modes.

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

**VERDICT (author, 2026-07-02): OUT as an ecosystem — subgraphs are part of the main
file; they're only addable via packs.** The scope jump this entry pitches (user-shared
building blocks, export/import, registry — tool → platform) is ruled out. What
survives is the CONTAINER: a document-local subgraph/composite (collapse a selection
into a node, typed boundary) — required anyway as the shell for the five run-mode
hooks (#1/#4 addendum) and the Expression cap's escape hatch. Distribution of
reusable blocks happens ONLY through the pack mechanism (pack-architecture.md): a
pack can ship subgraph-based nodes, a user's subgraph stays in their document. No
user-facing sharing layer, no block-versioning problem (packs own their own story).
The #5 design session scopes to: the local container + typed boundary + the five run
modes.

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

**VERDICT (author, 2026-07-02): DEFERRED — "I don't know if I like it."** Revisit at
the end of the walk with the other deferred/parked items (#2, golden tests,
data-drafts). Noted dependents if it stays out: strategy thread #3 (governance —
change control / sign-off) and thread #6 (trust badge) lose a leg; thread #4 linked
graphs loses pin-to-snapshot. Nothing builds now.

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

**VERDICT (author, 2026-07-02): ALL OUT — both halves.** Build-by-asking and
narrate-any-number (including the deterministic no-LLM narration variant) are out.
No prompt box, no NL layer in the product. Consistent with the thread-#5 ruling
(never advertise AI; AI stays an internal build-method). Round 1 closes: #1/#3/#4 IN,
#5 container-only, #2/#6 deferred, #7 out.

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

**VERDICT (author, 2026-07-02): IN — "in for sure."** Honest-70% strategy confirmed:
transpile the tractable core, fallback Expression node carrying the original formula
text for the rest (may be inert under the Expression cap — fine, Placeholder
philosophy). D10 holds: the transpiler REDIRECTS eliminated functions (VLOOKUP →
Frame Lookup etc.), never re-adds them. First step is the CLI-grade one-sheet spike.
Design deep-dive stays late in the queue (consumes Bet 3 + redirect decisions);
landing it also cheapens the parked data-drafts revisit (shared emit-nodes
machinery).

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

**VERDICT (author, 2026-07-02): IN, but KEEP VERY LIMITED.** Tier 1 only: file
writes (Write CSV/JSON), explicit manual trigger, preview-what-will-be-written,
disabled by default in imported graphs. Write-back-to-source OUT (revisit only if a
Bet-5 DB source ever lands). The "act" tier (webhooks/notify beyond the existing
in-app Alert HUD) OUT. The #9+#3 design session scopes to: manual-trigger file sinks
+ in-app interval refresh — no automation surface.

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

**VERDICT (author, 2026-07-02): IN.** The spike (`scripts/run-graph.ts`-style: load a
saved graph in Node, run the engine, print named outputs as JSON) needs neither Bet 2
nor Bet 3; the polished CLI (`--set` by stable name, typed args) rides them. Writes
only where explicitly told (`--out`) — same explicit-command discipline as #9. The
golden-tests revisit (end of walk) decides whether the CI-assertions half of the
story exists; headless-run is in regardless.

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

**VERDICT (author, 2026-07-03): DEFERRED — "I'd need more time worked with the area to
know what would feel good for this."** Revisit at the end of the walk with the other
deferred/parked items (#2, #6, golden tests, data-drafts). Nothing builds now.

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

**VERDICT (author, 2026-07-03): IN.**

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

**The Excel-familiar framing (author's point, 2026-07-02):** this is **Excel's Data
Validation, generalized.** Excel's version gates what a *human types into a cell*
(list/range/length rules at entry time); an Expect node applies the same idea to
*whatever flows through the graph* — imported files, computed columns, API pulls —
where no human typed anything. Pitch it exactly that way in the UI/docs ("Data
Validation for data you didn't type"): it makes the node instantly legible to the
Excel audience, and it slots into the Excel-parity story (`excel-toolbar-supplementals.md`
has a Data Validation verdict to reconcile with this).

**First step:** one Expect node with 4 checks (not-null / unique / range / regex),
pass-through output, red badge + alert on failure. It's a small node; the leverage is
in the pattern.

**Risk:** almost none technically. The design risk is nag-fatigue — keep expectations
strictly opt-in (user-placed nodes, not automatic warnings), consistent with the
no-Captain-Obvious rule.

---

## 13 — The report projection: one graph, a second face

**VERDICT (author, 2026-07-03): IN — but NOT "canvas Notes rendered in reading order."**
The Report is **one editable markdown file**, not a Note node and not built by stacking
existing Notes — it lives independently of the graph. It's blank by default (no
auto-population from pins/Notes/pinned values) and supports the same inline-ref span a
Note body does, so an author types prose and drops in live values directly. It can also
**embed** existing Note nodes (as a thing you place in it), but the file — not the Note —
is the report's unit. This supersedes the "Interpolating Notes ARE the report block
primitive" framing in step 3 of the design sketch below; steps 1–2 (the inline-ref
mechanism, the object socket category) stand as the underlying primitives the report
file reuses.

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

**First step (superseded 2026-07-03 — see VERDICT):** ~~a read-only "Report" tab that
renders the doc's pinned values and Note nodes top-to-bottom in reading order~~. Actual
first step: a blank, editable markdown document with the Note's inline-ref span working
standalone (no Note node required), plus the ability to embed an existing Note node in
it. Ugly is fine; live + editable is the point.

**Risk:** layout scope-creep toward "a document editor." The VERDICT already commits to
an editable file, so the line moves to: plain markdown source + inline refs + embeds —
no WYSIWYG toolbar, no block library beyond what markdown + embeds already give you.

**Design sketch (settled in discussion, 2026-07-02; step 3 corrected 2026-07-03): Note
interpolation + the "object" socket category.** The inline-ref mechanism started as a
Note-body idea and is now the report file's own primitive, in three steps:

1. **Note INPUT sockets via inline refs.** A Note body already turns frontmatter keys
   into typed OUTPUT sockets; the mirror image: an inline code span `` `=name` `` in
   the body mints an input socket named `name` (the ExpressionNode bare-name pattern),
   reconciled on blur like frontmatter. The span renders the connected value in place,
   through the same annotation resolver ValueDisplay uses, so an FC-locked value shows
   its unit/number format in the prose ($1,200.00, not 1200). A frame input renders as
   a compact table capped at preview size, never a full materialization.
2. **The "object" socket category (the Special family).** Category, NOT a single
   dataType: teal-green glyph-in-circle sockets, of which `lambda` (λ glyph) is
   already the first member. `chart` joins as the second (tiny chart glyph). Each
   member is its own dataType connecting only to itself + `any` (MAP's fn input must
   never accept a chart); the shared look says "special object, not data" in the
   legend. Members are scalar-only and ref-on-the-wire (the lazy FrameRef precedent:
   user-facing type + chip + popup preview, lightweight handle on the cable).
   **Explicitly excluded:** membership in frame/cube CELLS (no Polars dtype → parity
   break or eager-JS-only; lossy CSV round-trip; verbs/aggregators have no meaning
   over objects). The lattice edge set stays pinned by the socketConnect full-sweep
   test. Charts gain an object output; a lambda ref in a Note renders as KaTeX (the
   compiler already emits LaTeX per parse). "Charts inside cubes" is small-multiples
   in disguise; if wanted, build it as a chart mode.
3. **The report file is its own markdown document, not Notes-in-reading-order.**
   (Corrected 2026-07-03 — see VERDICT above; this step originally read "the Report
   tab consumes both" / "Interpolating Notes ARE the report block primitive," which is
   no longer the model.) It's a single editable file, separate from the graph's node
   set, blank until the author writes in it. It gets the inline-ref span (step 1)
   directly — no Note node needed to hold it — and can additionally embed a Note node
   as a placed object; an embedded chart still renders as a chip/placeholder in canvas
   Notes (the live chart is on the canvas beside it) but full-size in the report file.
   Step 1 stays nearly-free groundwork either way, since the span mechanism is shared.

---

## 14 — Node-anchored review: comments, questions, sign-off

**VERDICT (author, 2026-07-03): IN.** UX: right-click a node → "Add comment," and it
goes into a dedicated **comment pane**, the same pattern as the existing Alerts HUD
(`HudStack`) and pins (`PinLayer`) — a stacked list panel, not just a corner badge you
have to hover per-node to read.

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
save, added via a right-click "Add comment" and surfaced in a comment pane alongside
the existing Alerts/pins panels (a small corner indicator on the node itself is fine as
a pointer back, but the pane is where you read/manage them). Single-user it's already
useful as **"notes to self with an address"** — TODO markers that live on the logic
they're about.

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

**VERDICT (author, 2026-07-03): IN.**

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

---
---

# Round 4 — the value-model frontier and the compute substrate

A fourth pass, mining a different seam: Rounds 1–3 were about what a graph can become,
reach, and sell to. Round 4 is about **what a *value* can be** (three upgrades to the
value model itself) and **how compute behaves** (three substrate upgrades), plus three
smaller sharp tools. Several kill entire *classes* of spreadsheet error rather than
adding capability. Verified first: none of these exist in the code in any form.

---

## 20 — Named dimensions: values that know what their axes MEAN

**The problem it kills:** the single biggest silent-error class in spreadsheets is
**misalignment** — two ranges that are both "12 numbers" but one is Jan–Dec and the
other is Dec–Jan, or one is per-region and the other per-product. Excel adds them
happily. So does any positional list. The error is invisible because position carries
no meaning.

**The idea:** let a list/matrix carry **named, labeled axes** — this is `revenue` *by
region × month*, that is `cost` *by month*. Then arithmetic **aligns by label, not
position**: `revenue - cost` auto-broadcasts cost across regions and matches months *by
name*, and adding a per-region list to a per-product list is a loud `#DIM!` error
instead of a silent wrong answer. (For the technically inclined: this is xarray/pandas
index-alignment; commercially it's the core primitive Anaplan/TM1 sell for six figures.)

**Why Solenoid specifically:** this is the third leg of a stool the product already has
two legs of. The socket lattice types the *element* (number vs date); units type the
*meaning* ($ vs kg); dimensions would type the *shape's semantics* (by-month vs
by-region). All three are "make the wire carry more meaning so wrong wiring becomes
impossible" — the product's founding move, applied once more. The Cube handles *nested*
data; dimensions handle *aligned* data — adjacent, not overlapping.

**First step:** a labeled list (one dimension: labels riding the list, e.g. month
names), with element-wise ops aligning by label and mismatch → error. That alone kills
the offset-by-one-row bug. Matrices with two named axes come after.

**Risk:** this is a deep value-model change (the biggest in this doc) — sequence it
like the array-semantics build was done: policy decisions first, increments, a seed.

## 21 — Uncertain values: numbers with error bars that propagate

**The problem it kills:** every forecast, measurement, and estimate is a range
pretending to be a point. "Revenue will be 1.2M" hides "±0.3M", and by the time ten
such numbers multiply through a model, false precision has compounded invisibly.

**The idea:** a value kind `10 ± 2` (or `between 8 and 12`) that **propagates through
arithmetic** — sums add uncertainties correctly, products compound them — so the
output honestly reads `redacted 1.4M ± 0.5M`. Display stays clean (the ± renders like a
unit); any downstream consumer can ask for the interval. Monte Carlo (Round 1 #4) is
the *heavy* way to get this; interval/moment propagation is the *always-on lightweight*
way — and the two meet (an uncertain input is exactly what a Monte Carlo run samples).

**Why Solenoid specifically:** the value-kind machinery (null / error / logical as
distinct kinds riding one wire) is precisely the pattern — this is one more kind, with
`forAggregate`-style rules. Engineers (scope #15) treat uncertainty as a professional
requirement; finance folks know their forecasts lie. Nobody mainstream has this.

**First step:** an `uncertain number` scalar kind + the four arithmetic ops + display;
aggregators later. A "±" input on the Number node is the whole authoring UX.

## 22 — Time-aware data: as-of joins and effective dating

**The problem it kills:** "what was the price/FX-rate/headcount **on that date**" — the
question behind half of finance data pain. The lookup everyone needs is not exact-match
but **"the most recent value at or before this date"**, and doing it in Excel is a
sorted-VLOOKUP hack that breaks silently.

**The idea:** an **As-Of Lookup / As-Of Join** verb: join trades to the prices table by
nearest-preceding date. Plus its authoring twin: effective-dated tables (a `valid_from`
column treated meaningfully) so "the tax rate table" can hold history instead of being
overwritten each year.

**Why it's nearly free:** Polars ships `join_asof` natively — the desktop engine
already contains this feature; it's just not compiled in (the `asof_join` cargo feature
flag is one line) or exposed as a node. The JS oracle version is a sorted
binary-search — an afternoon. This is the highest capability-per-effort item in Round 4,
and it slots straight into the existing verb set + parity-test discipline.

**First step:** the flag + an As-Of Lookup node + oracle + one parity test + a
prices/trades seed.

## 23 — The persistent compute cache: never recompute what hasn't changed

**The problem:** close a heavy document, reopen it → everything recomputes. F9 on a big
model re-runs branches whose inputs haven't changed in weeks. CI (scope #10) re-runs
the whole graph every time.

**The idea:** because every node is pure, a result is fully determined by (node config +
input values). Hash that; **cache results on disk keyed by the hash** (the same trick
build systems like Bazel/ccache use — "incremental builds" for a model). Reopening a
document becomes instant (values load from cache; only genuinely-dirty cones compute).
Headless/CI runs of an unchanged model cost nothing. A year of sessions never
recomputes January's numbers again.

**Why Solenoid specifically:** purity is *the* precondition and it's already policed
(volatile nodes like RAND are already generation-gated — they'd simply opt out). The
targeted-recompute machinery already computes dirty cones; this extends "cached in this
pass" to "cached across sessions."

**First step:** hash-keyed disk cache for frame-verb outputs only (the expensive tier),
desktop-only, with a Settings toggle and a "computed vs cached" indicator.

**Risk:** cache-invalidation correctness (the classic). Contained by starting with the
verb tier, where inputs are already content-identified (the source-handle cache's
identity discipline), and by making the cache advisory — delete it and everything
still computes.

## 24 — Approximate-first: preview on a sample, exact on demand

**The problem:** on big tables, every edit pays full price even when you're just
sketching. The current answer is manual calc mode (all or nothing).

**The idea:** a third calc mode — **sketch mode**: while editing, verbs run on a
deterministic sample (say 10k rows) and results render with an "≈ approximate" badge;
F9 (already the "compute for real" gesture) runs exact. Instant feedback while
building, honesty about what's shown, full rigor on demand. The BI world calls this
approximate query processing; no spreadsheet-class tool has it.

**Why nearly free:** Polars samples cheaply; the calc-mode store, the F9 ritual, the
dirty-chip, and the `__totalRows` badge plumbing all exist. It's mostly a mode flag
through the backend seam + honest labeling.

**Risk:** approximate results being mistaken for real — the badge and the "exact on
F9" contract are the feature, not decoration. Aggregates like COUNT/SUM must scale up
from the sample *visibly* (`≈ 1.2M`), never silently.

## 25 — The graph profiler: a heatmap of where the time goes

**The problem:** "why is my model slow" currently requires the author opening a console
and reading `window.__solenoidStats()` tables — which already collect per-node call
counts and milliseconds (`perfProbe.ts`).

**The idea:** paint it on the canvas — a toggle that tints each node by its share of
last-pass compute time (the standard profiler-flamegraph move, but on the graph the
user already understands). The slow join glows; the cheap arithmetic fades. One glance
replaces a profiling session. Pairs naturally with #24 ("this is the node worth
sampling") and #23 ("this is the node worth caching").

**Why nearly free:** the data is *already collected per node id*. This is a render-mode
toggle + a color ramp + a legend. Probably the cheapest genuinely-new feature in all
four rounds.

## 26 — Synthetic data mode: share the shape, not the numbers

**The problem:** the moment models are shareable (seeds, review, the transpiler,
marketplace subgraphs), a wall appears: the *logic* is shareable but the *data* is
confidential. Today the answer is hand-scrubbing copies — tedious and error-prone
(and famously leaky).

**The idea:** **"Export with synthetic data"** — the graph ships with fake rows that
preserve each column's *statistical shape* (type, range, distribution, null rate,
cardinality) but none of its values. The model still runs, charts still look sensible,
the review/demo/bug-report works — and nothing confidential leaves the machine. The
schema-profiling needed (per-column type/range/distribution) is exactly what CSV import
inference already half-does.

**Who it unlocks:** consultants sharing deliverables, anyone filing a bug ("attach the
graph" becomes safe), the seed/marketplace economy (publish a template with plausible
demo data), and the governance story (share the model for validation without sharing
the book).

**First step:** per-type generators (numeric: min/max/mean-ish; strings: pattern-
preserving; dates: range) behind an export menu item. Fidelity can grow later.

## 27 — Data slots: one model, anyone's data

**The problem:** a graph hard-binds its data (pasted, imported, fetched). Sharing a
*model* — "here's my project-costing template, run it on YOUR numbers" — means the
recipient surgery-swaps source nodes by hand.

**The idea:** promote a source to a declared **slot**: a named, schema-typed opening
("expects: a table with columns date, amount, category"). Opening a document with
unfilled slots prompts: bind a file / paste / connect. The same model runs on anyone's
data; the slot's schema contract (Bet 3) validates the binding *loudly* on the way in
(with #12's expectations as the deeper check).

**Why it matters more than it looks:** it's the missing piece that makes several other
bets *distributable* — templates/seeds that are actually useful on your own data,
marketplace subgraphs (#5), the transpiler output ("this workbook, as a reusable
model"), the synthetic-data pairing (#26 fills slots with fake data by default). It's
the difference between sharing a *document* and shipping a *product*.

**First step:** a "Make this a slot" action on Frame Input / CSV nodes + a bind prompt
on open + schema check. The placeholder machinery is the pattern for "unfilled but not
broken."

## 28 — The formula lens: see any selection as an Excel formula

**The problem:** two audiences, one graph. Node-thinkers read the canvas; Excel-thinkers
read `=SUM(FILTER(...))`. Today Solenoid only speaks canvas.

**The idea:** select a run of scalar/list nodes → a panel shows **the equivalent Excel
formula**, live (`=IF(SUM(A)>tolerance, base*rate, base)`). It's a *lens*, not a mode —
read-only at first. It teaches Excel users the graph by translation, documents a
subgraph in one line, and gives reviewers a familiar cross-check ("does the formula
match the spec?"). Paste-a-formula-→-nodes already exists in spirit (the Expression
node parses formulas; the transpiler #8 industrializes it) — this is the *other
direction*, and together they make graph ↔ formula a two-way street.

**Why cheap:** the graph *is* an expression tree for scalar/list chains; emitting
formula text is a tree-walk using the same op↔function tables the parser and the
catalog's Excel-equivalents already maintain. Frames/verbs are out of scope for the
lens (they'd emit the Alteryx-style story instead — a verb pipeline description).

---

## Round 4, ranked

- **Do soon, nearly free:** #25 (profiler heatmap — the data already exists), #22
  (as-of join — one cargo flag + one node for a top-tier finance ask).
- **The strategic value-model bet:** #20 (named dimensions) — the biggest single
  error-class kill available, the third leg of the lattice+units stool, and the
  gateway to the planning/Anaplan territory. Treat it with array-semantics-level
  ceremony.
- **Distribution multipliers (pair them):** #27 (slots) + #26 (synthetic data) — 
  together they turn every shareable artifact from "my document" into "a model anyone
  can run safely."
- **Substrate when scale bites:** #23 (persistent cache) and #24 (sketch mode) — both
  ride the purity + calc-mode machinery; build when heavy-table sessions demand them.
- **The bilingual move:** #28 (formula lens) and #21 (uncertain values) — smaller, deep
  character: one meets Excel users in their language, the other makes honesty about
  precision a first-class value.

Thread back to the earlier rounds: #20/#21 extend the *wire* (what a value can mean),
#22 extends the *verbs*, #23/#24/#25 extend the *engine's manners*, #26/#27 extend the
*shareability* that Rounds 2–3 assume, and #28 extends the *audience*. Same product
thesis every time — make meaning explicit, make computation inspectable — pushed into
four new corners.

---
---

# Round 5 — the analyst's workbench, and the open ports

Fifth pass, two new seams. **Seam one: comprehension and hygiene** — Rounds 1–4 kept
making the graph more powerful; almost nothing yet helps someone *understand, clean,
and interrogate a graph that already exists* (the audit-your-own-model workflow —
which is also what reviewers, auditors, and future-you need). Because the graph is
pure and typed, it's *statically analyzable* in ways no spreadsheet is — mostly
unexploited so far. **Seam two: the ports** — how data and *agents* get in and out of
the file. Verified absent from the code first (Polars here is built with only
`lazy`+`strings` features; no MCP, no PDF, no graph-wide search exists).

---

## 29 — The model linter: static analysis for graphs

**The problem:** spreadsheets rot in known, nameable ways — and Excel can't name any
of them. A pure typed graph can. The classic smells, every one detectable statically:
- **Magic numbers** — an unlabeled constant buried inline (the hardcoded `1.07` that
  should be a named Input node; the #1 thing model auditors hunt).
- **Dead branches** — computed but feeding nothing (cost with no benefit, and a lie to
  the reader about what matters).
- **Duplicate logic** — two structurally-identical subtrees that will now drift apart
  (the copy-paste-then-diverge disease).
- **Unlabeled inputs / default titles** — the graph equivalent of `Sheet1!B14`.
- **Suspicious patterns** — a Cast doing nothing, a Filter filtering nothing, a unit
  conversion immediately undone.

**The idea:** a lint pass with a findings panel — click a finding, jump to the node,
one-click fix where mechanical ("promote to named Input"). Rules opt-in per document
(the no-nagging rule). It's `eslint`/`clippy` for models — a category no spreadsheet
tool can even attempt, because their "graph" is implicit.

**Why cheap:** every rule is a pure walk over editor state — no engine involvement.
The nontrivial one (duplicate subtrees) is standard tree-hashing.

**Enabled by:** the pure DAG (already), stable names (Bet 2 improves the messages),
and it *feeds* the trust badge (strategy #6) and governance story (a lint-clean model
is an auditable model).

## 30 — The Problems panel: every error in the doc, in one list

**The problem:** errors are first-class tagged values (`#DIV/0!`, `#SHAPE!`…) — but
finding them means *scrolling the canvas looking for red*. On a 200-node graph a
buried `#CIRC!` is a scavenger hunt.

**The idea:** the IDE move, verbatim: a panel listing every error value currently in
the graph — code, message, node, (for frames: cell) — click to jump-and-flash. Filter
by code. Badge count in the status bar. Combined with provenance (Bet 4), each entry
gains "…caused by [origin node]", making it triage rather than a list.

**Why nearly free:** every pass already touches every output value; collecting
`isSolError` hits into a store during the pass is a few lines, and the
jump-to-node/flash gesture exists (the navigator does it). Probably ships in a day,
and it changes the *feel* of debugging a big model completely.

## 31 — Where-used: query the graph like a codebase

**The problem:** "what happens if I change this?" — the question before every edit —
has no answer surface. Excel's trace-precedents is one-hop arrows on one cell.
Refactoring-grade questions are unanswerable: *everything downstream of this input;
every node that touches column `region`; everywhere this unit appears; every use of
XLOOKUP.*

**The idea:** a query box over the graph (the navigator is the natural home):
`uses:XLOOKUP`, `col:region`, `downstream:FX Rate`, `unit:$`, `errors`, `unlabeled` —
results as a clickable list *plus* canvas dim-and-highlight of the matching set. The
same primitive powers "select the cone" (then group/isolate/tidy it) — query becomes
selection becomes action.

**Why Solenoid can and Excel can't:** the dependency structure is explicit and typed;
`downstream:` is a BFS the engine already knows how to do (`downstreamClosure` exists
in `process.ts` — this is a UI over it). Column-level queries get exact with schema
inference (Bet 3) but a duck-typed version works today.

## 32 — The Reconcile node: explain the difference between two tables

**The problem:** the most universal analyst ritual that has no tool: two versions of
"the same" numbers — last month vs this month, source system vs report, my total vs
yours — and hours of manual VLOOKUP archaeology to answer *what changed and why*.
This was flagged in the Round-3 research as a hand-rolled-everywhere workflow and
never written up; here it is.

**The idea:** a two-input verb node: match rows by key, then classify — **added /
removed / changed** (with per-column deltas) — and, the analyst-gold layer, a
**contribution breakdown**: "total moved +230k: +180k from rows added, −40k from rows
removed, +90k from price changes on matched rows, offset −0k mix." (That
price/volume/mix decomposition is a bounded, well-known bit of arithmetic, not magic.)
Output is a frame (feeds charts, expectations, alerts) plus a readable summary.

**Enabled by:** the join machinery (shipped), snapshots (#6 — "reconcile against Q2
close" without keeping two files), provenance (Bet 4 — *within* one model, "explain
this cell's change" is the graph-walk cousin of this node, which handles the
*between-datasets* case the graph can't see).

**Why it matters strategically:** it's the single most demo-able node for the finance
audience (month-end close is a universal wound), and it upgrades the governance
vertical from "controls" to "the tool that does the actual work."

## 33 — Paste anything: the intake for trapped data

**The problem:** an enormous share of real data is *trapped* — in PDFs (bank
statements, supplier price lists, government tables), in screenshots, in HTML meant
for eyes. The current answer everywhere is retyping, the highest-error-rate activity
in the entire data lifecycle.

**The idea:** make Solenoid's paste/drop the best in the industry, tiered by
confidence: (1) HTML table paste → frame (parsing fidelity: merged cells, footnote
junk, thousands separators); (2) **PDF table extraction** on the desktop build (mature
Rust crates exist; ship it local, no cloud); (3) screenshot → table via OCR as the
ambitious tier. Every import lands as a *frame plus a provenance stamp* ("extracted
from page 3 of X.pdf") and — the honest part — **low-confidence cells flagged** for
human review (expectations, #12, as the systematic check). Extraction that admits
uncertainty instead of silently guessing: the trust thesis applied at the front door.

**Why here:** the intake side has quietly become the bottleneck around everything else
(slots #27, transpiler #8, live data #3 all assume the data *arrives*). Nobody in the
spreadsheet class does PDF ingestion natively; analysts pay for standalone tools
(Tabula, cloud OCR) that then export… a CSV they import by hand.

## 34 — Parquet & Arrow: speak the data world's native tongue

**The problem:** CSV is the only bulk format in or out. The modern data stack —
warehouses, lakes, Python/R, DuckDB — speaks **Parquet** (columnar, typed, compressed,
fast) and Arrow.

**The idea:** read/write Parquet as a source and (with #9's sinks) an output. On
desktop this is *almost free*: Polars reads Parquet natively — it's a cargo feature
flag away (verified: current build compiles only `lazy` + `strings`), and it lands as
a **direct file→engine path that never materializes in JS**, which is exactly the
"direct CSV→Polars reader" scale step the backlog already wants, delivered for a
better format first. Typed columns also mean no inference step: dtypes arrive intact.

**Why it matters beyond convenience:** it's the handshake with every data engineer's
world — Solenoid stops being an island that ingests exports and becomes a peer that
reads the lake's files. Small feature, disproportionate legitimacy.

## 35 — The MCP port: let any AI agent drive Solenoid properly

**The problem/opportunity:** the AI-native thesis (#7, #19, and the meta-story) keeps
assuming an AI can *work with* a Solenoid document. Today the only interface is "edit
the JSON blob and hope." Meanwhile the industry converged on **MCP (Model Context
Protocol)** as the standard socket for tools exposing capabilities to agents — and the
author already drives this project with Claude daily.

**The idea:** desktop Solenoid runs a local MCP server exposing the document as typed
tools: *read the graph structure; get a node's value/schema; set an input; run and
report (with errors); search (the #31 query engine); apply a validated edit
(addressable model, Bet 2); run the linter (#29).* Suddenly *any* agent — Claude Code,
a custom workflow, someone's internal bot — can inspect, run, and carefully edit a
model with **typed, validated, undoable operations instead of blob surgery**. The AI
cage (#19) stops being a vision and becomes a socket: the agent proposes through the
same governed interface a human's edit goes through.

**Why now and why credible:** the protocol is established; the substrate (typed
sockets, pure engine, headless core) is precisely what makes the tool surface *safe*
to expose; and the first user (the author + Claude) is already in the building. This
is the single most direct way to operationalize "the first spreadsheet designed to be
co-authored with an AI."

**First step:** read-only MCP (structure, values, run, search) — genuinely useful
alone ("ask Claude about my live model") and zero write-risk. Writes follow Bet 2.

## 36 — Guided seeds: the tutorial that is a document

**The problem:** the zero-learning-curve principle has tooltips, a legend, and a
reference overlay — all *reactive*. Nothing *teaches*. A new user opens
`getting-started` and reads a finished graph — dissection, not construction.

**The idea:** let a seed carry an optional **step script**: each step highlights a
region, says one sentence, and waits for the user's action ("wire the price into the
multiplier — notice the socket shapes match") with the canvas dimmed except the
relevant bits. Tutorials-as-documents: authored like seeds, tested like seeds
(CI-checked, per strategy thread #1), shipped in the template gallery ("Learn:
Frames in 5 minutes"). Later, the same mechanism is a *walkthrough recorder* for any
model — "explain this document to the next person, step by step" — which quietly makes
it a documentation feature, not just onboarding.

**Why cheap-ish:** highlight/dim machinery exists (isolate, load-reveal, navigator
flash); a step script is a small JSON list riding the seed format; the placeholder
discipline handles versioning.

---

## Round 5, ranked

- **Ships in days, changes the daily feel:** #30 (Problems panel — the errors are
  already tagged; go get them), #34 (Parquet — one feature flag, big legitimacy).
- **The workbench trio (build toward the governance/audit story):** #29 (linter) +
  #31 (where-used) + #32 (Reconcile). Together they're "the model you can interrogate"
  made concrete — and #32 is the sharpest finance demo in any round.
- **The strategic port:** #35 (MCP) — small first slice, and it converts the AI-native
  identity from narrative into an actual socket other agents can plug into. Do
  read-only early; it compounds with everything Bet 2 unlocks.
- **The wide funnel:** #33 (paste anything / PDF) — highest effort here, highest reach:
  it feeds every other feature by getting trapped data into the graph at all.
- **The welcome mat:** #36 (guided seeds) — matters the day strangers arrive; build
  the step-script rider when the seed/marketing motion (strategy #1) spins up.

Seam summary: Rounds 1–4 made the graph *capable*; Round 5 makes it **legible under
interrogation** (lint, problems, where-used, reconcile) and **connected at the edges**
(PDF in, Parquet out, agents through MCP, newcomers through guided seeds). The
workbench items are also the first features whose primary audience is *someone
examining a model they didn't build* — which is exactly who the trust thesis was for
all along.

---

# Round 6 — the feel: what the tool is like under your hands

Six items about *ergonomics and perception* — none add computing power; all change how
fast and how pleasant it is to build and read. This seam matters because the honest
competition isn't a product, it's **Excel's muscle memory**: people stay where their
hands are fast. Verified absent first (cable-drop-on-canvas currently just clears the
drag flag; no palette; no scrubbing; no zoom LOD beyond image sharpness).

## 37 — Quick-wire: drop a cable on empty canvas, get the next node
Drag a cable off an output, release on empty canvas → the Add menu opens *right there*,
**filtered to nodes that accept that type**, and the pick lands pre-wired. The single
biggest speed habit in every mature node tool (Blender, Unreal do exactly this): building
becomes "pull, type two letters, enter" instead of "add, position, aim at a socket." The
connection plugin already reports the drop and the socket's type (`Canvas.tsx:2110`, today
just resetting the drag flag); the menu and auto-wire are the work. **Highest
ergonomics-per-effort item in the series.**

## 38 — The command palette (Ctrl+K)
One box for everything: add a node, run a command (tidy, calculate, snapshot), open a
document, jump to a node by name, toggle a setting — each showing its shortcut inline so
it *teaches* the keyboard as you use it. Modern-software table stakes; the Add menu's
fuzzy scoring already powers the node half. Also the accessibility spine (everything
keyboard-reachable) and the natural host for future actions (lint, queries, reconcile,
and eventually "build by asking", #7) without new chrome.

## 39 — Scrubbing: drag any number, watch the model move
Click-drag horizontally on any numeric literal to sweep its value with the graph updating
live — the targeted-recompute path (2026-07) makes it cheap; it's the machinery a slider
drag already uses. The classic "explorable" gesture: it turns a model into an instrument
you *play* to build intuition, and it's the lightweight interactive cousin of what-if (#4).
Modifier keys for step size; Escape reverts (the draft-commit contract extended to a drag).

## 40 — Semantic zoom: the graph reads at every altitude
Today, zoomed out = the same cards, smaller. The information should *change* with altitude:
far out, a node becomes a colored block with a big label (name + value), groups become
titled regions, cables thicken into flows; closer in, detail returns. The HTML-canvas
renderer's mip pyramid already handles *image* sharpness per zoom (`htmlCanvasRenderer.ts`
reports LOD as a stat) — this swaps in a *simpler card* at low detail rather than a smaller
picture of the full one. The payoff: a 300-node model reads as a map from orbit, which is
how you present one to a human. The direct answer to the "spaghetti" objection.

## 41 — Conditional formatting for tables
Data bars, color scales, threshold icons in frame views (popup grid + column chips),
driven by rules or by an expectation's pass/fail (#12). Straight Excel parity (one of its
most-used features, currently absent) *and* the perception layer for big frames: a 50k-row
table you can't read becomes a heat pattern you can. Respects the design system's
quiet-accent rule (fills within the grid cells, not decorative chrome).

## 42 — The history scrubber
Undo exists; *seeing* is better. A timeline strip you drag to slide the document back and
forth through this session's states, watching the canvas change, then release to land (or
Escape back to now). Turns "wait, what did I just break?" into a five-second visual answer
instead of blind Ctrl+Z roulette. Rides the existing history plugin; snapshots (#6) stay
the *cross-session* value history — this is the *within-session* structural one.

**Round 6 order:** #37 first (changes every minute of building), #38 second (a home for
everything else), then #39/#41 (the two "the model becomes visible" gestures), #40 when
the canvas renderer is next touched, #42 opportunistically.

---
---

# Round 7 — exact numbers, and the file that travels alone

Two seams. **Exactness:** a calculation tool's numbers should be *right*, and two classes
of numeric wrongness remain — floating-point money, and models never probed beyond
happy-path inputs. **The traveling file:** several features assume a *person* receives the
model; these let the file travel without Solenoid installed, without the author present,
and at library scale.

## 43 — Money mode: exact decimal arithmetic
`0.1 + 0.2 ≠ 0.3` in floating point, and every accountant has met the spreadsheet where
the pennies don't foot. A per-document (or per-unit: anything tagged `$`) **decimal mode**,
with an explicit **rounding policy** (half-up vs banker's — an accounting requirement,
currently an accident of the CPU). Polars has a decimal dtype (not compiled in — the same
one-flag story as Parquet); the JS side needs a decimal path for scalar money math, which
is the real cost. Scope it honestly: money first, not general arbitrary precision. One
sentence: **"the spreadsheet where the cents always foot."**

## 44 — Model fuzzing: property-based testing for graphs
Golden tests check inputs you thought of; fuzzing checks the ones you didn't. Because every
input socket is *typed* (and ranged, once slots/expectations declare bounds), Solenoid can
**generate hundreds of valid-shaped inputs automatically** and hunt for what breaks —
errors, NaN/Infinity leaks, `#SHAPE!` explosions, outputs that violate an expectation.
"Probe my model" as a button. This is property-based testing (QuickCheck), which
transformed software correctness, applied to models — possible *only* because the graph is
pure and typed, and unheard-of in the spreadsheet world. Findings land in the Problems
panel (#30).

## 45 — Tornado ranking: which inputs actually matter
One click on an output: Solenoid perturbs each upstream input (±10% or its declared range),
ranks them by impact, and draws the classic **tornado chart** — "your answer is 80% driven
by these two assumptions; the other twelve are noise." The universal first question about
any model, today answered by hand-built sensitivity tables. Rides the run-the-graph-N-times
machinery of what-if (#4); the Sensitivity node is its seed, generalized to *automatic,
all-inputs, ranked.*

## 46 — Sealed models: tamper-evident sign-off
Hash the canonical form of the document (Bet 2's stable text form is the right input) and
let a reviewer **seal** it: "reviewed by K, 2026-07-02, hash `ab12…`." A later edit visibly
breaks the seal — it doesn't *prevent* edits, it makes them *evident*, which is what
governance actually requires. Cheap once the canonical form exists, and it completes the
review story (#14) + trust badge (strategy #6): *tested, validated, reviewed — and sealed.*

## 47 — Static HTML export: share without a server
"Export as webpage" → **one self-contained `.html` file**: the report view (#13), key
charts, pinned values, an image of the canvas — frozen at export time, viewable by anyone
with a browser, hosted nowhere or anywhere (email it, drop it in Slack, put it on an
intranet). The local-first answer to "just send me something I can open" — sharing as an
*artifact*, not a service — and the zero-infrastructure cousin of publish (#2). (The
interactive published form stays a separate, later thing; this is deliberately frozen.)

## 48 — The library layer: your documents as a fleet
Everything so far treats one document. At 30 documents, new questions appear that nothing
answers: *which docs use this CSV / this node type / this unit? Which have errors right
now? Which haven't recalculated since their source changed?* A library view: cross-document
search (the #31 query engine pointed at all docs — they already live in one store) and a
health dashboard (per doc: error count, last calculated, size, seal/badge state). Also the
natural home for linked-graph management (strategy #4) when it lands, and for batch
operations (run-all via headless #10, revalidate-all via #12/#29, made cheap by the
persistent cache #23).

## 49 — The session journal: the model's changelog writes itself
The history plugin already knows everything that happened; distill it. At session end (or
on demand), a dated, human-readable digest — "changed FX assumption 1.08→1.11; added a
Reconcile branch; renamed 3 nodes" — attached to the document. The provenance story at
*session* granularity: the memory-jogger for future-you, the raw material a review (#14) or
a commit message wants. Pairs with NL narration (#7) for prose polish, but the mechanical
version is valuable on its own.

**Round 7 order:** #45 and #44 ride the what-if/typed-graph machinery (do with #4); #47 and
#49 are small and immediately shareable; #43 (money) is a real numeric-substrate project;
#46 waits on the canonical form (Bet 2); #48 is the org-scale hub the next round builds on.

---
---

# Round 8 — telling the story, and the estate

Last planned seam(s): **presentation** (a model is almost always shown to more people than
built it — that audience is underserved by an editing canvas) and **the estate** (a person
or team accumulates *dozens* of models, and today they're loose files with no shared
definitions, no overview, no relationships). Plus the last two authoring conveniences and
one salvaged idea. Verified absent first.

## 50 — Auto-documentation: the graph explains itself in prose
Generate a readable description of a graph (or selection): "Takes 3 inputs (loan amount,
rate, term), computes a monthly payment via an amortization formula, outputs a schedule and
total interest." The narrate-a-number idea (#7) lifted to *narrate-a-model* — a walk over
structure + the catalog's node descriptions, rendered as prose (templated locally; no cloud
for the basic version). Feeds the report projection (#13), guided seeds (#36), the
governance docs (strategy #3), and MCP (#35 — an agent asking "what is this?"). The cheapest
path to a model that documents itself.

## 51 — Presenter mode: saved views you step through like slides
Explaining a model live (to a client, a class, a board) today means awkwardly panning an
editing canvas. Saved **views** — named camera position + zoom + highlighted region — that
you step through: "inputs → core calc → result", each a smooth camera move with the rest
dimmed. It's isolate + pins + the load-reveal's camera choreography, repurposed from
*loading* to *presenting*. The report projection (#13) is the document face; this is the
*canvas* face for a live walkthrough — and it makes the graph itself demo-able instead of
something you apologize for on a call.

## 52 — Branded output: the deliverable looks like theirs, not ours
The moment outputs are shared (reports #13, forms #2, static HTML #47), they carry
Solenoid's look, not the user's. Document-level theming for the *output* surfaces only —
logo, color, font on reports and published artifacts (never the editing canvas, which keeps
the tuned design system). Small, but it's the line between "a tool's output" and "my
deliverable", and it directly serves the consultant/analyst audience the strategy docs
flagged. The per-doc palette already persists; this scopes a brand override to the
presentation projections.

## 53 — Shared definitions: define once, use everywhere
The same constants and mini-models get re-created in every document — the discount rate,
the fiscal calendar, the region→territory map, the standard unit set — and they drift
("which rate did *that* model use?"). A **shared library** a document references: canonical
constants, named mappings, reusable subgraphs (#5), unit definitions. Update the rate once;
every referencing model recomputes correctly (and, with snapshots #6, can pin "as of"). The
DRY principle for an analytics estate — linked graphs (strategy #4) pointed at a designated
"definitions" document, plus the schema contract (Bet 3) so a reference is typed and a break
is loud.

## 54 — Model index: an overview of everything you've built
Past a dozen documents there's no map — no "what models do I have, what do they depend on,
which touch this source, which are unreviewed." This is exactly the **model inventory**
governance regimes require and firms build by hand in a tracking spreadsheet (irony noted).
A home view: every document with metadata Solenoid already knows (inputs/outputs, sources
touched, last edited), its health (trust badge #6) and review state (#14), and — with
linked graphs (strategy #4) — a **dependency map across documents** ("if the FX-rates model
changes, these 6 are affected"). The estate as a graph of graphs; the literal deliverable
the governance vertical sells; the home for the fleet operations in #48.

## 55 — Templates, structured: the whole-model sharing economy
Seeds (strategy #1) are *our* examples; there's no path for a user to save "my
project-costing model" as a reusable, parameterized template. Promote any document to a
**template**: slots (#27) mark where data plugs in, synthetic data (#26) fills them for
preview, an auto-drafted description (#50) and guided steps (#36) explain it. Personal →
team → (someday) public gallery. The subgraph/marketplace idea (#5) is the *component*
economy; this is the *whole-model* economy — both on the same seed+slot+schema machinery.

## 56 — The commission engine (salvaged): "why is my number this?"
*(Rescued from an earlier orphaned Round-3 draft — a concrete vertical worth keeping.)*
Sales compensation runs through horrifying spreadsheets one analyst maintains and no rep
trusts; every "why is my commission this?" is an argument nobody can resolve because the
calc is opaque and unauditable. It's the Round-3 pattern (business-critical, too-fluid-for-
code logic) with a twist: the payout is a **provenance** story per rep. A comp plan as a
graph — tiers, accelerators, clawbacks as nodes — gives every rep a traceable "here's
exactly how your number was built" (Bet 4), the plan owner what-if on next quarter's tiers
(#4), and finance an auditable, snapshot-versioned plan of record (#6). Same enabling
pieces as the rules engine (Round 3 #18) + provenance; a sharp, universally-hated wound.

## 57 — Smart paste + multi-node operations
Two authoring conveniences. (a) Paste clipboard tab/comma data *anywhere* on canvas → a
Frame Input pre-filled (the "just paste the damn table" path Excel users reflexively
expect; CSV parsing already exists to reuse). (b) **Operations over a selection** —
align/distribute (visual tidiness short of full Tidy), extract-to-group, wrap-in-subgraph
(#5's authoring gesture), collapse-these — the graph equivalent of a shape-editing toolbar,
exposing operations the group/collapse/selection primitives already support.

**Round 8 order:** #50 (auto-doc — feeds four other things), #57 (cheap daily convenience),
#51/#52 (presentation, when the report/publish work is live); the estate arc #53→#54→#55
is gated on linked graphs (strategy #4) + schema (Bet 3) and is what the governance vertical
actually *sells*, so it's the commercial spine even though it's furthest out; #56 whenever
the sales-comp wound is the one worth demoing.

---
---

# Round 9 — the social layer (the speculative finale)

The last seam, and the most speculative by design: **what happens when models are made,
shared, and relied on by people who don't know each other.** Everything before this
round works with zero community; everything in it assumes one exists (or is the reason
one forms). The honest gate on all of it: Bet 2 (the addressable/text model) plus real
users. Filed now anyway, because two of these turn out to be *near-term and standalone*
(#60, and the mechanical half of #58) — and because the shape of the social layer should
inform how the earlier pieces (seals, templates, badges) get built.

The organizing observation: every sharing economy for *work products* (npm, app stores,
template galleries) has the same disease — **you can't tell good from plausible from the
listing.** Stars measure popularity; descriptions measure marketing. But a Solenoid
model is the rare artifact whose quality is *mechanically checkable* — tested, linted,
fuzzed, sealed, schema-typed. A sharing layer built on that is categorically different
from one built on reviews.

## 58 — Verified templates: quality gates instead of star ratings

**The idea:** when a template (#55) or subgraph (#5) is shared, its listing carries
**mechanical credentials, not vibes**: golden-test coverage (do pinned examples exist
and pass?), lint-clean (#29), fuzz-survival (#44 — "10,000 generated inputs, zero
uncaught errors"), expectation coverage (#12), a seal (#46) with author identity. The
gallery *runs the checks* — they're headless (#10) and cheap (cached, #23) — so the
badge row on a listing is computed, not claimed.

**Why it could matter beyond the gallery:** it inverts the trust problem every
marketplace has. "This mortgage calculator passed 10,000 fuzz cases and its examples
match published IRS tables" is a different object from a 4.5-star spreadsheet template.
If Solenoid ever has a commons, this is what makes it *worth* using over a random
download — and the checking machinery is all pre-social (Rounds 5–7); the social layer
just displays it. **The mechanical half is near-term:** the badge row is worth
rendering on local/team templates long before any public gallery exists.

## 59 — Fork lineage: models that remember where they came from

**The idea:** copying/adapting a shared template records **lineage** — "derived from
Amortization v3 by K" — and the schema contract (Bet 3) plays the role version numbers
play in package managers: an upstream update that keeps the contract can be offered as
a safe pull ("v3.1 fixes the leap-year bug — apply?"); one that breaks it is flagged as
a major change. Attribution for authors; bug-fix flow for users; and the diff machinery
(#6, Bet 2) shows exactly what changed before you accept.

**Why it's plausible here when it's hard elsewhere:** "did the update break my usage?"
is *undecidable* for arbitrary code but largely *checkable* for a typed graph — the
contract + your own golden tests answer it mechanically. This is the package-manager
update problem with the hardest part removed.

## 60 — Citations: every formula carries its source ← pull this one forward

**The idea (near-term, standalone, cheap):** a `source` field on any node or constant —
"per IRS Pub 946 Table A-1", "ASHRAE Fundamentals 2021 §26.1", "company pricing policy
v4, 2026-03" — rendered as a superscript on the card, footnotes in the report
projection (#13), and a references section in auto-docs (#50). The linter (#29) can
optionally demand sources on named constants.

**Why it punches above its weight:** "where does this number come from?" is THE audit
question, and today the answer lives in someone's memory. For the engineering vertical
(#15) citations are professionally mandatory (calc packages must reference code
editions); for finance/governance (#3) they're what a validator checks first; for the
commons (#58) they're what makes a shared model *checkable against the authority it
claims*. It's a metadata field + three render sites — buildable this quarter, valuable
with zero community, and it quietly upgrades every trust feature around it.

## 61 — Numbers with receipts: published figures that link to their model

**The idea:** any figure in an exported artifact (report #13, static HTML #47) can carry
a **verify link**: it opens the sealed (#46), synthetic-or-real-data (#26) model that
produced it — inspectable, re-runnable, diff-able against the seal. A blog post's "$47B
market by 2030" or a council report's traffic projection stops being a naked assertion
and becomes a claim with its working attached.

**Why it's the thesis at maximum altitude:** the whole product is "never trust a number
you can't inspect"; this exports that norm beyond the tool. Speculative — it needs
publishers to care — but note it's *pure composition*: seal + synthetic data + static
export + (optionally) the web viewer. If those ship for their own reasons, "receipts"
costs almost nothing and is the most culturally interesting demo Solenoid could run
(publish an analysis where every number is clickable-to-verify, and dare the industry
to match it).

## 62 — The validator economy: third parties who sign models for a living

**The idea:** model validation is *already a paid profession* (banks are required to
buy it; engineering has stamped reviews; audits exist). Today validators receive an
Excel file and produce… a Word document about it. Sealed models (#46) give them a
**durable, machine-checkable artifact to sign**: "validated by [firm], against snapshot
S, seal hash H" — and the seal-break mechanics mean their signature *provably* refers
to exactly what they reviewed, which is more than the Word-document status quo can say.

**Why it's strategically interesting:** it's a *business ecosystem* Solenoid enables
without operating — no marketplace to run, no service to host (the signature is data in
the file, consistent with local-first). Validators become a channel: firms that sell
sign-offs have every incentive to prefer — and recommend — the format that makes their
product verifiable. Gated on the governance vertical (#3) landing first.

## 63 — Standards as software: institutions publishing executable packs

**The idea (the far end):** standards bodies and authorities — building codes, actuarial
tables, tax schedules, engineering societies — currently publish their tables and
formulas as **PDFs**, which ten thousand practitioners each hand-transcribe into ten
thousand slightly-wrong spreadsheets. The pack system (#strategy 2) + seals (#46) +
citations (#60) describe something strictly better: the institution publishes the
**executable, versioned, signed pack** — the IRS depreciation tables, the ASHRAE loads,
the actuarial mortality tables — and practitioners *reference* rather than retype.
Fork lineage (#59) handles editions; the schema contract handles "the 2027 revision
renamed a column."

**Honest odds:** institutions move glacially; this is a decade-scale thought. But it's
the logical terminus of the whole series — the point where "the inspectable computation
layer" stops being a product category and becomes infrastructure — and *one* motivated
body (a single state's energy-code calculator, one professional society's toolkit) would
be enough to prove the pattern. The demo version needs no institution at all: Solenoid
ships an unofficial-but-cited (#60) pack of one such table set and shows the delta
against the retype-it-yourself world.

**Round 9 order:** #60 now (it's a Round-5-grade feature hiding in the social round);
the mechanical badge row of #58 alongside the trust badge (strategy #6); everything else
waits for Bet 2 + actual users — but build seals/templates/exports with these shapes in
mind so the social layer composes instead of retrofitting.

---

## Seam map — the whole territory in one place

Nine rounds, one lens. Every item is one of two moves — *make meaning explicit* or *make
computation inspectable* — applied to a different face of the product:

- **What a value is** — R4 (#20 dimensions, #21 uncertainty), R7 (#43 exact money)
- **What the graph computes** — R1 (verbs, simulation, what-if), R4 (#22 temporal)
- **How compute behaves** — R4 (#23 cache, #24 sketch), R5 substrate, R7 (#44 fuzzing,
  #45 tornado)
- **How you build it** — R6 (#37 quick-wire, #38 palette, #39 scrub), R8 (#57 paste/multi)
- **How you read it** — R5 (#29 lint, #30 problems, #31 where-used), R6 (#40 semantic zoom,
  #41 conditional format, #42 history scrub), R8 (#50 auto-doc)
- **How data gets in/out** — R2 (#9 sinks), R5 (#33 PDF, #34 Parquet), R7 (#47 static HTML)
- **How it reaches people** — R2 (#2 publish, #13 report), R3 (verticals), R7 (#46 sealed),
  R8 (#51 presenter, #52 brand)
- **How agents reach it** — R5 (#35 MCP), R2/R3 (#19 AI cage)
- **How it scales across many** — R7 (#48 library), R8 (#53 definitions, #54 index, #55
  templates), strategy #4 (linked graphs)
- **How strangers trust each other's work** — R9 (#58 verified templates, #59 lineage,
  #60 citations, #61 receipts, #62 validators, #63 standards-as-software)

The coherence check: if a proposed feature can't be phrased as one of those two moves, it's
probably in the out-of-scope pile.

---

## Appendix — the "recreate and undercut" demo target: Alteryx Designer

Asked directly (2026-07-02): *which existing software could Solenoid recreate as a
demo and undercut?* The answer, by a wide margin: **Alteryx Designer** —
**$5,195/user/year list** (2026 pricing; certifications run another $800–2,500/head).

Why it's the right target and not just an expensive one:
- **It's the same paradigm.** Alteryx Designer IS a node canvas of data verbs —
  input → filter → join → group → output. A demo isn't an analogy; it's node-for-node
  the same picture.
- **Solenoid can run ~90% of the classic demo TODAY.** The standard Alteryx showcase
  (pull two CSVs, clean a column, join, filter, group-summarize, chart it) maps
  directly onto the shipped verb set (Filter/Join/Group By/Split Column/Sort/Distinct/
  Pivot) + CSV import + chart nodes — with native Polars underneath, which is a *faster
  engine* than Alteryx's on typical workloads. The only missing piece for full parity
  is a Write-CSV sink (Round 2 #9's first slice, deliberately its cheapest item).
- **The undercut is absurd and honest.** The demo sentence writes itself: *"this is a
  $5,195/year workflow, running free, in a tool that also does the rest of your math."*
- **Build shape:** a seed document that mirrors one of Alteryx's own tutorial
  workflows on bundled sample CSVs, plus a short side-by-side writeup. Ship the
  Write-CSV node with it and the parity is total.

Runner-up targets, keyed to when their enabling feature lands: **Oracle Crystal Ball /
@RISK** (~$1,000–2,000/seat Monte-Carlo Excel add-ins) once what-if (#4) exists;
**PTC Mathcad** (engineering calc, subscription) once units-as-types + the report view
land (#15); **Stella/Vensim** (system dynamics, ~$2–3k/seat) once simulation mode (#1)
exists. Same play each time: their whole product is one Solenoid feature with a
five-figure price tag.

---

The meta-pattern across every round: **so much of software is secretly a typed,
inspectable graph of computations that somebody had to build by hand, badly, because no
tool *was* one.** Engineering calcs, cost roll-ups, decision models, rules engines,
commission plans, AI analysis — each is a market full of people re-implementing a worse
version of what Solenoid is natively. The good-to-great arc isn't adding features until
it's a better spreadsheet; it's realizing the graph is a general substrate and pointing it,
one credible vertical at a time, at the people already suffering without it. Start where
the architecture already leans (units → engineering, Cube → costing, Decision Matrix →
decisions), earn the right to the harder ones (rules engine, AI cage) with the trust
machinery, and let the identity grow from "spreadsheet, done right" into "**the
inspectable computation layer**" underneath a dozen jobs people currently hate doing.

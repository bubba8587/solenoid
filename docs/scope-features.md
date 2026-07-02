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

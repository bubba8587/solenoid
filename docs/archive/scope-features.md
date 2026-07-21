# Solenoid — Scope-expanding features (verdict index)

The full 63-item "good → great" feature walk (2026-07-02/03, every item pitched then
given an author VERDICT) is condensed here to a **verdict index** so every
`scope-features #NN` citation in `docs/v2.0/*.md` and `docs/out-of-scope.md` still
resolves. The IN items became the `docs/v2.0/` bundle set and shipped through 1.1; the
full per-item write-ups are in git history. Two deferred sketches are kept in full below
(#23 persistent compute cache, #35 MCP port) plus the Alteryx demo-target teardown that
`out-of-scope.md` cites.

## The 63 items — title · verdict · where it landed
1. Simulation mode (feedback loops + time) — **IN** (as a hook onto subgraphs #5) — shipped: composite Simulation run-mode.
2. Ship any graph as a tool (form/API/mini-app) — **DEFERRED** ("cons I can't articulate").
3. Live data (open → a surface that watches) — **IN**, tiers 1–2 (manual Refresh + interval) — shipped: Data Feed + connection auto-refresh.
4. What-if (scenarios / goal-seek / any-cell-the-unknown) — **IN**, joins the subgraph run-mode family — shipped: Goal Seek / Scenarios / Data Table.
5. Subgraphs as shareable typed functions — **OUT as an ecosystem**, IN as main-canvas composites — shipped: composite node.
6. Snapshots + diff — **DEFERRED** ("don't know if I like it").
7. Natural-language layer (build-by-asking + narrate) — **ALL OUT** (both halves).
8. Excel .xlsx transpiler (open a sheet, see a graph) — **IN** ("in for sure"), honest-70% — 2.0 (importer not yet shipped).
9. The write side (a graph that changes things) — **IN but KEEP VERY LIMITED**, tier 1 file sinks — shipped: Write CSV / Write JSON.
10. Headless Solenoid (graph as a software artifact) — **IN** — shipped: `npm run run-graph`.
11. Transform-by-example (Flash Fill that shows its work) — **DEFERRED**.
12. Expectation nodes (data-quality gate) — **IN** — shipped: Expect node.
13. The report projection (a second face on one graph) — **IN** (not "canvas Notes in reading order") — shipped: Report node.
14. Node-anchored review (comments / sign-off) — **IN** — shipped: node-anchored comments.
15. Engineering & scientific calc (the MathCAD seat) — **IN** — units-by-dimensionality + domain packs.
16. BOM / recipes / nested cost — **IN** — the Cube.
17. Decision models & scoring — **IN** — Decision Matrix.
18. Reactive backend for someone else's app (embeddable engine) — **OUT**.
19. Safe cage for AI-generated analysis — **OUT**.
20. Named dimensions (axes that know what they MEAN) — **OUT**.
21. Uncertain values (error bars that propagate) — **IN — VERY LATE**.
22. Time-aware data (as-of joins, effective dating) — **IN** (a new Join `how`, no third node) — shipped: As-Of Join / Lookup.
23. Persistent compute cache — **DEFERRED** (full sketch below).
24. Approximate-first (preview on a sample, exact on demand) — **IN**, footer affordance required — shipped: Sketch calc mode.
25. Graph profiler (time heatmap) — **OUT**.
26. Synthetic data mode — **OUT**.
27. Data slots (one model, anyone's data) — **OUT**.
28. Formula lens (any selection as an Excel formula) — **OUT**.
29. Model linter (static analysis for graphs) — **OUT**.
30. Problems panel (every error in one list) — **IN** — shipped: Problems panel.
31. Where-used (query the graph like a codebase) — **IN — scoped down** (highlight, not a full query box) — shipped: where-used highlight.
32. Reconcile node (explain two tables' difference) — **IN** — shipped: Reconcile node.
33. Paste anything (intake for trapped data) — **OUT** (not a scope fit).
34. Parquet & Arrow — **IN** — shipped: native Parquet/Arrow source.
35. The MCP port (let any AI agent drive Solenoid) — **DEFERRED** (full sketch below).
36. Guided seeds (a tutorial that is a document) — **OUT**.
37. Quick-wire (drop a cable on empty canvas → next node) — **IN — with conditions** (Settings toggle) — shipped.
38. Command palette — **IN** (author proposed Enter, not Ctrl+K) — shipped: Command Palette (Ctrl+K).
39. Scrubbing (drag any number) — **IN** — shipped: drag-to-scrub number fields.
40. Semantic zoom — **IN — optional, conservative trigger** — shipped: semantic zoom.
41. Conditional formatting for tables — **IN — but must beat Excel by a lot** — D4, author-gated / deferred.
42. History scrubber — **OUT**.
43. Money mode (exact decimal arithmetic) — **IN — DEFER**.
44. Model fuzzing (property-based testing for graphs) — **IN** — shipped: one-click model fuzzer.
45. Tornado ranking (which inputs matter) — **IN — as a NODE** — shipped: Tornado node.
46. Sealed models (tamper-evident sign-off) — **DEFERRED** (waits on Bet 2 canonical form).
47. Static HTML export — **IN — conditional on being easy** (confirmed easy) — shipped: Report → static HTML export.
48. The library layer (documents as a fleet) — **VERY DEFERRED** (file-over-app posture).
49. Session journal (the model's changelog writes itself) — **IN — as a NODE** — shipped: Session History node.
50. Auto-documentation (graph explains itself in prose) — **IN — scoped WAY down, gated on confidence**.
51. Presenter mode (saved views you step through) — **IN — keep it very light** (a Presentation node) — shipped: Presenter mode.
52. Branded output — **IN — COLORS ONLY** (no logo, no custom fonts) — shipped: palette editor.
53. Shared definitions (define once, use everywhere) — **OUT**.
54. Model index (overview of everything built) — **VERY DEFERRED** (same as #48).
55. Templates, structured (whole-model sharing economy) — **OUT**.
56. Commission engine (salvaged) — **OUT**.
57. Smart paste + multi-node operations — **SPLIT**: (a) paste-anywhere-on-canvas → OUT; (b) multi-node operations → the kept half.
58. Verified templates (quality gates) — **OUT**.
59. Fork lineage — **OUT** (file-over-app + open text format).
60. Citations (every formula carries its source) — **OUT** ("hate it").
61. Numbers with receipts — **OUT**.
62. The validator economy — **OUT**.
63. Standards as software (institutions publishing executable packs) — **OUT** (closes the walk).

---

## 23 — The persistent compute cache: never recompute what hasn't changed

**VERDICT (author, 2026-07-03): DEFERRED.** Revisit at the end of the walk with the
other deferred/parked items. Nothing builds now.

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

---

## 35 — The MCP port: let any AI agent drive Solenoid properly

**VERDICT (author, 2026-07-03): DEFERRED.** Industry momentum is shifting from MCP
servers toward CLI-driven agent tooling, and this pitch overlaps heavily with #10
(headless Solenoid, already IN) — a CLI covers "read structure, set inputs, run, get
outputs" for most agent use cases already. The one gap a CLI can't close: driving the
SAME live session a human has open in the GUI (a CLI run is a fresh one-shot process,
MCP's server model is persistent). Revisit if the CLI proves insufficient for that
specific live-shared-session case; joins the end-of-walk revisit pile otherwise.

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

---

## Appendix — the "recreate and undercut" demo target: Alteryx Designer

Asked directly (2026-07-02) which existing software Solenoid could recreate as a demo and
undercut, the answer by a wide margin was **Alteryx Designer** (**$5,195/user/year list**,
2026). It's the same paradigm — Alteryx Designer IS a node canvas of data verbs (input →
filter → join → group → output), so a demo is node-for-node the same picture, not an
analogy. Solenoid can run ~90% of the classic Alteryx showcase (two CSVs, clean a column,
join, filter, group-summarize, chart) TODAY on the shipped verb set + CSV import + chart
nodes, with native Polars underneath (a faster engine than Alteryx's on typical
workloads); the only parity gap was the Write-CSV sink (since shipped). The undercut
sentence writes itself — *"a $5,195/year workflow, running free, in a tool that also does
the rest of your math."* Runner-up recreate-and-undercut targets, each unlocked by one
feature: Oracle Crystal Ball / @RISK (~$1–2k/seat, once what-if #4 exists), PTC Mathcad
(once units + the report view land, #15), Stella/Vensim (~$2–3k/seat, once simulation #1
exists) — each is one Solenoid feature with a five-figure price tag.

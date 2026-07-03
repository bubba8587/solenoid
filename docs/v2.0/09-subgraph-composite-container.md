# Bundle 09 — The subgraph/composite container + the five run-mode hooks

**Source:** scope-features #5 (container, IN as document-local only), #1 (simulation,
IN as a hook), #4 (what-if family, IN — all of it joins this container). **Depends on:**
bundle 02 (shape-checking) for the typed boundary. **Gates:** bundle 10 (Decision Matrix
sensitivity needs the Monte Carlo hook), and it's the Expression cap's designated escape
hatch for anything more advanced than scalars/1-D lists.

This is the single biggest design-and-build item in the whole 2.0 set outside of
bundle 05. Author's framing: **one container, five run modes** — not five separate
mechanisms. Treat the shell as the deliverable; each run mode is a driver plugged into
the same shell.

## Scope boundary (author's explicit ruling — don't relitigate)

**OUT as an ecosystem.** No user-facing sharing/export/import/registry layer, no
block-versioning problem to solve. A subgraph is part of the main document; the ONLY
distribution channel for reusable subgraphs is a **pack** (`pack-architecture.md`'s
"composite pack node" — see bundle 16 / `v1.1-plan.md` WS-B). Don't build sharing.

**IN as the container.** Document-local: select a selection of nodes → "Make into a
node" → collapses to a single card with the right typed input/output sockets and a name,
behaving like any built-in node. First step is exactly this, with **no run-mode driver
attached yet** — prove the container mechanism alone before adding any of the five modes.

## The five run modes (all IN, all hooks on the one container)

1. **Simulation** (#1) — time steps. A loop inside the subgraph (today `#CIRC!`) becomes
   a feedback loop: this step's output feeds next step's input, N times, collecting a
   series. First step (already scoped in scope-features #1): a two-node population model,
   step count as a container parameter, output as a series a chart can consume. Don't
   rebuild the engine — evaluate the looped region N times.
2. **Scenarios** (#4) — named input sets ("optimistic/base/pessimistic"), run the
   container once per set, lay outputs out side by side. **Build this mode first among
   the four #4 modes** (author's own sequencing note) — no solver math, it just proves
   the shell handles multiple runs.
3. **Data tables** (#4) — a parameter grid: sweep one or two inputs across a range,
   collect the output grid. Same "run N times, collect" shape as scenarios with a
   different driver (a grid instead of named sets).
4. **Goal-seek / solver** (#4) — pin an output to a target, find the input that produces
   it. Scope to **numeric inputs/outputs only**; fail loudly with `#CONV!` (already an
   existing convergence-error code from the finance nodes — reuse the vocabulary, don't
   mint a new one) when it can't converge.
5. **Monte Carlo** (#4) — sample an input from a distribution, run thousands of times,
   show the spread. **This mode's distribution-input design explicitly defers into
   bundle 12's uncertain-values session** — the shell should anticipate it (a driver slot
   that accepts a distribution) but the distribution *representation* isn't this bundle's
   decision to make alone.

## Why running thousands of times is affordable

This is explicitly *why bundle 03 (compile/fuse) is worth doing* — a compiled/fused
subgraph is one function to call N times, not a node-by-node walk repeated N times.
Sequence Monte Carlo and data-tables' heavy N-run modes after bundle 03 lands, even
though the container itself doesn't hard-depend on it.

## Build order

1. **The shell alone:** selection → composite node, typed boundary (bundle 02), no run
   mode. Ship this and dogfood it before adding any driver.
2. **Scenarios** (no solver math) — the easiest driver, proves multi-run infrastructure.
3. **Data tables** — same infrastructure, parameter-grid driver.
4. **Simulation** — the loop-as-feedback driver; unblocks the `#CIRC!` reinterpretation
   only *inside* an opted-in Simulate container; cycles still error everywhere else.
5. **Goal-seek** — needs an actual numerical solver; scope to numeric, `#CONV!` on
   failure.
6. **Monte Carlo** — driver slot built now, distribution representation deferred to
   bundle 12; don't block the whole bundle on that decision landing first.

## Exit criteria

A user can collapse a node selection into a named, typed composite card that behaves
like a built-in node (no sharing, no export — document-local only); the same container
supports scenarios, data tables, simulation (time-step loops), and goal-seek as run
modes with one consistent UI/UX; the Monte Carlo driver slot exists and is ready to
accept bundle 12's distribution representation once that lands.

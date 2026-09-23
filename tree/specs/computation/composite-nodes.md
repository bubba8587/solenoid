---
aliases: ["Composite nodes"]
tags: [spec, computation]
---
<!-- [[C77]] compositeIsSubgraph, [[D52]] compositesHoldUntilSolve, [[C53]] queryIsCompositePreset, [[C35]] unknownViaPlaceholder, [[C33]] saveBindsMain, [[C43]] oneFlowSurface, [[C28]] literalsIffEditable, [[C37]] observerOwnsSize, [[C39]] effectsEdgeTriggered, [[C76]] formulaPackDefault, [[C78]] packLegibility, [[C79]] packActivationIsPresentation -->

# Spec: Composite nodes

Serves [[C77]] compositeIsSubgraph, [[D52]] compositesHoldUntilSolve, [[C53]] queryIsCompositePreset and [[C35]] unknownViaPlaceholder, with [[C33]] saveBindsMain, [[C43]] oneFlowSurface, [[C28]] literalsIffEditable, [[C37]] observerOwnsSize, [[C39]] effectsEdgeTriggered, [[C76]] formulaPackDefault, [[C78]] packLegibility and [[C79]] packActivationIsPresentation. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

This file owns the Composite card: its value model, its boundary ports and markers, every run mode, the heavy-mode hold, loops inside a composite, making a composite from a selection and unpacking it, how it saves and loads, and how edits inside it reach the outside. How the drill-in canvas mounts, leaves, undoes and substitutes the active graph is [[composite-drill-in-mount-lifecycle]]; this file only names the points where the drill-in calls into the composite. The outer pass that retargets an inner edit onto the owning card is [[compute-pass]]. The save shape of `init.internal` is also summarized in [[save-format]].

The code is `src/graph/nodes/composite.ts` (`CompositeNode`, `CompositeInputNode`, `CompositeOutputNode`, `byRowValues`, `stopConditionMet`, `solveGoalSeek`), `src/graph/compositeLogic.ts` (make and unpack), `src/graph/components/CompositeNode.tsx` (the card, the run controls, the marker cards), `src/graph/compositeEditorStore.ts`, `src/graph/compositeStaleStore.ts`, `src/graph/monteCarlo.ts` (the sampler, scoped to composites) and `src/graph/flow/FlowCompositeOverlay.tsx`.

## Terms

- **Composite.** A card (`CompositeNode`, registry type `CompositeNode`) that holds a real subgraph and shows only a declared boundary.
- **Internal editor and engine.** The composite's private `NodeEditor` (`internalEditor`) and `DataflowEngine` (`internalEngine`). Every member node lives in the internal editor and is computed only by the internal engine.
- **Port.** One entry of the boundary: a `CompositeInputPort` or `CompositeOutputPort` record on the composite. An exposed input port and every output port also exist as a socket on the card, keyed by the port id.
- **Marker.** The node inside the subgraph that a port is bound to: a `CompositeInputNode` ("Composite Input") for an input port, a `CompositeOutputNode` ("Composite Output") for an output port. A port names its marker by `internalNodeId`.
- **Seed.** An input marker's editable `defaultValue`, typed on the marker inside the drill-in.
- **Run mode.** `runMode`, one of `single`, `manual`, `scenarios`, `data-table`, `simulation`, `goal-seek`, `montecarlo`, `by-row`.
- **Internal pass.** One `runPass`: inject every input marker's value, reset the internal engine, fetch every output marker. Every run mode is a number of internal passes.
- **Heavy.** A mode configuration for which `isHeavyMode()` is true. A heavy composite holds its last result until Solve or Refresh.
- **Drill-in.** The full-viewport canvas over the internal editor, opened with Edit contents.

## Value model

A composite is a subgraph, not a Group variant ([[C77]] compositeIsSubgraph). The card has sockets and a `data()`; a Group has neither.

- The constructor builds `internalEditor`, installs input coercion on it (`installInputCoercion`, so a member narrows its inputs exactly as on the main canvas), adds a pipe (below), then builds `internalEngine` and attaches it with `internalEditor.use(internalEngine)`. The error guard is not a pipe here: whoever adds a node to the internal editor calls `installErrorGuards(node)` directly after `addNode`, which puts the guard outside the coercion wrapper, the same order as the main canvas ([[compute-pass]] § wrappers).
- Nothing inside the subgraph is registered with the outer engine, appears in the outer cache, or gets a value in `cableValueStore`. The outer engine sees one node, the card, whose `data()` returns one value per output port.
- The composite's own cache of results is `cachedOutputs`, keyed by output port id. In a multi-run mode each value is an array with one entry per run, in run order.
- The internal pipe reacts to `nodecreated`, `noderemoved`, `connectioncreated` and `connectionremoved`: each calls `markInternalEdit()` (bumps `internalEditSeq`), and a connection event outside `hydrate()` also calls `settleInternalTypes()`.
- `runSeq` counts `data()` calls. The drill-in re-renders its internal cards only when `runSeq` has advanced ([[composite-drill-in-mount-lifecycle]] § Undo inside a composite).
- A composite nests: a member may itself be a composite, whose `data()` runs inside the outer composite's internal pass.
- The card is size-owning: its constructor reads `width` and `height` back from `init` (defaults 240 × 140) ([[C37]] observerOwnsSize). The markers are 140 × 70.
- Its catalog kind is `util`.

## Ports

### Input ports

`CompositeInputPort` is `{ id, label, exposure, tier, internalNodeId, default? }`.

| Field | Meaning |
|---|---|
| `id` | Stable port key and the card's input socket key. Minted as `in_<index>_<5 random base-36 chars>` unless given. |
| `label` | Shown on the card socket. Synced from the marker's label (below). |
| `exposure` | `exposed`: a real card input socket. `hidden`: no card socket; the value is baked. |
| `tier` | `basic` or `advanced`. Stored and saved; nothing in the app reads it yet. |
| `internalNodeId` | The live id of the `CompositeInputNode` this port feeds (its saved id in a save). |
| `default` | Optional fallback value, below the marker's seed. Nothing in the app sets it yet except a saved or authored document. |

An exposed port's card socket is an `AdoptiveSocket` with base `trueany`: unwired it is a wildcard, wired it adopts the concrete type of the cable through the outer type settle. Because an unwired wildcard input takes no inline literal on a Composite (the card declares no `autoLiterals`), the card shows each exposed input as a label row: the source's name when wired, nothing when not. The unwired value comes from inside, from the marker's seed.

`addInputPort(spec)` pushes the record and, for an exposed port, adds the socket; it returns the id. `removeInputPort(id)` requires the caller to have removed the card's cables into that socket first; it drops the record and socket, deletes that port's key from every scenario's overrides and from `dataTableValues`, clears `goalSeek` if the port was its driver, and clears `byRowPortId` if it was the By-Row port.

### Output ports

`CompositeOutputPort` is `{ id, label, tier, internalNodeId }`, id minted as `out_<index>_<5 chars>`. Every output port has a card output socket, an `AdoptiveSocket`. `addOutputPort` adds record and socket. `removeOutputPort(id)` (same caller contract) drops the record, the socket and its `cachedOutputs` entry, and clears `goalSeek` if the port was its target.

### The input value fallback order

For each input port in one internal pass, the marker's `value` is the first of these that is not `undefined` (and, for the wired value and the seed, not `null` either, because the chain uses `??`):

1. the run mode's override for this port id (a scenario cell, a Data Table value, a Monte Carlo draw, a goal-seek trial, a By-Row row);
2. for an exposed port only, the first value on the card's wired input (`inputs[id][0]`);
3. the marker's seed, `defaultValue`;
4. the port's `default`;
5. `null`.

A hidden port skips step 2. An override of `null` is used as `null`.

### Labels and types across the boundary

- `syncPortLabels()` copies each marker's current label onto its port record and the card socket's label. A cleared marker label becomes `Input` or `Output`, the marker card's placeholder. A port whose marker is missing keeps its label. It runs at the start of every `data()` and when a drill-in level is left.
- The markers' sockets are per-instance `MutableSocket`s, outside the `trueany` adoption fixpoint, and display only. At every `data()`, `syncMarkerSocketTypes()` sets each input marker's `value` output to the card input socket's current type, and each output marker's `value` input to the type of the internal socket that feeds it (`trueany` when unwired).
- `adoptBoundaryTypes()` sets each output port's card socket to the `dataType` of the internal socket feeding its marker, or `trueany` when unwired or the marker is missing, and returns whether any type changed. Adoption never removes an outer cable.
- `settleInternalTypes()` runs `settleWildcardTypes(internalEditor)` and then `adoptBoundaryTypes()`. It runs at the end of `hydrate()`, after each internal connection change outside hydrate, and once at the end of make-from-selection. The main canvas's own connection-pipe settle never reaches the internal editor, so this is the only settle it gets.

## The boundary markers

Markers are not user-addable: their catalog entries (`composite-input`, `composite-output`) are hidden and exist only so a snapshot can rebuild them. They live only inside an internal editor. The internal editor has no connection-time type check, so only the runtime value shape matters.

**`CompositeInputNode`.** One output, `value`. `data()` returns `{ value: this.value }`, where `value` was written by the container before the pass.

| Field | Persisted | Meaning |
|---|---|---|
| `label` | yes | Default `Input`. |
| `defaultValue` | yes | The seed (number or null). |
| `uncertainty` | only when > 0 | Monte Carlo spread: 1σ for normal, half-width for uniform. `null` or 0 is a point value. |
| `distribution` | only when `uniform` | `normal` (default) or `uniform`. |
| `value` | transient | The value injected for the current pass. |
| `externallyWired` | transient | Stamped each `data()`: the port is exposed and its card input has a value. |
| `goalDriver`, `solvedValue` | transient | This marker is the active goal-seek driver, and its solution (a number, a `#CONV!` error, or null). |
| `modeNote` | transient | `{ tag, text }` readout for the active mode, or null. |

`modeNote` per mode: Monte Carlo with a spread gives `± spread` / `<spread> · <distribution>`; By-Row on the chosen port gives `by row` / `one run per row`; Scenarios on a port any scenario overrides gives `scenarios` / `varies`; Data Table with N values gives `data table` / `N value(s)`; every other case, including goal-seek, is null.

**`CompositeOutputNode`.** One input, `value`. `data()` returns the first value on its input (or null) and stores it in `cachedResult`, which the drill-in shows; the error guard mirrors an error into `cachedResult` too. `goalTarget` is stamped each `data()`: the goal-seek target when this is the target output, else null. When a driver (multi-run, Simulation, Monte Carlo) computes the port's value without running the marker's own `data()`, it writes the final value (the series or summary) into `cachedResult` so the drill-in shows what the card shows.

**Marker cards** (drill-in only). The input marker shows the wired value, rendered by kind, when `externallyWired`; otherwise a number field over the seed that commits on Enter or blur (blank commits 0, a non-number is refused as an invalid draft) and runs a full `processGraph()`. When it is the goal-seek driver it adds a `solves to` note showing `—`, the solved value, or `no solution`. It then shows `modeNote`. The output marker shows a sparkline over a numeric series of two or more, the value rendered by kind, and a `target` note under goal-seek.

Rendering by kind (`CompositeBoundaryValue`, card and markers alike): a Frame, Cube, chart, Mermaid, SVG or lambda value uses its own display; anything else goes through `ValueDisplay`. A boundary value is never stringified.

Markers cannot be copied (copy skips them) or deleted from the drill-in (its delete excludes them). A port loses its marker only through drill-in undo restoring a snapshot from before the port existed; the port then dangles until the level is left and pruned ([[composite-drill-in-mount-lifecycle]] § Leaving a level).

## The card

`CompositeComponent`, top to bottom:

1. An **Edit contents** button. On the main canvas it opens the drill-in at one level (`compositeEditorStore.open`); inside a drill-in it drills one level deeper (`drillInto`). The node context menu offers the same (Edit contents) plus Unpack composite.
2. The exposed input rows (`InlineInputs`).
3. The run controls (`CompositeRunControls`), shared with the drill-in:
   - the run-mode dropdown, shown only when the composite has at least one port: Single run, Manual refresh, Scenarios, Data table, Simulation, Goal seek, Monte Carlo, By row;
   - when heavy, a Solve button (a play icon; labeled Refresh with a refresh icon in `manual`) and a status dot: hollow orange "Stale", filled red "No solution" (goal-seek result is an error), filled "Up to date" otherwise. Solve calls `requestSolve(insideOnly)` and `processGraph(node.id)`;
   - the mode's editor (below).
4. One output box per output port: the label, then the value in a socket row that anchors that port's output socket, with a sparkline above a numeric series of two or more. Under goal-seek these boxes are suppressed; the goal-seek editor's Solution box carries the target port's socket instead.
5. `no ports` when the composite has no ports.

The drill-in shows the same run controls in a collapsible panel (collapsed by default on mobile) titled with the mode's label, passing `insideOnly` (below). There the goal-seek Solution is a plain value, since the socket belongs to the outer card.

## Run modes

Every mode is built from `runPass(inputs, overrides?)`:

1. For each input port with a marker, set `marker.value` by the fallback order.
2. `internalEngine.reset()`.
3. Seed `#CIRC!` on the internal loop members (`seedLoopErrors` over `loopMembers(internalEditor)`), with the message "Part of a circular dependency: the calculation feeds itself. Switch the container to Simulation mode to run it as a feedback loop."
4. For each output port, `internalEngine.fetch(marker.id)` and take `.value ?? null`. A missing marker gives null; a fetch that throws gives null.

Values that are `SolError`s travel through the subgraph like any other value; an internal error reaches the output as that error.

`collectMultiple(inputs, overridesList)` runs one pass per overrides entry and returns, per output port, the array of that port's values in run order.

`runActiveMode(inputs)` dispatches:

| `runMode` | Condition | Runs |
|---|---|---|
| `simulation` | always | `runSimulation` |
| `scenarios` | at least one scenario | `collectMultiple` over the scenarios' overrides |
| `data-table` | at least one axis | `collectMultiple` over the Cartesian product; with no axis, one pass |
| `goal-seek` | `goalSeek` configured | `runGoalSeek` |
| `montecarlo` | always | `runMonteCarlo` (one pass when no input is uncertain) |
| `by-row` | always | `runByRow` (one pass when unset or no rows) |
| anything else | | one pass (`single`, `manual`, and the unconfigured cases above) |

### Single run

One pass, fully live, on every outer pass that reaches the card.

### Manual refresh and Query

One pass, identical to Single, but always heavy: it computes only on Refresh. `insideOnly` never applies in `manual`.

Query is this mode as a catalog preset, not a class ([[C53]] queryIsCompositePreset). The `query` catalog entry creates a `CompositeNode` labeled `Query`, `runMode: "manual"`, with one exposed basic input port `table` (label Table, marker `qin`) and one output port `result` (label Result, marker `qout`), and a pending internal snapshot of the two markers at (0, 0) and (420, 0) joined by a cable. The drill-in canvas is the steps view and the Frame verbs placed between the markers are the steps ([[frame-verbs]]). Every add path hydrates a created composite right after `create()`, because Query ships its internals as a pending snapshot.

### Scenarios

Config: `scenarios: CompositeScenario[]`, each `{ id, name, overrides }` with `overrides` keyed by input port id. `addScenario()` mints `sc_<n>_<5 chars>` named `Scenario <n+1>`.

- Heavy when at least one scenario exists.
- One pass per scenario, in list order, with that scenario's overrides; a port absent from a scenario keeps its normal value. Each output is an array, one entry per scenario.
- The editor is a grid: a Scenario name column, one column per exposed input, a remove button per row, and + Scenario. A cell commits on blur or Enter: blank removes the override, a finite number is stored as a number, anything else as a string. The name commits on every keystroke. With no exposed input it reads "expose an input to give scenarios something to vary".

### Data Table

Config: `dataTableValues: Record<portId, unknown[]>`. `setDataTableValues(port, [])` deletes the entry.

- An axis is an exposed input port with a non-empty list. Axes are taken in input-port order. Heavy when at least one axis exists.
- The runs are the full Cartesian product, the first axis varying slowest: axes A = [1, 2] and B = [x, y] run (1, x), (1, y), (2, x), (2, y). Each output is an array in that order. More than two axes is allowed. There is no cap.
- The editor has one field per exposed input, typed as comma-separated values: split on commas, trimmed, blanks dropped, each a number when finite and a string otherwise; commits on blur or Enter. With no exposed input it reads "expose an input to sweep it".

### By-Row

Config: `byRowPortId` (`""` = unset).

- Heavy when `byRowPortId` names an existing input port.
- The iterated value is the port's normal value (wired, else seed, else default; a hidden port skips wired). `byRowValues(v)` splits it:

| Value | Rows |
|---|---|
| `null` or `undefined` | none |
| Cube | one single-row Cube per row, every column kept with its name, type and format, nested cells kept |
| Frame | one single-row Frame per row, same headers |
| array | its outer elements (a 1-D List gives scalars, a matrix gives its rows) |
| any other value | itself, as one row |

- No rows, or an unknown port, runs one plain pass. Otherwise one pass per row with that row as the port's override; each output is an array, one entry per row.
- Cap: `BY_ROW_MAX_ROWS = 500`. Rows past it are dropped from the tail. When the total exceeds the cap, the composite fires a warning alert (Alerts HUD and toast) "`<name>`: By-Row ran the first 500 of `<total>` rows (the rest were skipped)", where name is the trimmed label or `Composite`. It fires only when the total differs from the last capped total (`lastByRowCapTotal`, transient) and never while a graph rebuild is open ([[C39]] effectsEdgeTriggered, [[alert-node-alerts-hud]]). A run under the cap resets the edge.
- The editor is a "For each row of" picker over the exposed inputs, with `— none`; with none exposed it reads `— expose an input to iterate`.

### Goal Seek

Config: `goalSeek: { inputPortId, outputPortId, target, maxIterations?, tolerance?, boundsLo?, boundsHi? }` or null. `setGoalSeek(patch)` creates the config on first use with the first exposed input, the first output and target 0. The editor creates it on first render when an exposed input and an output exist, and triggers a pass.

- Heavy when configured. In `goal-seek` mode without a config the card is a live single pass.
- Starting point: the driver's wired value, else its marker's seed, else the port default, else 0; a non-numeric start becomes 0. An error start is not solved from: it is `goalSeekResult` and the driver's `solvedValue`, one pass runs with no override, and the target port carries it.
- The objective for a trial x is one internal pass with the driver overridden to x, returning `coerceNumber(output) − target`. `coerceNumber` maps a number to itself, an uncertain number to its central value, a logical to 1 or 0, a non-blank string through `Number`, and everything else to NaN.
- `solveGoalSeek(f, x0, opts)`:
  - `FTOL` is `tolerance` when > 0, else 1e-7; `XTOL` is 1e-9; `MAX` is `round(maxIterations)` when ≥ 1, else 80. Bounds apply only when both are finite and lo < hi; every secant step is then clamped to [lo, hi].
  - Evaluate at a = clamp(x0). A non-finite residual fails at once; a residual within FTOL returns a.
  - Secant: b = a + (1 if a is 0, else 0.001·|a|). Up to MAX steps while f(b) is finite: return b if within FTOL; stop if f(b) − f(a) is 0; c = clamp(b − f(b)(b − a)/(f(b) − f(a))); stop if c is non-finite; shift a ← b, b ← c. If the step |c − b| is below XTOL, return c when its residual is within FTOL, otherwise stop.
  - Bracketing fallback: with bounds, lo and hi are the bounds. Without, lo = x0 and hi = x0 + (1 if x0 is 0, else |x0|), then up to 60 expansions while f(hi) is non-finite or has the sign of f(lo): the span doubles and hi alternates between x0 + span and x0 − span. A non-finite f(lo), or a bracket never found, fails.
  - Bisection: up to 200 halvings; a non-finite midpoint residual fails; return the midpoint once its residual is within FTOL or the interval is below XTOL; after 200, return the midpoint.
- Success: the solution is rounded to 12 significant digits, which strips the float tail but keeps a driver that needs many decimals (a monthly rate of 0.032173) intact; display rounding is the readout's job. It goes to `goalSeekResult` and the driver marker's `solvedValue`, never onto the seed, so the seed stays the user's starting guess. One final pass runs with the driver at the solution; the outputs are that pass's values, except the target port, which carries the solved driver value (the achieved output would only equal the target).
- Failure: `#CONV!` with the message `Goal seek couldn't drive "<inputPortId>" to make "<outputPortId>" reach <target>`, stored in `goalSeekResult` and `solvedValue`. One pass runs with no override, and the target port carries the error ([[error-values]]).
- The editor: Set (output), To value (target), By changing (exposed input), and under a disclosure Max iters, Tolerance and Bounds lo/hi; then Solution: `<driver label>` with the result. With no exposed input or no output it reads "expose a numeric input and output to goal-seek".

### Monte Carlo

Config: `monteCarlo: { samples, seed, correlations? }` or null; the defaults are `DEFAULT_MC_SAMPLES = 500` and `DEFAULT_MC_SEED = 1`. Each input's spread and distribution live on its marker.

- The uncertain ports are the input ports whose marker has `uncertainty > 0`, in input-port order. Heavy when there is at least one. With none, one plain pass.
- Draw count: `max(1, round(samples))`. RNG: `mulberry32((seed | 0) >>> 0)`, so a fixed seed gives the same draws on every platform and every Solve.
- Each uncertain port's mean: the wired value when the port is exposed and has a wired value, else the seed, else the port default, else 0, through `coerceNumber`. If any mean is an error, every output is that error; if any is otherwise non-finite (a wired blank or text), every output is null. Either way no draw runs.
- Correlations: the text `a ~ b = 0.7; c ~ d = -0.3`, pairs separated by `;` or `,`. Each pair must match `<name> ~ <name> = <number>` with ρ in [−1, 1] and two different names, or it is dropped. Names resolve to an uncertain port by id or by trimmed label; unresolved and self pairs are dropped. With any pair left, the k × k matrix (1 on the diagonal, the pairs' ρ, 0 elsewhere) is factored by Cholesky; when it is not positive definite, the off-diagonals shrink toward 0 in steps of 0.05 until it is, and the identity is the last resort. An inconsistent set of pairs is softened, never refused; the factorization treats a pivot at or below 1e-12 as not positive definite. This is a Gaussian copula: the correlated standard normals map onto each input's own marginal, so every input keeps exactly the distribution it declared and only the dependence between them changes. The entered ρ is the normal-score (Pearson) correlation; the Spearman rank correlation it induces is (6/π)·asin(ρ/2), within 2% of ρ across the range.
- Per draw, in order: independent draws take each uncertain port in turn, normal as mean + z·spread with z from Box-Muller (two uniforms, cosine branch, a first uniform ≤ `Number.EPSILON` redrawn), uniform as mean + (2u − 1)·spread. Correlated draws take k standard normals, multiply by the factor, and map each onto its own marginal: normal as mean + z·spread, uniform as mean + (2Φ(z) − 1)·spread. One internal pass runs per draw with the draws as overrides.
- Each output becomes `summarizeSamples` of its per-draw `coerceNumber` values: non-finite draws are dropped and counted in `dropped`; the mean, and the sample standard deviation (N − 1) for N ≥ 2 (0 for N = 1; NaN mean for N = 0), form an uncertain number `{ kind: "uncertain", value, error, samples, dropped? }`.
- The editor lists each exposed input with a ± field (≤ 0 clears the spread) and a Normal/Uniform toggle; a 16-bin histogram of the first output with more than one sample (`histogram` ignores non-finite draws, gives one empty bucket when none is left and one full bucket when all draws are equal, and puts the maximum in the last bin); "`<kept>` of `<N>` draws" when any draw was dropped; and under a disclosure Samples (blank or < 1 resets to 500), Seed and Correlations. With no exposed input it reads "expose an input to give it an error bar". Opening the editor creates the config with defaults.

#### The uncertain number

An uncertain number (`UncertainNumber`, `valueKinds.ts`) is `{ kind: "uncertain", value, error, samples?, dropped? }`: `value ± error`, with `error` a non-negative 1σ (`uncertain()` stores `|error|`). It is scoped to the composite subsystem and is not threaded through general graph arithmetic; a numeric consumer reads the central `value` (`uncertainCenter`, `coerceNumber`).

- `samples` holds the raw Monte Carlo draws behind a summary and powers the histogram. It is not part of the value's identity, so a hand-built `value ± error` omits it.
- `dropped` counts the draws the summary could not use (an errored or blank pass), so the readout can say "200 of 500 draws" instead of a confident mean over a fraction.
- The propagation ops (`addUncertain`, `subUncertain`, `mulUncertain`, `divUncertain`, each normalizing plain numbers through `asUncertain` with error 0) use first-order Gaussian propagation for independent variables, with no covariance term. A sum or difference adds the errors in quadrature. A product's error is `√((b·σa)² + (a·σb)²)` and a quotient's is `√((σa/b)² + (a·σb/b²)²)`, the forms that stay finite when a or b is 0; a zero denominator still gives ±Inf or NaN.

### Simulation

Config: `simulationSteps` (default 10), `stopWhenPortId` (`""` = none), `stopWhenOp` (default `eq`), `stopWhenValue` (default 1).

- Always heavy. How the loop runs is under Loops, below.

## Loops

A cable cycle inside a composite is detected with the same `loopMembers` as the main canvas: every node with a self-cable and every strongly connected component of two or more nodes.

**Outside Simulation**, every internal pass seeds `#CIRC!` on the loop members before fetching, so a fetch into the cycle dead-ends instead of recursing, and the members and everything downstream read `#CIRC!` with the message pointing at Simulation mode.

**In Simulation**, `runSimulation(inputs)` resolves the cycle as bounded feedback:

1. Set each input marker's value to the wired value (exposed ports) or the port default, else null. This path does not read the marker seed; the plain pass in step 2 does.
2. Reset the internal engine and clear `simLastSteps`. With no loop members, return one plain pass.
3. For each loop member, gather its cables from non-member sources and fetch those sources once through the engine. They are upstream of the loop and do not change between rounds.
4. Order the members as `internalEditor.getNodes()` lists them.
5. Rounds: `steps = max(1, round(simulationSteps))`. In each round, each member in order gets its static inputs plus, for each cable from another member, that member's latest output in a shared `state` map; a member that has not produced yet contributes nothing, so that input is unwired on the first round. The member's guarded `data()` is called directly and its result replaces its entry in `state`. This is Gauss-Seidel stepping: a member later in the order sees this round's values, an earlier one the previous round's. After each round a snapshot of every member's output is appended to the series.
6. Stop when: when `stopWhenPortId` names an output whose marker has an incoming cable, the condition is checked after each round, and the halting round is kept in the series. If the marker is fed straight from a member, the value is read from `state`; otherwise the internal engine is reset, every member's current output is seeded into its cache, and the feeding node is fetched. `stopConditionMet(raw, op, value)` reads a logical as 1 or 0 and any other value through `Number`; `null`, `undefined` and non-finite values never stop, so a missing or broken round never halts the run. The ops are `gt`, `ge`, `lt`, `le`, `eq`, `ne`.
7. `simLastSteps` = rounds run. Fewer than `steps` means the condition stopped it.
8. Seed every member's final output into the internal engine cache, so nodes downstream of the loop resolve through the normal pull.
9. Outputs: a port whose marker is fed straight from a member gets the series of that member output, one entry per round (mirrored into the marker's `cachedResult`). Any other port is fetched once through the engine and gets its single final value.

With a stop port set, `simulationSteps` becomes a cap and its label reads Max steps. The Stop when picker offers the output ports whose adopted socket type is `number`, `numlist`, `logical`, `logicalcombo`, `any`, `trueany` or unresolved, plus the current pick; the op picker shows ≥ ≤ > < = ≠. After a run with a stop port the editor reads "stopped at step N" or "ran all N steps (never met)".

## The heavy-mode hold

A composite in a heavy configuration holds its result until the user asks for a solve, and never solves on load, paste, create or a switch into a heavy mode ([[D52]] compositesHoldUntilSolve).

`isHeavyMode()`:

| Mode | Heavy when |
|---|---|
| `single` | never |
| `manual` | always |
| `simulation` | always |
| `scenarios` | at least one scenario |
| `goal-seek` | `goalSeek` is configured |
| `montecarlo` | at least one input marker has `uncertainty > 0` |
| `by-row` | `byRowPortId` names an existing input port |
| `data-table` | at least one exposed input has a non-empty value list |

All hold state is transient and never saved, so a loaded composite starts unsolved by construction: `solveRequested`, `solveInsideOnly`, `lastSolveKey` (null = never solved), `stale`, `goalSeekResult`, `simLastSteps`, `_lastRunMode`.

Every `data(inputs)`:

1. Bump `runSeq`, sync port labels and marker socket types, and stamp the markers (`externallyWired`, `goalDriver`, clear `solvedValue` on non-drivers, `modeNote`, `goalTarget`). Stamps are topology and config only, so they stay current on a held pass.
2. Resolve trig angle modes over the internal editor (`resolveTrigModes`) before any internal pull, so an Auto-mode trig node inside reads its incoming unit instead of computing in radians.
3. If the mode is heavy and differs from `_lastRunMode`, set `lastSolveKey = null`. Record the mode.
4. Heavy, with `solveRequested`: run the mode on `{}` when `solveInsideOnly`, else on `inputs`; store the outputs in `cachedOutputs`; set `lastSolveKey = solveKey(inputs)` (always the real inputs, computed after the run); clear both request flags and `stale`; return the outputs.
5. Heavy, `lastSolveKey === null`: set every output key to null in `cachedOutputs` (the engine refuses a result missing a key), clear `goalSeekResult` and every marker's `solvedValue`, mark stale, and return those blanks.
6. Heavy otherwise: `stale = (solveKey(inputs) !== lastSolveKey)`; return `cachedOutputs` unchanged.
7. Not heavy: run the mode on `inputs`, store and return; not stale.

Each branch publishes the staleness to `compositeStaleStore` (a set of stale ids with a notifier; forgetting a node clears it). The run controls subscribe to it, because a held card's outputs do not change and the pass's changed-output render pruning would otherwise skip it.

`solveKey(inputs)` is the JSON of: the inputs, where a primitive counts by value and an object by a per-composite reference token (a new Frame object reads as a change even when equal, and nothing is deep-serialized); every input marker's seed; every marker's `[uncertainty, distribution]`; `internalEditSeq`; and `runMode`, `goalSeek`, `monteCarlo`, `scenarios`, `dataTableValues`, `simulationSteps`, `stopWhenPortId`, `stopWhenOp`, `stopWhenValue`, `byRowPortId`. Any change to these after a solve turns the dot stale; the held value stays until the next Solve.

**Solve from inside.** `requestSolve(insideOnly)` sets `solveRequested` and sets `solveInsideOnly` to `insideOnly && runMode !== "manual"`. The drill-in's controls pass `insideOnly`, so a Solve there runs on empty inputs: every exposed port falls to its seed, and Monte Carlo means and the goal-seek start come from the seeds too. The key is still taken on the real inputs, so the card does not read stale right after.

**Errors on the card.** The card and the output marker are in `SEES_ERRORS` ([[D35]] errorInErrorOut): an error on a wired input crosses into the subgraph through its marker like any other value, and each member's own guard applies there. So a catcher inside (IFERROR) catches it, an output whose lane never reads that input keeps its value, and an error that reaches an output marker is that port's value, as the same nodes unpacked would give ([[C77]] compositeIsSubgraph). A held heavy card keeps its held outputs and reads stale ([[error-values]]).

## Make a composite from a selection

`createCompositeFromSelection(editor, view)` runs on Ctrl+Shift+G (Cmd on macOS) over the focused surface's editor when any node is selected; the Composite catalog description names the shortcut.

1. Clear the cable selection.
2. The members are the selected nodes that are not a Group, not a Composite and not hidden inside a collapsed Group. None, or no measurable box, returns null.
3. The origin is the minimum x and y over the members' measured boxes.
4. Classify every cable: internal (both ends members), incoming (target is a member), outgoing (source is a member).
5. Inside a graph rebuild scope: remove all three sets of cables from the outer editor; move each member instance (not a copy) from the outer editor into the new composite's internal editor, recording its position relative to the origin in `internalPositions`; re-add the internal cables inside.
6. For each incoming cable, separately: create a `CompositeInputNode` labeled `<target label or class name> · <target input label or key>`, add it and install its guard, cable it to the member's input, place it 220 left of the member, add an exposed basic input port on it, and cable the outer source to that port on the card. Two cables into the selection give two ports even from one source.
7. For each outgoing cable, separately: create a `CompositeOutputNode` labeled `<source label or class name> · <source output label or key>`, cable the member's output to it, place it 80 right of the member's right edge (member width, or 220 when unknown), add an output port, and cable that port to the outer target. One member output feeding two outer targets gives two ports.
8. Settle internal types, add the composite to the outer editor, and move it to the origin. Close the rebuild scope and run one `bulkSettle()` (a full pass).

The new composite is labeled `Composite`, in `single` mode, and returns its id.

## Unpack

`unpackComposite(editor, view, id)` (context menu, Unpack composite) returns false for anything but a composite.

1. Hydrate the composite if it is still pending.
2. The base is the card's measured position (0, 0 when unknown).
3. Inside a rebuild scope: remove every outer cable on the card. Move every internal node except the markers into the outer editor at base + its `internalPositions` offset (offset 0 when unrecorded). Internal nodes are not removed from the internal editor first (that would fire `noderemoved` at a drill-in history that never saw them); the internal editor is discarded with the card.
4. Re-add every internal cable that touches no marker.
5. Collapse each input port: for every outer cable into the port and every internal cable out of its marker, add one cable from the outer source to the internal target.
6. Collapse each output port: the internal cable into its marker, joined to each outer cable out of the port.
7. Remove the card, close the scope, run one `bulkSettle()`.

Any re-added cable the editor refuses is dropped silently. What only the boundary held is gone after unpack: marker seeds, port defaults, Monte Carlo spreads, the run mode and its config. An unwired input that relied on a seed arrives unwired.

## Save and load

The card saves through the generic `extractInit`, with no composite code in persistence:

| `init` key | Content |
|---|---|
| `label`, `width`, `height` | as named |
| `runMode`, `simulationSteps`, `stopWhenPortId`, `stopWhenOp`, `stopWhenValue`, `byRowPortId` | scalars |
| `inputPorts`, `outputPorts` | copies of the port records, `internalNodeId` translated to the marker's saved id |
| `scenarios`, `dataTableValues` | deep copies |
| `goalSeek`, `monteCarlo` | omitted while null |
| `internal` | `snapshotInternal()` |

`snapshotInternal()` returns `{ nodes, connections }`. Every id in it is a **saved id** (`savedInternalId`): the id the node was hydrated from, or its live id when it was added since, so a save → load → save writes the same bytes.

- For a pending composite (loaded, never hydrated) it returns the pending snapshot untouched.
- Each internal node becomes `{ id, type, init, literals?, stringLiterals?, x?, y? }`: `id` is its saved id, `type` its class name, `init` its own `extractInit` (so a nested composite nests its own `internal`), the literal maps copied when the node has them, and `x`/`y` from `internalPositions` when recorded.
- A `PlaceholderNode` saves as its original type with its saved init and literal maps, never as a Placeholder ([[C35]] unknownViaPlaceholder).
- Each connection becomes `{ source, sourceOutput, target, targetInput }`, both ends as saved ids.

The constructor copies ports, scenarios, overrides, data-table lists and configs, adds the card sockets (exposed inputs and every output), and parks `init.internal` as pending. It does not build the internal graph: the class registry depends on the catalog, which imports this file, so the build waits for `hydrate(reg)`.

`hydrate(reg)` does nothing when nothing is pending. Otherwise, with `_hydrating` set:

1. Find the saved nodes whose type is not in `reg`, and derive their socket keys from the saved connections (`deriveMissingNodeSockets`).
2. For each saved node in order: an unknown type becomes a `PlaceholderNode` carrying `missingType`, the saved init and literal maps, the derived input and output keys, and the label from `init.label` or the type name; its outputs emit `#REF!`. A known type is constructed with a copy of its init, and its literal maps are restored only onto a class that declares them ([[C28]] literalsIffEditable); a nested composite is hydrated right there, since it computes inside this one's pass and would otherwise read null until drilled into. Add it to the internal editor, install its guard, record its saved position under its new id, and remember the saved id for the new one.
3. Re-add the saved connections between built nodes; a refused or dangling one is skipped.
4. Remap every port's `internalNodeId` from the saved id to the new id (rete mints fresh ids on construction). A port whose marker was not built keeps the stale id.
5. Clear `_hydrating` and run `settleInternalTypes()` once.

Hydration happens on document load (after the outer cables, with the same registry), on add from the Add menu, on paste (each pasted composite clone), on drill-in open, and on unpack. A pack switched off still has its classes registered, so its nodes inside a composite construct normally ([[C79]] packActivationIsPresentation); only a type no build registers takes the Placeholder path. A formula pack node inside is a core Expression and always loads ([[C76]] formulaPackDefault).

`restoreInternal(snapshot, reg)` (drill-in undo) removes every internal connection and node, clears `internalPositions`, translates every port's `internalNodeId` to its saved id (the snapshot's language), forgets the saved-id map, parks the snapshot as pending and hydrates it.

Copy and paste treat a composite like any node: the clone is constructed from `extractInit`, so its `internal` snapshot rides along, and it is hydrated before it is added. Inside a drill-in, copy works on the internal editor and never copies markers. Saving always serializes the main graph, never the open drill-in ([[C33]] saveBindsMain). The save validator recurses into `init.internal`, prefixing its findings with "inside the composite" ([[save-format]]).

## Edits inside and how they reach the outside

The drill-in is the main canvas's surface component over the internal editor ([[C43]] oneFlowSurface). What it changes flows out this way:

- **Topology** (a node or cable added or removed inside). The composite's own pipe bumps `internalEditSeq` and, for a cable, settles internal types and boundary adoption. The drill stack's pipe then runs `processGraph(stack[0].id)`, targeting the outermost composite on the breadcrumb, and schedules an autosave and an undo record.
- **Values** (a field on an internal card, a marker seed, a Monte Carlo spread). The component calls `processGraph` with the internal node's id, or with no id. The outer pass does not find that id in the main editor, so it bumps `markInternalEdit()` on every composite in the nesting chain and retargets the pass at the outermost owner ([[compute-pass]] § Retarget into composites).
- **Config** on the card or in the drill-in's run controls calls `processGraph(node.id)`, retargeted the same way when the composite is nested.
- **Ports.** + Input and + Output in the drill-in strip add a marker at the left or right edge of the view, labeled `Input N` or `Output N`, plus an exposed basic port or an output port, re-render the outer card when the parent is the main canvas, recompute and autosave.
- **Leaving a level** reconciles ports whose marker is gone (removing their parent cables, with a notice), then `syncPortLabels()`, so a marker renamed inside renames the card's socket ([[composite-drill-in-mount-lifecycle]] § Leaving a level).

Because every internal pass fully resets the internal engine, the subgraph is recomputed whenever the card's `data()` computes, and a held heavy card recomputes nothing.

## Packs

A pack node that grows past one formula becomes a composite ([[C77]] compositeIsSubgraph, `docs/pack-architecture.md`). Two pieces of that shape exist as data only: `exposure: "hidden"` and `tier: "advanced"` are honored where noted above (a hidden port gets no card socket and skips the wired value; the tier is saved), but nothing in the app creates a hidden port, reads the tier, or lets a pack declare a composite. Every port the app creates is exposed and basic. Locked is the silent default and only promotable ports earn chrome ([[C78]] packLegibility); a composite card today has no lock state of its own.

## Refused and not built

- A Group or a Composite in the selection is left out of a new composite, and so is a node hidden in a collapsed Group, since absorbing it would silently pull it out of that Group.
- Markers cannot be added from the Add menu, copied, or deleted from the drill-in.
- A heavy composite never solves without Solve or Refresh.
- By-Row caps at 500 rows. Scenarios, Data Table and Monte Carlo have no cap beyond their configuration.

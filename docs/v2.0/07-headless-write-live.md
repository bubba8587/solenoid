# Bundle 07 — Headless Solenoid, file sinks, live-data refresh

**Source:** scope-features #10 (IN), #9 (IN, very limited), #3 (IN, tiers 1-2) — one
arc, author's own framing: "in → through → out → unattended." **Depends on:** the CLI
spike needs nothing; the polished CLI rides bundles 01/02 but isn't blocking a v1.

## #10 — Headless Solenoid (IN)

**Exact scaffolding to copy — `src/graph/framesSeed.test.ts:1-50`** is the template
pattern for instantiating the engine outside the browser:
```ts
import { ClassicPreset, NodeEditor } from "rete";
import { DataflowEngine } from "rete-engine";
import * as Nodes from "./rete-nodes";
import type { Schemes } from "./schemes";
import { installInputCoercion } from "./coerceInputs";
import { installErrorGuards } from "./errorValue";

const editor = new NodeEditor<Schemes>();
installInputCoercion(editor);
editor.addPipe((ctx) => { if (ctx.type === "nodecreated") installErrorGuards(ctx.data); return ctx; });
const engine = new DataflowEngine<Schemes>();
editor.use(engine);
// construct nodes: new (Nodes as any)[sn.type](sn.init), editor.addNode(node),
// editor.addConnection(new ClassicPreset.Connection(...))
const out = await engine.fetch(nodeInstanceId); // the rete INSTANCE id, not the saved seed id
```
Equivalent instances: `cubesSeed.test.ts:29`, `pivotSeed.test.ts:28`, `errorSeed.test.ts:43`,
`errorIntegration.test.ts:41`, `polyformIntegration.test.ts:36`, `perfScaling.test.ts:63`.
Live app's real instantiation (for cross-check): `Canvas.tsx:1177`.

**Backend selection is automatically correct for headless Node — no special-casing
needed.** `src/graph/frameBackend.ts`: `JsFrameBackend` (165-222) is pure JS, no Tauri
dependency. `frameBackend()` (274-277) lazily defaults to `new JsFrameBackend()`.
`initFrameBackend()` (300-314) is the ONLY place that swaps to `PolarsBackend`
(230-266, IPC-based), gated on `engineAvailable()` (301) which requires Tauri IPC. **A
headless Node CLI must simply never call `initFrameBackend()`** — `engineAvailable()`
will be false anyway (no `window.__TAURI_INTERNALS__`), so `frameBackend()` naturally
stays on `JsFrameBackend`, and Polars-backed verb nodes transparently route through it
via `runFrameUnary`/`runFrameJoin`/`runFrameAppend` (`frameBackend.ts:368-410`).

**Existing project structure:** `scripts/` at the repo root already has `parity.ts` (run
via `npx tsx scripts/parity.ts`, imports `src/graph/nodeExcel.ts` directly) — this is the
closest prior art for a `tsx`-run script importing app TS modules. `package.json:7-15`'s
scripts block has no CLI/runner target yet.

**Build:**
1. `scripts/run-graph.ts` (new file, `tsx`-run like `parity.ts`) — load a saved graph
   JSON, instantiate editor+engine per the `framesSeed.test.ts` pattern above, run,
   print named outputs as JSON. Never call `initFrameBackend()`.
2. Confirm desktop-only (Polars-backed) verb nodes resolve correctly via the JS oracle
   fallback (already automatic per the backend-selection note above) — add a test case
   exercising at least one Join/Group-By node headlessly.
3. Polish pass (can trail): a real CLI — `solenoid run model.sol --set rate=0.05 --out
   results.json` — `--set` by stable name (bundle 01), typed args (bundle 02). Writes
   only where explicitly told (`--out`), same explicit-command discipline as the sink
   node below.

## #9 — The write side, tier 1 only (IN, KEEP VERY LIMITED)

**Explicit scope limit:** file writes ONLY. Write-back-to-source and the "act" tier are
OUT.

**Exact plumbing to reuse — `src/graph/fileBridge.ts`:** `isDesktop()` (13-15) gates
everything on `"__TAURI_INTERNALS__" in window` (false in the headless CLI — a sink
node's desktop write path and the CLI's `--out` path are two different code paths, the
CLI should use plain Node `fs`, not `fileBridge`). Exports for the in-app sink node:
`writeTextFilePath(path, content)` (line 61 — the write primitive), `writeTextFileAtomic`
(50, private, temp+rename), `saveTextFileDialog(name, content)` (67).

**No write/export node exists today** (confirmed — grep for `Write|writer|sink|Export`
in `nodeCatalog.ts` returns nothing). **Structural template to copy:** `CsvConnectionNode`
— `src/graph/nodes/connection.ts:273-329` (constructor 284, `data()` 291, `load()`
303-328, uses `isDesktop()`/`readFileText` from `fileBridge`) — mirror this shape but for
writing instead of reading.

**Build:**
1. A `WriteCsvNode`/`WriteJsonNode` (new file in `nodes/`), structurally mirroring
   `CsvConnectionNode` (`connection.ts:273-329`) but calling `writeTextFilePath`
   (`fileBridge.ts:61`) on explicit trigger only — never from `data()`'s normal compute
   path.
2. A "Run" button on the node UI that fires the write; a preview pane showing what would
   be written (free — the value is already on the cable, this is just rendering it
   before the write button is pressed).
3. **Disabled-by-default flag** for sink nodes loaded from an imported/shared graph —
   check via the existing pack/placeholder provenance pattern (`persistence.ts`) for
   precedent on "this came from elsewhere, treat cautiously."

## #3 — Live data, tiers 1-2 only (IN)

**Exact refresh machinery that already exists — `src/graph/connectionStore.ts`:**
`refreshConnection(id)` (lines 73-76, bumps a per-node token) and
`refreshAllConnections()` (79-82, bumps a global generation). Cache key:
`connectionStore.key(id, ref)` (line 42). `WebSourceNode.data()`
(`nodes/connection.ts:84-94`) compares the key, fires `fetchFrame` (96-125) in the
background, calls `scheduleConnectionRecalc()` (`connectionStore.ts:66-70`, debounced
into `processGraph()`). **Tier 1 (manual refresh) already has its trigger function built
— `refreshConnection(id)` — it just needs a UI button wired to it** (confirm one doesn't
already exist on the node card; if not, add it).

**`httpBridge.ts`** — `fetchText(url): Promise<FetchedText>` (lines 21-48), routes
absolute URLs through Tauri's HTTP plugin on desktop (CORS unlock, lines 29-35) or plain
`fetch` elsewhere. `CorsLikelyError` (14-19). No changes needed here for tiers 1-2.

**Alert edge-detection** (already shipped, reuse unchanged): `AlertNode`
(`src/graph/nodes/display.ts:83-221`), `detectAndFire(result, inputs)` (165-184) —
`statusKey(result)` (236-238) compared against `prevKey`; `isAlerting` (241-243);
`fireAlert(e)` in `alertStore.ts:70-73`.

**Build:**
1. Tier 1: confirm/add a manual "Refresh" button on source node cards
   (`WebSourceNode`/`CsvConnectionNode`), wired to the existing
   `refreshConnection(id)`/`refreshAllConnections()` (`connectionStore.ts:73-82`) — this
   function already exists, likely just needs a UI trigger point.
2. Tier 2: an interval timer calling the same `refreshConnection` path — no scheduler
   infrastructure exists yet, build a simple in-app `setInterval`-driven call, gated by a
   per-node "refresh every N minutes" setting.
3. Verify `AlertNode.detectAndFire` (`display.ts:165-184`) still fires correctly when
   triggered by an interval-refresh-driven recompute, not just a manual edit.

## Exit criteria

`scripts/run-graph.ts` runs a saved graph headlessly (per the `framesSeed.test.ts`
pattern) and prints outputs, confirmed to route Polars-backed nodes through the JS
oracle correctly; a Write CSV/JSON sink node (new, mirroring `CsvConnectionNode`'s
shape) fires only on explicit trigger, previews before writing, ships disabled by
default in imported graphs; source nodes support manual refresh (wired to the existing
`refreshConnection`) and an optional interval, with `AlertNode` firing correctly off a
refresh-triggered recompute.

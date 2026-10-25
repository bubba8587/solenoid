# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-10-23/24: one engine, in Rust; branch rust-port; cloud session)
- **The TS engine is gone** ([[D99]] rustIsSpec): Formula.js, the TS parser and evaluator, every TS function body and the JS frame verbs and backend; frozen fixtures in `fixtures/core/` hold what they answered ([[rust-core]]).
- **Polars is gone**: desktop table verbs run on the core in wasm as the web's do; Parquet reads through `crates/solenoid-parquet` ([[rust-core]] § Where it runs).
- **Units and formats ride in the core's frames** ([[C25]] firstClassUnits): each verb decides a column's unit and format (`frame_verbs.rs`); `frameSchema.ts` is gone.
- **rete is gone** ([[D102]] graphOnCore, [[graph-core]]): the model, the input boundary, the pass and its state, the ids and the direct calls to card bodies run in Rust on Ruggine, linked with the formula core into one wasm module.
- **Card bodies on the core: every class but Note and Report** ([[node-bodies]]); direct cards run Rust to Rust with no JavaScript between them ([[graph-core]] § Direct calls).
- **Every edit names its node** (`namedEdits.test.ts`): a full clear trusts each direct card's stamped call; a card's view fields (`VIEW_FIELDS`, `nodeInit.ts`) stay out of its call, and the sweep covers every module in `src/` that asks for a full pass.
- **[[C131]] noTextGuessing**: a formula never reads a number, date or logical out of text; only typed inputs read text. What's still half-read is in the backlog.
- **Crates in place of hand code**: `csv` (CSV read and write), `qrcodegen` (QR Code), `md-5`/`sha1`/`sha2`/`crc32fast` (HASH), `jiff` (time zones, bundled tzdb). The audit's remaining choices: `docs/audits/crate-audit-2026-10.md`, backlog § Rust core.
- **Dead TS deleted in two rounds**, then two comment sweeps cut the core's TS-twin provenance from its comments.
- **The isolate endpoint terminals mount again** (lost with the graph move).
- **Typed text is read by the core** ([[D93]] oneTextReading): `parseDate` hands every absolute date to `engine_parse_date`, a closed list of shapes pinned by `coreParseDate.test.ts`; chrono-node reads only relative phrases ([[D54]]). A day/month-ambiguous date stays `#AMBIGUOUS!` with a time after it. The plugin loads the core on `onload`.
- **Display and import reading run on the core** ([[D94]] oneNumberDisplay, [[D93]] oneTextReading): number, date and annotation formatting, the card plans, typed number and logical text, and `inferColumn` (one `engine_infer_bin` call per table, pinned by `coreInferColumn.test.ts`; imports run about 1.5x the old TS's time, about 50 ms more per 100k rows of 4 columns).
- **A graph that's done is freed** (`GraphEditor.dispose`, [[graph-core]] § The model): composites leaving their editor and the landing, scene and showcase stages free their cores, which held their whole graphs alive.
- **Big frames and lists cross the card wire as buffers** ([[node-bodies]] § The call): a 1M-row table into Get Column and its 1M-value answer back take about 0.65 s against 1.6 s over JSON.
- **A desktop Parquet file crosses IPC as one buffer**, not JSON; the core's 4 GiB ceiling is written down ([[rust-core]] § Where it runs).
- **A formula value holds no table** ([[C15]] matricesInFormulas): `V` lost `Frame`, `Cube` and `Json`; card bodies and the graph hold a card value (`Cv`, [[node-bodies]] § The call), a Cube's cells among them. A table reaching a value socket is `#VALUE!`, and both input boundaries pass a table through on every rung ([[compute-pass]] § Full coercion).
- **The chrome renders while the core loads** (`coreReady.ts`); only graph surfaces wait.
- **A card added a moment ago lands and draws** (`FlowSurface.tsx`: its move and first refresh were dropped).
- **Develop is synced at `c7da52b`** ([[rust-core]] § Tracking develop): Pele for Mermaid, Describe's Dashboard on the core.
- **The Vercel build passes on Node 24** (`@types/node` declared); CI's `vercel-build` job builds as Vercel does.
- **Module size**: 4.6 MB raw, 1.26 MB with brotli (what a browser downloads), at `opt-level = 2`, which runs as fast as 3 here.
- **Open for the author:**
  - the criteria strings' redesign (backlog § Formula library);
  - deleting the TS schedule engine ([[C69]] ganttPackages);
  - the app's size;
  - which ring a top-level session works at (`docs/dte.md` § Solenoid's rings);
  - the crate audit's trade-offs and the IronCalc oracle (backlog § Rust core);
  - TEXT answers an ISO date whatever its code (Formula.js's behavior, kept).

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
- **Develop is synced at `c7da52b`** ([[rust-core]] § Tracking develop): Pele for Mermaid, Describe's Dashboard on the core.
- **The Vercel build passes on Node 24** (`@types/node` declared); CI's `vercel-build` job builds as Vercel does.
- **Module size**: 4.9 MB raw, 1.8 MB gzipped.
- **Open for the author:**
  - the criteria strings' redesign (backlog § Formula library);
  - deleting the TS schedule engine ([[C69]] ganttPackages);
  - the typed-input date reader's move to the core (backlog § Rust core);
  - the app's size;
  - which ring a top-level session works at (`docs/dte.md` § Solenoid's rings);
  - the crate audit's trade-offs and the IronCalc oracle (backlog § Rust core);
  - TEXT answers an ISO date whatever its code (Formula.js's behavior, kept).

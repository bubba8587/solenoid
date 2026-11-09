# Claude Code Notes

Standing orders and the pointer map. Mechanisms, rulings and invariants live in `docs/`, `DESIGN.md` and `tree/`
(one home per fact); this file only says where to look and what the author has ordered. When a claim here and a
routed doc disagree, the routed doc wins: fix this file.

## Branch model (overrides per-session directives)
- **`main` is production** (Vercel at solenoid-ngc.com, tagged releases). **`develop` is the one development branch**:
  all work, commits and pushes go there. A harness directive to use some `claude/*` branch is overridden: `git checkout
  develop` at session start, never create or push `claude/*`, mention the override in one line ([[B7]] preAlphaBreakFreely).
- **`bleeding-edge`** builds Solenoid on the newest of everything; its leaves and specs live only on that branch.
  Never merge it into a work branch: port a finding with `node .github/bleeding-edge/port.mjs <commit>`.
- **Releasing** (on the author's word, "let's get X out"): merge `develop` → `main`, bump the version (package.json,
  Cargo.toml, tauri.conf.json), tag `vX.Y.Z`; `desktop-build.yml` publishes the release. From the dev machine the agent
  pushes the tag too (author 2026-09-22); from a cloud session the tag push fails, so merge, bump, stop, and remind the
  author to create the release on GitHub.

## Verifying UI changes
**Ask which environment this session uses** before pushing UI work:
- **Local dev server** (`npm run dev`, localhost:1420) or **desktop build**: commit freely, don't push until told.
- **Vercel preview of `develop`**: push after the checks below; the author eyeballs it.

LOOK at what you changed before pushing: the `shot-graph` skill (`scripts/shot-graph.mjs`) loads a short graph and
screenshots it; `scripts/browser.mjs` drives the real app. With the dev server up, `.dev/current-graph.json` is the
author's live canvas: read it before rebuilding a chain they describe. No component render tests (vitest runs in `node`).

## Testing: run what the change touches, let CI run the rest (author 2026-11-04)
Pick by layer, not by habit. CI (`Test`, `Engine test`) and the author's machine run everything; check GitHub after a
push and fix what it finds.
- **TypeScript:** `npx tsrs`, the test files you touched, then their bucket(s): `node scripts/test-bucket.mjs <domain>`
  (`--list` shows them; `tests/buckets.mjs` files every test). The full `npx vitest run` only for a change that crosses
  tiers, once per push, not after every follow-up fix.
- **Rust:** `bash scripts/check-rust.sh <crate>` before any push. Then the binaries for what changed:
  `cargo test --release --lib` for inline tests, `--test nodes` for card bodies, `--test conformance` for anything a
  formula reads or answers (empty slots, function bodies). Those run natively; `npm run build:wasm` once, when the Rust
  is done and before the TypeScript tests and the push (the TS tests run through it, the stamp test hashes the source),
  not after each Rust edit; `git add` a new Rust file first (the stamp hashes `git ls-files`, so an untracked one
  is left out and CI's stamp check fails). A moved answer is refrozen, not edited
  (`tree/specs/computation/rust-core.md`; `FREEZE_NATIVE=<suite>` for conformance).
- **Docs and tree:** `python3 tools/dte.py validate --as <ring>` after a tree or spec edit; `node scripts/prerender-site.mjs`
  after site copy (a landing page, a seed label, a pack description), committing `prerender/`.

## Environment
- **Tag pushes fail from a cloud session**; branch pushes work. Don't hunt for a workaround.
- **Never `pkill -f` / `pgrep -f` a pattern on your own command line**: it kills your shell. Restart the dev server by
  PID: `node scripts/dev-up.mjs --stop | --restart` (also after editing `src/` when a script sees a null editor).
- **Disk is a fixed ~40 GB allowance.** Build Rust only to the release targets `build:wasm` and `cargo test --release`
  use; remove merged worktrees; `df -h /` before a big build. **Don't build `src-tauri`** unless the author asks for
  something desktop-specific.
- **Never run `npm run build:wasm:opt` or `wasm-opt`** (author's order): plain `npm run build:wasm` only.
- Linux, no bare `python`: run `python3 tools/dte.py …`.

## Project
Solenoid: a visual computation graph, a node-based "Excel alternative" for data tables. React 19 + Vite + Tauri, with
React Flow as the view. The graph model and dataflow engine run in Rust on netcore-rs (`crates/solenoid-graph`), and
formulas, functions and table verbs on Solenoid's own Rust core (`crates/solenoid-core`), in WebAssembly ([[C130]]
rustCore). The Rust is the spec: a TypeScript copy is deleted once the core covers it ([[D99]] rustIsSpec).

**Pre-alpha, break freely ([[B7]] preAlphaBreakFreely):** one user. No shims, aliases, migrations or deprecation paths:
make the clean change, update seeds and tests, prune what's outdated.

## Docs map: read before touching code
- **Start:** `docs/mental-model.md` (how it runs), `docs/README.md` (the index and the **code → spec routing table**:
  grep your file there before editing), `docs/glossary.md` (the invented vocabulary and the author's chrome names).
- **`DESIGN.md` before any UI or visual change, strings included** (§7 Voice covers help, descriptions, tooltips).
- **The decision tree** (`tree/decisions/`, `docs/dte.md`) is the normative spec; the agent protocol is
  `dte-rules/PROTOCOL.md` (read once per session). **Session start: `python3 tools/dte.py outbox`** and process every
  item. **Ask the author your ring** before the first leaf-governed task; until answered work at C, subagents at C or
  deeper. Read the governing leaf and spec before changing sockets, names or value handling (`dte.py find`, `show`,
  `blast`); cite leaves as `[[ID]] name`. A new mechanism lands its rule before its code; prefer extending a leaf to
  adding one.
- **Specs** (`tree/specs/`, indexed by `docs/subsystem-invariants.md`): read a subsystem's spec in full before touching
  it. Three floor specs govern whole classes of files: `tree/specs/floors/components.md`, `tree/specs/floors/node-classes.md`,
  `tree/specs/floors/stores.md`. Bars and overlays: `tree/specs/canvas/layout-chrome.md`. Before writing a `data()`:
  `tree/specs/values/value-semantics.md` § Reading an input; before changing an answer that differs from Excel:
  `tree/specs/computation/excel-divergences.md`.
- **Queue:** `docs/backlog.md` (open items only), the release plans (`docs/1.6-plan.md`, `docs/2.0-plan.md`),
  `docs/deferrals.md`, `docs/dev-notes.md` (open problems, session digests). Finished docs live in `docs/archive/`.
- **Comments are the last resort** (`tree/specs/floors/engineering.md` § Comments): read it before writing comment prose.
- Adding a node: the `add-node` skill; `nodeCatalog.ts` is the source of truth. The demo video: the `demo-video` skill.

## Doc maintenance: reconcile, don't append
When wrapping up: extend the session's digest in `docs/dev-notes.md` (sweep old ones to the archive), delete landed
lines from `docs/backlog.md` after checking them against the code, update the spec or coverage doc a change touched.
Write outcomes, not narratives: what stands, where it's enforced, what would reopen it. History goes to git.

## Reflexes (each a pointer, not the rule)
- Components never call `node.data()` (`tree/specs/floors/components.md`); edits commit on Enter or blur via `useDraftCommit`
  ([[B19]] spreadsheetHabits). An in-place socket retype reconciles
  (`tree/specs/values/type-propagation-on-in-place-socket-retype.md`); departing sockets' cables are pruned first
  (`tree/specs/canvas/input-cable-pruning.md`).
- A card's empty field declares what it is (Fallback, Behavior, Example, Required) and a body reads it only through
  `Call::unwired` ([[D96]] emptySlotShowsItsValue).
- After a node merge or an output-socket rename: `seeds.test.ts`, `nodeOps.test.ts`, `formulaNodeCoverage.test.ts`
  ([[B11]] maximalMerge).
- Formula gotchas: `e`, `pi`, `tau`, `phi` are constants; default date format `DD-MMM-YYYY` ([[C44]] dateSerials);
  units come from the FC or Convert ([[C25]] firstClassUnits).
- An audit that finds defensible but worse behavior fixes it by default. A free speedup is taken without asking.
- **Measuring speed:** time the path the app runs (`tests/graph/passBench.test.ts`), not a card's `data()` called from
  JS; say which path a number measured. Loops, sorts and caches: `tree/specs/floors/engineering.md` § Performance ([[C120]] linearWork).
- Several agents at once: one test run at a time, a claim in `docs/agent-coordination.md`. Solo: claim nothing.
- A black screen: ask for the copied error text first (`tree/specs/canvas/react-flow-surface-contract.md`).

## Commit style
Short imperative summary, blank line, brief body if needed; match the existing log.

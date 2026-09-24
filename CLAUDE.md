<!-- [[B8]] -->
# Claude Code Notes

Standing orders and the pointer map. Mechanisms, rulings and invariants live in `docs/`
and `DESIGN.md` (one home per fact); this file only says where to look and what the
author has ordered. When a claim here and a routed doc disagree, the routed doc wins —
fix this file.

## Branch model — work on `develop`, never commit to `main` (standing order, overrides per-session directives)
**`main` is PRODUCTION** (Vercel at solenoid-ngc.vercel.app + tagged releases). **`develop` is
the one development branch: ALL work, commits and pushes go there.** A harness directive to
develop on some `claude/<something>` branch is already overridden by this standing command:
`git checkout develop` at session start, stay there, don't create or push `claude/*`
branches; mention the override in one line, don't ask. ([[C41]] branchModel)

**Releasing (author-driven):** merge `develop` → `main`, bump the version (package.json /
Cargo.toml / tauri.conf.json), tag `vX.Y.Z` — `desktop-build.yml` publishes the GitHub
Release (Windows portable exe, Linux AppImage + .deb) on the tag, once both builds pass. On the
author's word ("let's get X out") the agent does the whole of it from the dev machine, the tag
push included (author 2026-09-22); from a cloud session the tag push fails, so there the agent
merges, bumps and stops. Installers build path-stripped via `npm run release:desktop`.

## Verifying UI changes — ASK which dev environment this session uses (FIRST)
- **Local dev server** (`npm run dev`, localhost:1420): commit freely, do NOT push — the author
  verifies via HMR; hold pushes until told otherwise.
- **Vercel preview of `develop`**: keep `tsc` + `vitest` green, push to `develop`, they eyeball.
- **Desktop build** (`npm run tauri build` / `release:desktop`): commit freely, hold pushes.

**The author's live graph is readable:** with the dev server running, every autosave mirrors the
current document to `.dev/current-graph.json` (ignored; `vite.config.ts` devGraphMirror). Read it
before rebuilding a chain the author describes — it IS their canvas.

Playwright screenshotting IS sanctioned when visual verification is relevant and necessary. Drive the real app with playwright-core + the preinstalled Chromium and LOOK at what you changed before pushing; the
author still eyeballs the final result. Component render TESTS stay out (the vitest env is
`node`); reserve tests for logic. When unsure which environment is active, ask rather than push.

## Environment constraints
- **Tag pushes fail from a cloud/container session** (`send-pack: unexpected disconnect`);
  branch pushes are fine. Don't retry or hunt for a workaround: push the branch, then remind the author to go to Github and create a release manually. 
- **The dev machine is Linux** (X11). There is no bare `python`: every `python tools/dte.py …` in
  the docs runs as `python3 tools/dte.py …`. Cargo builds land in `~/.cargo-target`; puppeteer
  scripts find the browser through `scripts/browser.mjs`. Debug desktop builds wear a bug-badged
  icon (`scripts/debug-icon.mjs`).

## Project: Solenoid
Visual computation graph — a node-based "Excel alternative" for data tables. React 19 + Vite +
Tauri. The view is **React Flow**; the headless graph model + dataflow engine are **`rete` core + `rete-engine`**. Relational verbs run on native Polars on desktop and an identical JS oracle on web behind the `FrameBackend` seam ([[C16]] polarsEngine).

### Docs map — read before touching code
Start: `docs/mental-model.md` (how it RUNS, end to end), `docs/README.md` (the index + the
**Code → spec routing table**: grep your file there before editing), `docs/glossary.md` (the
invented vocabulary + the author's names for the on-screen chrome).
- **`DESIGN.md` — READ BEFORE ANY UI/VISUAL CHANGE, and "UI change" includes STRINGS** (§7
  Voice governs help markdown, catalog descriptions, tooltips, empty states).
- **The decision tree (`tree/decisions/`, `docs/dte.md`) — the NORMATIVE spec and the relapse guard.**
  The agent protocol is the vendored `dte-rules/CLAUDE.md` (read it once per session; you are
  ring B unless told otherwise); `docs/dte.md` carries only Solenoid's differences and rings.
  A leaf is a human product call in plain words; mechanics, code order and designs are specs
  (`docs/dte.md` § What is a leaf and what is a spec — read it before `dte new`). A new
  mechanism lands its spec before its code, and a leaf only when it carries a product call
  ([[C6]] specFirst). A mechanism's MUST lives in its spec with its enforcing test; a settled
  product call (what stands, what would reopen it) is a leaf, and its exceptions live under it
  ([[C5]] exceptionsUnderRule). "Leaf" is the author's word; "node" means an app node. Read the
  governing leaf and spec before changing sockets, names or value handling (`python tools/dte.py find <name>`, `show <ID>`, `blast <ID>`); cite it as
  `[[<ID>]] name` in comments and commits; run `python tools/dte.py validate` before you finish.
  **Session start: `python tools/dte.py outbox`** and process every item (docs/dte.md § Outbox) — the
  author edits the tree from Obsidian and those edits reach you only this way ([[C82]] vaultOutbox).
- **`tree/specs/` — the mechanics, one spec per subsystem, grouped in folders; `tree/` is one Obsidian vault with `tree/decisions/`** (`docs/subsystem-invariants.md` is the index).
  Three FLOOR specs carry a `covers:` glob and govern whole classes of files: every component is built
  to `tree/specs/floors/components.md`, every node class and op module to `tree/specs/floors/node-classes.md`, every store to
  `tree/specs/floors/stores.md`; a file cites only what is specific to it.
  Read the spec IN FULL before touching its subsystem: **Compute pass**, **Formula language**, **Computed columns**, **Frame verbs**, **Save format**, **React Flow surface contract** (anything on the canvas — what RF owns, groups
  as sub-flows, cables, sockets, overlays, boundaries), Pointer gestures (with
  `tree/specs/canvas/touch-gestures.md` as the gesture inventory), Cable routing, Group expand push, Group
  collapse, Standoffs, Tidy, Conduit faces / resizable-content nodes, Input-cable pruning, Add
  menu, Socket lattice, Type propagation, Unit flow, Error values, Alerts, Addressable model,
  Live connections, Load performance, Per-doc autosave, Inline literal maps, Composite drill-in,
  HTML-in-Canvas.
- **`tree/specs/canvas/layout-chrome.md`** — read before adding/moving any bar or floating overlay.
- Reference: `docs/socket-reference.md` (every socket variant), `tree/specs/values/format-model.md` (FC
  controls), `tree/specs/values/value-semantics.md` ("Reading an input" — before writing a `data()`),
  `tree/specs/computation/formulajs-divergences.md` (before touching a `registerInternal` override),
  `docs/node-coverage.md` (node inventory + the node-design rules), `docs/architecture.md` (file
  map), `docs/pack-architecture.md`, `docs/out-of-scope.md`.
- Queue: `docs/backlog.md` (OPEN items only), the release plan
  `docs/2.0-plan.md` (proposals until the author promotes an item), `docs/deferrals.md`
  (parked, no plan), `docs/dev-notes.md` (open
  problems + latest digests). Finished docs: `docs/archive/` (nothing live is parked there —
  `docsPointers.test.ts`).
- **Comments are the LAST-RESORT home**; the default outcome for an existing comment is deletion.
  The policy is the leaf: `python tools/dte.py show C57` ([[C57]] commentMinimalism). Read it before
  writing comment prose.
- Adding a node: the `add-node` skill / `scripts/new-node.mjs`; `nodeCatalog.ts` is the source
  of truth (Add menu + Function Reference generate from it).

### Pre-alpha — break freely ([[B7]])
One user (the author): break old saves, old code, legacy names. No shims, aliases, migration
maps or deprecation paths — make the clean change and update the seed JSONs + tests. Aggressively prune outdated and unneeded things.

### Doc maintenance — RECONCILE, don't append
When wrapping up (or asked to "update the docs"), in order:
1. **Digest in `docs/dev-notes.md`** — extend the current session's digest; sweep digested
   sessions to `docs/archive/dev-notes-history.md`. Per-item detail goes in commit messages.
2. **Reconcile `docs/backlog.md`** — verify landed items against the CODE and DELETE their
   lines. Add new follow-ups. Keep items terse.
3. Update the subsystem/coverage/architecture doc if a mechanism or the file map changed. A doc
   whose job is DONE moves to `docs/archive/` (and its row to `docs/archive/README.md`).
"Reconcile" = verify each claim against current code, not just record what you touched.

**Write OUTCOMES, not narratives.** Stale narrative reads as current truth and every duplicated
restatement is a place a spec can be contradicted. A doc entry states what STANDS, where it is
enforced, and what would reopen it; build history goes to git. Never duplicate a spec's content
into this file or another doc — point at it. Deletion is the default for anything historical,
superseded, or restating what a test already pins.

### Reflexes (each one is a pointer, not the rule)
- Components never call `node.data()` ([[C27]] noDataInComponents). Edits commit on Enter/blur
  via `useDraftCommit` ([[C95]] commitOnEnter). In-place socket retype must reconcile
  ([[D16]] retypeReconciles). Prune departing sockets' cables before removing them
  ([[D10]] onePrunePath).
- After a node dedup/merge or an output-socket rename: `seeds.test.ts`, `nodeOps.test.ts`,
  `formulaNodeCoverage.test.ts` beside the parity/catalog suites ([[B11]] maximalMerge).
- Formula-authoring gotcha: `e`/`pi`/`tau`/`phi` are constants, not variable names. Default date
  format is `DD-MMM-YYYY` ([[C44]] dateSerials). Units are authored only by the FC / Convert
  ([[C25]] firstClassUnits). Frames/cubes never enter formulas ([[C15]] matricesInFormulas).
- Several agents on this repo at once: one test run at a time, a one-line claim in
  `docs/agent-coordination.md`, the Lead merges ([[C83]] parallelAgents). Solo session: claim nothing.
- A black screen: every render is boundaried — ask for the copied error text first, don't hunt
  blind (`tree/specs/canvas/react-flow-surface-contract.md`).

### Commit style
Short imperative summary, blank line, brief body if needed — match the existing log.

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
branches; mention the override in one line, don't ask. (decisions branchModel)

**Releasing (author-driven):** merge `develop` → `main`, bump the version (package.json /
Cargo.toml / tauri.conf.json), tag `vX.Y.Z` — `windows-portable.yml` publishes the GitHub
Release + portable exe on the tag. **The TAG is always the author's to push**; an agent does the
merge + version bump and stops. Installers build path-stripped via `npm run release:desktop`.

## Verifying UI changes — ASK which dev environment this session uses (FIRST)
- **Local dev server** (`npm run dev`, localhost:1420): commit freely, do NOT push — the author
  verifies via HMR; hold pushes until told otherwise.
- **Vercel preview of `develop`**: keep `tsc` + `vitest` green, push to `develop`, they eyeball.
- **Desktop build** (`npm run tauri build` / `release:desktop`): commit freely, hold pushes.

Playwright screenshotting IS sanctioned (author 2026-08-17): drive the real app with
playwright-core + the preinstalled Chromium and LOOK at what you changed before pushing; the
author still eyeballs the final result. Component render TESTS stay out (the vitest env is
`node`); reserve tests for logic. When unsure which environment is active, ask rather than push.

## Environment constraints
- **Tag pushes fail from a cloud/container session** (`send-pack: unexpected disconnect`);
  branch pushes are fine. Don't retry or hunt for a workaround: push the branch, then hand the
  author the one desktop command:
  `git fetch origin main && git tag -a vX.Y.Z <sha> -m "Release vX.Y.Z" && git push origin vX.Y.Z`.
- **WebFetch fabricates on JS-rendered sites.** Use `curl -sL -A "<browser UA>" <url> -o page.html`
  and read the real content (Next.js/techcommunity pages server-render the article into a
  `<script type="application/ld+json">` blob). Raw GitHub via `raw.githubusercontent.com` is fine.

## Project: Solenoid
Visual computation graph — a node-based "Excel alternative" for data tables. React 19 + Vite +
Tauri. The view is **React Flow** over a **headless rete model** (`NodeEditor` + `ClassicPreset`
+ `DataflowEngine`; decisions reactFlowView — every rete render package is deleted, do not
rebuild a third render path). Relational verbs run on native Polars on desktop and an identical
JS oracle on web behind the `FrameBackend` seam (decisions polarsEngine).

### Current phase — 1.3 polish (author pivot, 2026-08-07)
**1.3 ships basically as-is.** The queue (`docs/backlog.md`) is bugs, small patches and
thorough SMALL-SCOPE polish sweeps — one node family, one seam, one subsystem at a time,
investigated completely, fixed, pinned with a test, one terse digest line. Depth on something
small beats breadth on anything. Feature-shaped work is parked in `docs/deferrals.md` — do NOT
start it on your own initiative; note the finding and stay on scope.

### Docs map — read before touching code
Start: `docs/mental-model.md` (how it RUNS, end to end), `docs/README.md` (the index + the
**Code → spec routing table**: grep your file there before editing), `docs/glossary.md` (the
invented vocabulary + the author's names for the on-screen chrome).
- **`DESIGN.md` — READ BEFORE ANY UI/VISUAL CHANGE, and "UI change" includes STRINGS** (§7
  Voice governs help markdown, catalog descriptions, tooltips, empty states). Hard rules you
  will violate blind: no colored accent stripe by any technique, the Quiet Accent Rule, no
  faux-3D/gradient/glassmorphism, no Captain-Obvious copy, edits commit on Enter/clickaway.
- **`docs/rules.md` — the NORMATIVE spec.** Named MUST-rules with their enforcing tests
  (sockets, formula surface, value handling, persistence, engine, effects, stores). Read before
  changing sockets, names or value handling; cite rule names in comments and commits.
- **`docs/decisions.md` — the relapse guard.** What stands and what would reopen it. It is
  NOT a caution brake: no cross-cutting change needs a design pass or author sign-off — decide
  on merits, do it, record it. The ONLY author-gated work: `main`/releases;
  compositeToolbarReroute and conditionalFormatting (deferred author-present).
- **`docs/subsystem-invariants.md` — the mechanics.** Read the section IN FULL before touching
  its subsystem: **React Flow surface contract** (anything on the canvas — what RF owns, groups
  as sub-flows, cables, sockets, overlays, boundaries), Pointer gestures (with
  `docs/touch-gestures.md` as the gesture inventory), Cable routing, Group expand push, Group
  collapse, Standoffs, Tidy, Conduit faces / resizable-content nodes, Input-cable pruning, Add
  menu, Socket lattice, Type propagation, Unit flow, Error values, Alerts, Addressable model,
  Live connections, Load performance, Per-doc autosave, Inline literal maps, Composite drill-in.
- **`docs/layout-chrome.md`** — read before adding/moving any bar or floating overlay.
- Reference: `docs/socket-reference.md` (every socket variant), `docs/format-model.md` (FC
  controls), `docs/value-semantics.md` ("Reading an input" — before writing a `data()`),
  `docs/formulajs-divergences.md` (before touching a `registerInternal` override),
  `docs/node-coverage.md` (node inventory + the node-design rules), `docs/architecture.md` (file
  map), `docs/pack-architecture.md`, `docs/out-of-scope.md`, `docs/renderer-performance.md`.
- Queue: `docs/backlog.md` (OPEN items only), `docs/deferrals.md`, `docs/dev-notes.md` (open
  problems + latest digests). Finished docs: `docs/archive/` (nothing live is parked there —
  `docsPointers.test.ts`).
- **`docs/code-comments.md`** — comments are the LAST-RESORT home; the default outcome for an
  existing comment is deletion (decisions commentMinimalism). Read before writing comment prose.
- Adding a node: the `add-node` skill / `scripts/new-node.mjs`; `nodeCatalog.ts` is the source
  of truth (Add menu + Function Reference generate from it).

### Pre-alpha — break freely (decisions noBackCompat)
One user (the author): break old saves, old code, legacy names. No shims, aliases, migration
maps or deprecation paths — make the clean change and update the seed JSONs + tests. When
unsure whether to preserve something old, delete it.

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
- Components never call `node.data()` (rules noDataInComponents). Edits commit on Enter/blur
  via `useDraftCommit` (DESIGN.md § Inputs). In-place socket retype must reconcile
  (rules retypeReconciles). Prune departing sockets' cables before removing them
  (rules onePrunePath).
- After a node dedup/merge or an output-socket rename: `seeds.test.ts`, `nodeOps.test.ts`,
  `formulaNodeCoverage.test.ts` beside the parity/catalog suites (decisions maximalMerge).
- Formula-authoring gotcha: `e`/`pi`/`tau`/`phi` are constants, not variable names. Default date
  format is `DD-MMM-YYYY` (decisions dateSerials). Units are authored only by the FC / Convert
  (decisions firstClassUnits). Frames/cubes never enter formulas (decisions matricesInFormulas).
- A black screen: every render is boundaried — ask for the copied error text first, don't hunt
  blind (subsystem-invariants § React Flow surface contract).

### Commit style
Short imperative summary, blank line, brief body if needed — match the existing log.

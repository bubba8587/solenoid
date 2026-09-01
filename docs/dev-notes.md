# Solenoid dev notes

Running notes on direction, deferred work, and non-obvious technical gotchas.
Live window: the current sessions' DIGESTS + open problems ONLY. Digested
sessions sweep verbatim to `archive/dev-notes-history.md` — read a digest here
first; drill into the archive (or `git log`) only for the mechanics of a
specific item.

### SESSION DIGEST (2026-09-01 — 1.3 shipped; the 1.4 / 2.0 planning pass)

**1.3 is released** (v1.3.0 on `main`; the author: `develop` is level with it). The backlog's
"Cut 1.3" tail is deleted; the backlog is retitled to 1.4 and carries only the two
ratifications (the 1.4 cut, `out-of-scope.md`) plus the ARR pass.
**The deferral review ran as a planning pass.** Every parked, deferred and author-gated idea
(deferrals, the 2.0 flagships, the v2.0 bundles, the pack-composite queue, the open
python-r-gap item) was walked and scored on one rubric — strength, relevance,
complexity, blast radius; no time estimates by order — and placed: **`1.4-plan.md`** (new: the
workbench release — what-if surgery pin/mute/peek/cone + an Optimize run mode, the Record and
table lifts, the widget nodes behind a per-document network permission, the surface
hardening: allowlist A, node-combining round 2, ARR, AI palette back on; every item with a
grounded plan, tests, gate and done-definition; a consolidated author-call list), and
**`2.0-plan.md`** (rewritten: pages, collaboration, the transpiler, conditional formatting,
canvas at scale, value-model extensions, packs as a program, Gantt; the cross-cutting
prerequisites it surfaces — save-format freeze + migration seam, trust on open, desktop
updater, the web-target decision, version history + diff, an accessibility baseline).
Four new bundle docs: `v2.0/20-pages.md` (one editor/engine, pages as view scopes, cross-page
cables as portal stubs), `v2.0/21-collaboration.md` (the author's new surface — accounts,
cloud saves, multiplayer — staged 0→3, Stage 0 serverless and 1.4-pullable; states plainly
what a service costs; the CRDT keyed by the addressable model's names; the trust-on-open security
work), `v2.0/22-canvas-at-scale.md` (headless card metrics → virtualization → worker HIC),
`v2.0/23-conditional-formatting.md` (design-pass prep: a rule is a graph value).
**Reconciles:** `deferrals.md` shrunk to parked-with-no-plan (planned entries moved into the
plans — one home per fact); `release-notes-features.md` reset to the 1.4 shell (the 1.3 list
is at the v1.3.0 tag); **`out-of-scope.md` test 3 / §3 / §11 and decisions R5 rewritten to
the collaboration order** — first framed as "the order reverses them", corrected same
session on the author's point: that doc carries no ARR (`authorRuled`: nothing outside
`rules.md` does) and is a DRAFT, so the "stay out" was agent inference and the order is
the first ruling on that ground — nothing to reverse, only an inference to correct; bundle 08's
"sheets → Groups" becomes "sheets → pages"; bundle 16's status points at 1.4 C1; the docs
index and the v2.0 index list the new docs. Findings from the pass worth a line: the
compositeToolbarReroute flagship is mostly delivered by the RF port's `activeGraph` seam —
1.4 E2 is an audit, not a build; Solver parity fits as a composite RUN MODE (Goal Seek
generalized), not a node; the Excel transpiler's best-fidelity path is Excel Tables →
Frame Inputs with computed columns (structured refs ≈ tableRefSemantics).
**Awaiting the author:** the 1.4 cut; the out-of-scope ratification (now a rewrite of three
sections); the calls listed at the end of `1.4-plan.md` and in `v2.0/21` § Open author calls.

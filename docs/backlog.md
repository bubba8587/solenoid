# Solenoid — Backlog (1.4)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **1.3 shipped** (v1.3.0 on `main`; `develop` is
level with it). **The 1.4 cut is PROPOSED, not ratified:** `1.4-plan.md` scores every
deferred idea and carries the per-item plans; nothing there is scheduled until the author
promotes it — a promoted item becomes a line here and its plan section is the spec. The
structural arcs are `2.0-plan.md` + `v2.0/`; parked-with-no-plan items: `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-08-26): the walkable set is on latest in-range (`react` 19.2.8,
`vitest` 4.1.11, `vite` 8, etc. — git has the walk); the rete RENDER packages and
`styled-components` were removed outright by the React Flow cutover (rete core
2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react` remain). Remaining major:
`@anthropic-ai/sdk` 0.120 (skipped). The `.npmrc` `legacy-peer-deps` workaround is
REMOVED — the old elkjs-vs-rete-auto-arrange peer conflict left with the plugin
(clean `npm install` dry-run verified).

## Release planning (author-run)

- [ ] **Ratify the 1.4 cut** — walk `1.4-plan.md` (the IN / PULLABLE / AUTHOR columns; the
  consolidated author-call list is its last-but-one section) and `2.0-plan.md`; promoted
  items land here as lines.
- [ ] **Ratify `out-of-scope.md`** (DRAFT since July, no ARR anywhere in it) — the deferral
  review's standing ask. Test 3 / §3 / §11 already read the author's 2026-09-01 order
  (collaboration IN); the rest is still the agent's inference awaiting the author's word.
- [ ] **The `rules.md` ARR pass** (author-present; the author: waits for 1.4) — early in the
  release, before the track work adds rules (`1.4-plan.md` D3).

## Canvas & chrome

- [ ] **Canvas cursor: standard pointer on hover, pan-hand only while panning** (React Flow
  port consequence — RF sets the grab cursor everywhere). Keep the pan-hand for Canvas Lock;
  otherwise a plain pointer on hover and the grab cursor only during an actual pan drag.
- [ ] **Popup card border sits 1px inward** of the header overhang + the grouped corner
  indicator (the corner then reads ~0.5px proud of the modal corner). Card border should be
  1px larger in all directions to line up. (Being looked at with the resize work.)

## Input & modals

- [ ] **Keystroke guards on modals / pop-ups** (maybe a React Flow port symptom). Canvas
  shortcuts leak through open overlays: with a Frame Input pop-up open, `A` still opens the
  Add menu behind it; with a Tidy/Cleanup confirm modal up, `Enter` both confirms the modal
  AND opens the Command Palette. The canvas key handler should stand down while a
  modal/popup owns the keyboard.

## Layout

- [ ] **Flipped-node Tidy places it up-and-left; want down-and-left.** The predecessor
  hack (reversed ELK edge) leaves the flipped node's vertical order to ELK crossing-min,
  which stacks it above its neighbor. Needs a within-layer ordering lever (position
  choice / model order) to bias it below. Cosmetic; the leftward part is correct.
- [ ] **Convergence loop for Tidy/Cleanup (optional).** The author asked for a loop that
  re-runs until positions stop shifting or a short timeout, as a determinism hedge. The
  locked-group + Standoff root cause is fixed (pinned in the solve), so verify whether
  drift still shows before adding the loop — it wraps a rAF-deferred pipeline, so it's
  not free.

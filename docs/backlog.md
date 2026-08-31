# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **The 1.3 cut (author, 2026-08-30):** user-facing
polish and perf are DONE; what ships 1.3 is this list's easy under-the-hood work plus
the release tail. Everything feature-shaped or author-gated lives in `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Dependency updates (walking them one at a time; TypeScript 7 landed 2026-08-11a)

Current state (2026-08-26): the walkable set is on latest in-range (`react` 19.2.8,
`vitest` 4.1.11, `vite` 8, etc. — git has the walk); the rete RENDER packages and
`styled-components` were removed outright by the React Flow cutover (rete core
2.0.6 + rete-engine + elkjs 0.12 + `@xyflow/react` remain). Remaining major:
`@anthropic-ai/sdk` 0.120 (skipped). The `.npmrc` `legacy-peer-deps` workaround is
REMOVED — the old elkjs-vs-rete-auto-arrange peer conflict left with the plugin
(clean `npm install` dry-run verified).

## Release tail (author-run)

- [ ] **Deferral review (author-present)** — walk `deferrals.md` (now incl. the
  Pushed-to-1.4/2.0 section) and ratify/amend `out-of-scope.md` (still DRAFT).
- [ ] **Cut 1.3**: everything is green and smoked (web build + vitest + cargo
  2026-08-30; `release:desktop` + Script-on-desktop exe smoke + real-Excel finance
  goldens 2026-08-31); `develop` is merged to `main`. Left (author): push `develop`
  and `main`, tag `v1.3.0` (`windows-portable.yml` publishes on the tag).

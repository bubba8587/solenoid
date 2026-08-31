# Solenoid — Backlog (1.3)

**OPEN items only, kept terse.** When an item lands, DELETE its line — git history and
the dev-notes digests are the record. **The 1.3 cut (author, 2026-08-30):** user-facing
polish and perf are DONE; what ships 1.3 is this list's easy under-the-hood work plus
the release tail. Everything feature-shaped or author-gated lives in `deferrals.md`;
ruled-out ideas: `out-of-scope.md`; settled rationale: `decisions.md`.

## Awaiting the author

- [ ] **Finance absolute-value verification — ODDF retest is the remainder (real
  Excel).** The 2026-08-31 golden run confirmed COUP*, ACCRINT/ACCRINTM, VDB
  (fractional included), MDURATION (Microsoft's published 5.7355689 IS a doc typo;
  real Excel returns our 5.7356698) and, after two fixes it caught (ACCRINT basis-2
  denominator; ODDLPRICE simple-interest discounting), ODDLPRICE/ODDLYIELD — all
  pinned in `financeInvariants.test.ts`. Left: ODDFPRICE/ODDFYIELD — the first run's
  parameters had the first coupon off the maturity's cycle, which Excel #NUM!s. Check:
  `=ODDFPRICE(DATE(2024,1,25),DATE(2031,1,1),DATE(2023,11,11),DATE(2024,7,1),0.0575,0.06,100,2,0)`
  → ours 103.824908; `=ODDFYIELD(…same…,0.0575,98,100,2,0)` → ours 0.0708241. Pin on
  confirmation. (We don't validate that alignment — noted parity:false in nodeExcel.)
- [ ] **Script on desktop**: `'unsafe-eval'` added to the Tauri CSP for the sandbox worker
  and the main-thread compile; untested on a desktop build. Author: place a Script,
  `(x) => x * 2` with x = 21 should read 42, not a CSP refusal.

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
- [ ] **Keep `release-notes-features.md` current** — the 1.3 selling list.
- [ ] **Cut 1.3**: version is bumped to 1.3.0 and the web build + vitest + cargo are
  green (2026-08-30). Left: path-stripped `release:desktop` + exe smoke (Script on
  desktop, above), merge → `main`, tag `v1.3.0`.

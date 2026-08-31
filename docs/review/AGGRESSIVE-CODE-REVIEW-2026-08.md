# Solenoid — Aggressive Code Review (2026-08-09)

> Commissioned brief: "review it as aggressively as you can." Fine. What follows is
> adversarial, evidence-first, and ranked by how much it should sting. Every claim
> cites `file:line` and, where the bug is subtle, was reproduced. No vibes, no
> hand-waving — the point of an aggressive review is to be *right*, because a correct
> criticism is far more uncomfortable than an insult.

## The one-paragraph verdict

This is not a bad codebase. That is the most damning thing I can say about it,
because it means the flaws below are *unforced*. Someone who clearly knew what they
were doing — 4,118 passing tests, a clean `tsc`, a genuinely thoughtful lazy
frame-fusion engine with a Rust/JS parity oracle — also shipped an **80 MB unused
production dependency**, **36 lint-suppression comments for a linter that isn't
installed**, **mojibake corruption sitting in a shipped source file**, a
**silent-data-loss autosave** the moment a user opens a second browser tab, and a
**desktop file/network capability surface** wide enough to turn "open this graph" into
"read my home directory." The engineering talent is real; the discipline is
inconsistent, and the seams show exactly where attention lapsed.

---

## Severity ledger

| # | Severity | Finding | Where |
|---|----------|---------|-------|
| 1 | **High** | Second browser tab silently clobbers autosaves — no cross-tab coordination | `documentStore.ts` |
| 2 | **High** | Desktop capability surface: any-URL fetch + read any `$HOME/**/*.{json,csv,md}` | `capabilities/default.json`, `httpBridge.ts` |
| 3 | ~~High~~ **FIXED** | 6 dependency vulns (3 High) in the build chain — `npm audit fix`, now `0 vulnerabilities`; vite→7.3.6 | `npm audit` |
| 4 | **Med (reframed)** | Non-finite key collapse isn't a JS↔Polars *divergence* (it's the deliberate B-1a contract) — but it IS inconsistent with how sort/aggregation treat these values; backlogged for de-grouping | `frameVerbs.ts` |
| 5 | ~~Med~~ **FIXED** | 80 MB `pixi.js` production dependency with zero imports — removed | `package.json` |
| 6 | **Med** | 36 `eslint-disable` directives; no ESLint (or any linter) configured or installed | repo-wide |
| 7 | ~~Med~~ **FIXED** | `fetchText` reads unbounded response bodies into a string (OOM) — now capped at 64 MB with a streaming abort | `httpBridge.ts` |
| 8 | **Low** | Periodic IRR omits the rate clamp its dated twin has (asymmetric robustness) | `finance.ts:446` |
| 9 | ~~Low~~ **FIXED** | Mojibake: 13 corrupted lines in a shipped source file — re-encoded to proper `─`/`→` | `nodes/finance.ts` |
| 10 | **Low** | Full-graph `fetch` loop + adjacency rebuild on every value edit | `process.ts` |
| 11 | **Low** | God files: five source files over 1,600 lines each | `nodes/list.ts` et al. |
| 12 | **Low** | `dangerouslyAllowBrowser` + hardcoded model in the AI client | `aiService.ts:87` |

---

## The findings, with receipts

### 1. HIGH — Open two tabs, lose your work. Silently.

`documentStore.ts` persists to `localStorage` through a two-slot rotation per document
(`persist()`, line 106) and reads the newest slot on startup. There is **no
`storage`-event listener and no `BroadcastChannel`** anywhere in the source:

```
$ grep -rn "BroadcastChannel|addEventListener(\"storage\"" src   →  (nothing)
```

Consequence: open Solenoid in two tabs. Tab A autosaves doc X. Tab B, which loaded the
old state, autosaves 700 ms later (`persistence.ts:548`, `AUTOSAVE_DELAY`) and
overwrites tab A's slot with stale content. The in-memory `_lastPersisted` identity
map (line 41) means tab B has no idea the on-disk bytes changed underneath it. This is
the single most likely way a real user loses real work, and it isn't guarded, warned,
or even acknowledged in the code. For an app whose entire value proposition is "your
data table," silent data loss is the cardinal sin.

### 2. HIGH — "Open this graph" is a bigger trust decision than it looks

The desktop capability manifest (`src-tauri/capabilities/default.json`) grants the
webview:

- `fs:allow-read-text-file` on `$HOME/**/*.json`, `$HOME/**/*.csv`, `$HOME/**/*.md`
- `fs:allow-read-dir` on **`$HOME/**`** (enumerate the entire home tree)
- `http:default` allowing **`http://**` and `https://**`** — literally any URL

Meanwhile `httpBridge.ts` (line 27-32) routes fetches through the Tauri HTTP plugin,
which **bypasses the app CSP entirely** (the CSP's `connect-src` allowlist in
`tauri.conf.json:23` only constrains the webview's own `fetch`, not the Rust plugin).
A `.solenoid` document is just shareable JSON describing nodes; a hostile one can wire
a file-reading node to a Web-Source/Data-Feed node and, on the victim simply *opening
the file*, read any `~/**/*.json` (think other apps' tokens, `.aws`-adjacent configs,
exported secrets) and ship it to an attacker origin. `CLAUDE.md`'s "one user, the
author" posture explains why this hasn't bitten anyone — but it is a latent
capability-confused-deputy hole, and it should be named in `docs/` rather than
discovered later. At minimum: scope the fs globs to a documents directory and stop
allowing cleartext `http://`.

### 3. ~~HIGH~~ FIXED — The build chain ships known vulnerabilities

> **Resolved 2026-08-09:** `npm audit fix` applied (vite → 7.3.6); `npm audit` now
> reports `0 vulnerabilities`.


```
$ npm audit
6 vulnerabilities (1 low, 2 moderate, 3 high)
  vite 7.0.0–7.3.3   (server.fs.deny bypass; launch-editor NTLM hash disclosure)
  postcss            (GHSA-fxqj-rqcc-2cmp)
```

All fixable with `npm audit fix`. Dev-time only, yes — but "we knew and didn't run the
one-liner" is not a good look for a project this otherwise-tested.

### 4. ~~MEDIUM~~ RETRACTED — "Your grouping key thinks infinity equals NaN"

> **RESOLVED 2026-08-22.** The inconsistency this item ends on was fixed: +∞, −∞ and
> NaN now each key into their own bucket on both engines, null keeps its own. B-1a is
> re-cut, corpus and pins with it. Everything below is the record of the reasoning.

**I was wrong, and the review process is only honest if it says so.** My original claim:
`encodeCell` → `JSON.stringify` serializes every non-finite number to `null`
(reproduced: `JSON.stringify(["#", Infinity]) === '["#",null]'`, same for `-Inf`/`NaN`),
so `distinctRows` and `groupByFrame` collapse `+Inf`/`-Inf`/`NaN` into one key. I framed
that as a silent JS↔Polars *divergence*.

It is the opposite. The collapse is a **deliberate, documented, cross-backend
*contract*** — spec point **B-1a** (2026-07-05) — and it is pinned on *both* engines:

- `frameVerbs.test.ts:42` — `describe("distinct — the cross-backend key contract (B-1a…)")`
- `fixtures/frame-verbs/{distinct,groupBy}.json` — explicit cases named *"all non-finite
  key values share ONE bucket, apart from null (B-1a)"*, run by **both** the JS oracle
  and the Polars/Rust engine (`src-tauri/src/engine/tests.rs`) against the same fixtures.
- `docs/archive/dev-notes-history.md` records *why*: an earlier version genuinely diverged
  ("the oracle's B-1a bucket matched NaN to −∞; Polars [differed]"), and grouping all
  non-finite as one bucket with null on its own was the **fix** that made them agree.

So the two engines don't disagree here — they were deliberately made to agree. My
"silent divergence" framing was wrong; a suspicious-looking encoding is not automatically
a bug when a spec and a cross-engine fixture already bless it.

**But there's a real finding underneath the wrong one.** The collapse is consistent
*between web and desktop*, yet it is **inconsistent with how the rest of the app treats
these same values**:

| value | Sort | Aggregate / `guardFinite` | Group / Distinct key |
|---|---|---|---|
| +Inf | high end | passes through as a real value | ⎫ |
| −Inf | low end | passes through as a real value | ⎬ one shared bucket |
| NaN | tail, with blanks | poisons the group → `#DOMAIN!` | ⎭ |
| null/blank | tail, with NaN | skipped | its own bucket |

Sort puts +Inf and −Inf at *opposite ends*; grouping calls them the same key. Aggregation
draws a hard line between NaN (an error) and a real infinity (a value); grouping erases
it. And the dev-notes (2026-07-05, pt 5) show the desktop engine *originally grouped
inf/−inf/NaN separately* — the behavior that matches sort — and was bent to match the
web version's `JSON.stringify` quirk, then blessed as B-1a. So the contract standardized
on the odd one out.

Rare in practice (most non-finites become `#OVERFLOW!`/`#DOMAIN!` errors before they
reach a frame cell), so it's edge-case, not urgent — but it's a genuine internal
inconsistency, not a non-issue. **Backlogged** (`docs/backlog.md`, "De-group non-finite
keys") to change grouping to match the rest of the app: +Inf, −Inf each their own bucket,
all NaN together, null its own — which also re-aligns with Polars' native semantics. It's
a deliberate spec change (re-cuts the B-1a contract + corpus on both engines), left as-is
for now by author call.

### 5. ~~MEDIUM~~ FIXED — An 80 MB corpse in `dependencies`

> **Resolved 2026-08-09:** `pixi.js` removed from `package.json` (10 packages dropped
> from the install); `tsc` and the full test suite stay green.


```
$ grep -rn "from \"pixi.js\"" src   →  (nothing)
$ du -sh node_modules/pixi.js       →  80M
package.json:40  "pixi.js": "^8.19.0"   ← in "dependencies", not "devDependencies"
```

`CLAUDE.md` itself says "the pixi renderer is DEPRECATED — do not maintain it," and
`sourceInvariants.test.ts:21` skips a `"pixi"` entry. The renderer is gone; the 80 MB
dependency is not. It is declared as a *runtime* dependency, so it advertises a need
that doesn't exist and bloats every clean install. Delete it.

### 6. MEDIUM — 36 salutes to an officer who left the building

```
$ grep -rn "eslint-disable" src | wc -l   →  36
$ ls node_modules/.bin | grep eslint      →  (nothing installed)
   (no .eslintrc, no eslint in package.json, no biome, no prettier config)
```

Thirty-six `// eslint-disable-next-line react-hooks/exhaustive-deps` and friends,
suppressing a linter that is neither configured nor installed. These comments are pure
cargo cult — they do nothing except imply a quality gate that isn't there. Either wire
up ESLint (and then those suppressions become meaningful and reviewable) or delete the
theater. Shipping suppressions for a nonexistent linter is worse than having neither.

### 7. ~~MEDIUM~~ FIXED — `fetchText` will happily eat all your RAM

`httpBridge.ts` did `await res.text()` with no `Content-Length` check and no cap.
A Data-Feed/Web-Source pointed at a multi-GB endpoint (or a hostile server streaming
forever) buffered the entire body into a single JS string and OOMed the tab.

> **Resolved 2026-08-09:** both transports (Tauri plugin + browser `fetch`) now route
> through `readCappedText`, which (a) rejects an oversized `Content-Length` before
> reading a byte, (b) streams via the body reader with a running counter and
> `reader.cancel()` the instant it crosses `MAX_FETCH_BYTES` (64 MB), and (c) falls
> back to a post-read size gate when no stream reader is exposed. Two tests added
> (`httpBridge.test.ts`): header-based rejection (asserts the body is never buffered)
> and a normal under-cap body still returning.

### 8. LOW — One IRR was hardened, its identical twin was forgotten

`finance.ts` has two Newton solvers. The dated variant clamps each step to stay in
domain: `r = Math.max(-0.9999, r);` (line 503). The periodic variant (lines 446–466)
does **not** — so Newton can walk `rate` below −1, making `Math.pow(1+rate, t)`
alternate sign and the derivative go to garbage. It usually still bails to `#CONV!`, so
it's not catastrophic, but the asymmetry is a tell: the two code paths were written/
patched at different times and never reconciled. Two near-identical solvers begging to
be one.

### 9. ~~LOW~~ FIXED — There is literal garbage in a shipped file

> **Resolved 2026-08-09:** all 13 lines re-encoded to proper `─` dividers and `→`
> arrows (the two corrupted lines were user-visible `DOLLARDE`/`DOLLARFR`
> descriptions, not just comments).


`src/graph/nodes/finance.ts` contains 13 lines of mojibake — UTF-8 box-drawing
characters mangled through a bad encoding round-trip — in section dividers and the
`IRR`/`MIRR` header comments (e.g. line 409, 517: `â”€â”€â”€ IRR â”€â”€â”€…`). The
adjacent `NPV` divider (line 329) is clean `─── … ───`, so the file was half-corrupted
by an editor that didn't agree with itself about encoding. It compiles, so nobody
looked. It's cosmetic, and it's exactly the kind of cosmetic that says "no one read
this file after saving it."

### 10. LOW — Every value edit does more work than it needs to

`process.ts runGraphPass` iterates **all** nodes and `await`s `_engine.fetch(node.id)`
one at a time (lines 495–496), even on a targeted single-node edit — the cache makes
each unaffected fetch cheap, but it's still an O(all-nodes) serial await per commit.
`downstreamClosure` (line 378) rebuilds the entire outgoing-adjacency map from
`editor.getConnections()` on every value edit, and the render-cutoff block builds a
second full adjacency map (line 519). On a large graph these per-keystroke-commit
full-graph walks are avoidable with an incrementally maintained adjacency index. Fine
today; a scaling cliff later.

### 11. LOW — Files that have stopped being files and become neighborhoods

```
nodes/list.ts        1,984
nodes/frame.ts       1,884
frameVerbs.ts        1,780
excelFunctions.ts    1,731
Canvas.tsx           1,658
```

128,762 lines of TypeScript across 838 files for a node editor. The big ones aren't
*wrong* — they're internally organized — but a 1,984-line node module is a merge-
conflict magnet and a reviewer-hostile wall. `Canvas.tsx` with 16 `useEffect`s in one
component is doing the job of five components.

### 12. LOW — AI client footguns

`aiService.ts:87` sets `dangerouslyAllowBrowser: true` (intentional — it's the user's
own key, on their device, documented at line 87), and the model is hardcoded
`AI_MODEL = "claude-opus-5"` (line 11) with the user's key sent straight to the
provider from `localStorage` plaintext (`apiKeyStore.ts`). All defensible for a
single-user local app, all worth stating out loud in a threat-model note rather than
leaving as a "trust me" in a comment.

---

## Credit where the receipts demand it

An honest aggressive review has to concede what's good, or the criticism is just noise:

- **The frame engine is genuinely well-designed.** Lazy `FrameRef` plans fused into one
  Polars round trip (`frameBackend.ts`), memoized per-pass by ref identity (not handle),
  with `WeakRef` + `FinalizationRegistry` cleanup and a JS oracle kept in lock-step with
  Rust via a parity corpus. That's real engineering.
- **The Rust engine is defensive** where it counts — the one `partial_cmp().unwrap()`
  (`engine.rs:1903`) is guarded by an `is_finite` filter first; the as-of join was
  hand-rolled specifically because Polars' kernel diverged from the oracle in three
  documented ways.
- **4,118 tests pass, `tsc` is clean, zero `@ts-ignore`, exactly four `as any`.** The
  discipline exists. It's just applied unevenly — which is why the lapses above read as
  carelessness rather than incapacity.

## If you fix five things this week

1. Cross-tab autosave guard (#1) — a `storage` listener that reloads or warns. Data
   loss beats everything. **(still open)**
2. ~~`npm audit fix` (#3)~~ — **done** (0 vulnerabilities).
3. ~~Delete `pixi.js` from `dependencies` (#5)~~ — **done** (10 packages dropped).
4. Either install ESLint or delete the 36 fake suppressions (#6). **(still open)**
5. ~~Fix the non-finite key encoding in `frameVerbs.ts` (#4)~~ — **retracted**: the
   collapse is the deliberate B-1a cross-backend contract, not a bug.

Fixed in the same pass that filed this review: #3, #5, #7, #9 — plus #4 investigated and
**retracted** as a false positive. `tsc` clean and all tests green after each. What
remains genuinely open is the harder set: data loss (#1), the trust model (#2), the lint
theater (#6), numeric asymmetry (#8), and the structural items (#10, #11).

*— Review conducted against `develop`. Methodology: full `tsc` + `vitest` run,
`npm audit`, and hand-reading of the engine, node, persistence, I/O, Rust, and build
layers. Every bug claim was reproduced or line-cited.*

# Bleeding edge, 2026-10-31

Every dependency at its newest release and the newest platform features tried out, rebased onto `rust-port` @ `a0afae297` by `.github/workflows/bleeding-edge.yml`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**1 of 17 checks fail.** Today 1 direct dependencies moved (0 across a major), 33 transitive. rustc 1.99.1 (58cf8f9c3 2026-10-13), Node v24.22.1.

## This branch on its base

Rebased from `54ab94216` onto `rust-port` @ `a0afae297`: 10 commits carried, one bump added.

- `8b3af0513` Bleeding edge 2026-10-30: every dependency at its newest, on rust-port
- `f495c856e` Edge: text-fit: the Dashboard half box's glyph-width estimate
- `0139dd8b8` Bleeding edge: the experiments ledger
- `db5a4deef` Bleeding edge: its leaves and specs, on this branch only, and ready-to-port verdicts
- `5b1aa58a0` Bleeding edge: uuids for its leaves, and the renumbering in its spec
- `aaf7169c3` Bleeding edge: four platform features ported to rust-port
- `8b923e50f` Bleeding edge: focusgroup ported too
- `87240323d` Bleeding edge: a ready finding ports as it stands
- `79bc61a39` Bleeding edge: the wasm-bindgen 0.2.130 port is on rust-port
- `17a2361a6` Bleeding edge: a finding is one commit, ported with port.mjs

**Findings: 0 of 1 port onto `rust-port` alone** (cherry-picked with `port.mjs`, generated files rebuilt, typecheck and unit tests run there). Whether a finding is ready also takes the engine check in its spec row.

- ❌ `f495c856e` Edge: text-fit: the Dashboard half box's glyph-width estimate: Edge: text-fit: the Dashboard half box's glyph-width estimate

<details><summary>Why `f495c856e` doesn't port</summary>

```
Edge: text-fit: the Dashboard half box's glyph-width estimate

A phone's half box sized its value from the character count (a glyph taken as 0.6 em, 130cqw over --chars), which misjudged commas and currency signs, so neighbors drew at different widths. text-fit: shrink sets the value at its largest size and shrinks it to 86% of the box by the text's own measure; --chars is gone from the three components that set it. A counting value pads to its final length with figure spaces, so it fits once and holds still.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJp3bVvDK9qNZ5oxC2FHcC

Ported from bleeding-edge f495c856e.
PORT_MSG
Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

to set your account's default identity.
Omit --global to set the identity only in this repository.

fatal: empty ident name (for <runner@runnervm48cm3.sgaplscctz0uxe4tann0drhwng.phxx.internal.cloudapp.net>) not allowed

    at must (file:///home/runner/work/_temp/port.mjs:35:78)
    at file:///home/runner/work/_temp/port.mjs:148:3
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.22.1
```

</details>

<details><summary>23 npm direct dependencies ahead of rust-port</summary>

| Package | On base | Here |
|---|---|---|
| `@lezer/common` | ^1.5.3 | ^1.5.5 |
| `@tauri-apps/api` | ^2.12.2 | ^2.12.4 |
| `@tauri-apps/cli` | ^2.12.1 | ^2.12.4 |
| `@tauri-apps/plugin-dialog` | ^2.8.1 | ^2.8.4 |
| `@tauri-apps/plugin-fs` | ^2.6.0 | ^2.7.1 |
| `@tauri-apps/plugin-opener` | ^2.7.0 | ^2.7.2 |
| `@types/node` | ^26.6.5 | ^26.6.6 |
| `@types/react` | ^19.2.18 | ^19.3.0 |
| `@types/react-dom` | ^19.2.7 | ^19.3.0 |
| `chrono-node` | ^2.10.2 | ^2.10.3 |
| `dompurify` | ^3.4.16 | ^3.4.17 |
| `elkjs` | ^0.12.0 | ^0.12.1 |
| `katex` | ^0.19.0 | ^0.19.1 |
| `magic-string` | 0.30.21 | 1.4.5 |
| `marked` | ^18.1.0 | ^18.1.2 |
| `pele` | ^1.8.0 | ^1.13.0 |
| `puppeteer-core` | ^25.13.0 | ^25.16.0 |
| `react` | ^19.3.0 | ^19.3.1 |
| `react-dom` | ^19.3.0 | ^19.3.1 |
| `react-is` | ^19.3.0 | ^19.3.1 |
| `three` | 0.186.1 | 0.187.0 |
| `vite` | ^8.3.4 | ^8.3.5 |
| `vitest` | ^5.0.3 | ^5.0.5 |

</details>

## Checks

| | Check | Time |
|---|---|---|
| ✅ | Engine module builds (npm run build:wasm) | 117s |
| ✅ | Site snapshots regenerate (node scripts/prerender-site.mjs) | 30s |
| ✅ | Typecheck | 1s |
| ❌ | Unit tests | 52s |
| ✅ | Site build | 4s |
| ✅ | Headless CLI build | 2s |
| ✅ | Obsidian plugin build | 2s |
| ✅ | crates/solenoid-core: clippy | 15s |
| ✅ | crates/solenoid-core: tests | 76s |
| ✅ | crates/solenoid-graph: clippy | 14s |
| ✅ | crates/solenoid-graph: tests | 31s |
| ✅ | crates/solenoid-parquet: clippy | 24s |
| ✅ | crates/solenoid-parquet: tests | 48s |
| ✅ | crates/solenoid-schedule: clippy | 3s |
| ✅ | crates/solenoid-schedule: tests | 4s |
| ✅ | crates/solenoid-core: clippy (wasm) | 23s |
| ✅ | Desktop shell compiles (src-tauri) | 102s |

## Direct dependencies that moved today

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
|  | `pele` | npm | 1.12.0 | 1.13.0 | [releases](https://github.com/obsidianmd/pele/releases) |

<details><summary>33 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `@rollup/rollup-android-arm-eabi` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-android-arm64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-android-x64` | npm | (new) | 4.67.2 |
| `@rollup/rollup-darwin-arm64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-darwin-x64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-freebsd-arm64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-freebsd-x64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-arm-gnueabihf` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-arm-musleabihf` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-arm64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-arm64-musl` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-loong64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-loong64-musl` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-ppc64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-ppc64-musl` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-riscv64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-riscv64-musl` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-s390x-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-x64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-linux-x64-musl` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-openbsd-x64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-openharmony-arm64` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-win32-arm64-msvc` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-win32-ia32-msvc` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-win32-x64-gnu` | npm | 4.66.0 | 4.67.2 |
| `@rollup/rollup-win32-x64-msvc` | npm | 4.66.0 | 4.67.2 |
| `@types/estree (in rollup)` | npm | 1.0.9 | (gone) |
| `log` | solenoid-core | 0.4.34 | 0.4.35 |
| `log` | solenoid-graph | 0.4.34 | 0.4.35 |
| `log` | solenoid-parquet | 0.4.34 | 0.4.35 |
| `log` | src-tauri | 0.4.34 | 0.4.35 |
| `rollup` | npm | 4.66.0 | 4.67.2 |
| `ws` | npm | 8.22.0 | 8.22.1 |

</details>

## Security audits

- npm: none
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: none

## Failure logs

<details><summary>❌ Unit tests</summary>

`npx vitest run`

```
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:2801:26
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3338:20
    at new Promise (<anonymous>)
    at runWithCancel [90m(file:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3333:10[90m)[39m
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3318:20
    at new Promise (<anonymous>)
[solenoid] capture failed Error: capture fault
    at serializeGraph [90m(/home/runner/work/solenoid/solenoid/[39mtests/graph/documentStorePersist.test.ts:28:72[90m)[39m
    at Object.captureCurrent [90m(/home/runner/work/solenoid/solenoid/[39msrc/graph/documentStore.ts:366:11[90m)[39m
    at Object.newBlank [90m(/home/runner/work/solenoid/solenoid/[39msrc/graph/documentStore.ts:391:15[90m)[39m
    at [90m/home/runner/work/solenoid/solenoid/[39mtests/graph/documentStorePersist.test.ts:232:27
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:1632:35
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:2801:26
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3338:20
    at new Promise (<anonymous>)
    at runWithCancel [90m(file:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3333:10[90m)[39m
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3318:20

[90mstderr[2m | scripts/run-graph-vault.test.ts[2m > [22m[2mrun-graph --vault[2m > [22m[2m--run arms and runs a named Write to Obsidian into a temp copy of the vault; nothing runs without it
[22m[39mWrite memo: Wrote Notes/CLI memo.md

[90mstderr[2m | scripts/run-graph-vault.test.ts[2m > [22m[2mrun-graph --vault[2m > [22m[2m--run a Write Properties over the vault leaves current values byte-identical and writes a new key
[22m[39mSync status: 0 changes across 0 notes

[90mstderr[2m | scripts/run-graph-vault.test.ts[2m > [22m[2mrun-graph --vault[2m > [22m[2m--run a Write Properties over the vault leaves current values byte-identical and writes a new key
[22m[39mAdd folder: 6 changes across 6 notes

[90mstderr[2m | tests/graph/draftFlush.test.ts[2m > [22m[2mopen drafts flush before a capture[2m > [22m[2mcommits every registered draft once, and a failing one never blocks the rest
[22m[39m[solenoid] draft flush failed Error: boom
    at [90m/home/runner/work/solenoid/solenoid/[39mtests/graph/draftFlush.test.ts:9:44
    at flushDrafts [90m(/home/runner/work/solenoid/solenoid/[39msrc/graph/draftFlush.ts:11:11[90m)[39m
    at [90m/home/runner/work/solenoid/solenoid/[39mtests/graph/draftFlush.test.ts:11:12
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:1632:35
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:2801:26
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3338:20
    at new Promise (<anonymous>)
    at runWithCancel [90m(file:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3333:10[90m)[39m
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.BPv-BBRv.js:3318:20
    at new Promise (<anonymous>)


[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/coreConformance.test.ts[2m > [22mthe core's Math answers as V8's, bit for bit[2m > [22mpow
[31m[1mAssertionError[22m: expected [ [ 22.5, 7.5, …(2) ], …(2) ] to deeply equal [][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [][39m
[31m+ [[39m
[31m+   [[39m
[31m+     22.5,[39m
[31m+     7.5,[39m
[31m+     "4758557643364502669",[39m
[31m+     "4758557643364502668",[39m
[31m+   ],[39m
[31m+   [[39m
[31m+     26.6,[39m
[31m+     6.5,[39m
[31m+     "4745449661846722843",[39m
[31m+     "4745449661846722842",[39m
[31m+   ],[39m
[31m+   [[39m
[31m+     14.139106450602412,[39m
[31m+     13.811988537199795,[39m
[31m+     "4844621592307258059",[39m
[31m+     "4844621592307258060",[39m
[31m+   ],[39m
[31m+ ][39m

[36m [2m❯[22m tests/graph/coreConformance.test.ts:[2m128:29[22m[39m
    [90m126|[39m     const got = wasmInvokeSync<string[]>("engine_math", { fn: c.fn, xs…
    [90m127|[39m     const bad = c.xs.map((x, i) => [x, c.ys[i], c.want[i], got[i]] as …
    [90m128|[39m     expect(bad.slice(0, 3)).toEqual([]);
    [90m   |[39m                             [31m^[39m
    [90m129|[39m   });
    [90m130|[39m });

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m
```

</details>


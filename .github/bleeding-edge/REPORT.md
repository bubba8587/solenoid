# Bleeding edge, 2026-11-27

Every dependency at its newest release and the newest platform features tried out, rebased onto `develop` @ `3e06b93cb` by `.github/workflows/bleeding-edge.yml`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**12 of 17 checks fail.** Today 3 direct dependencies moved (0 across a major), 35 transitive. rustc 1.100.0 (0ef1bc386 2026-11-09), Node v26.13.1.

## This branch on its base

Rebased from `3e06b93cb` onto `develop` @ `3e06b93cb`: 48 commits carried, one bump added.

- `74047d151` Bleeding edge 2026-10-30: every dependency at its newest, on rust-port
- `c8b30885b` Bleeding edge: the experiments ledger
- `2dd03958c` Bleeding edge: its leaves and specs, on this branch only, and ready-to-port verdicts
- `e25113d53` Bleeding edge: uuids for its leaves, and the renumbering in its spec
- `10020c05b` Bleeding edge: four platform features ported to rust-port
- `945dd28a5` Bleeding edge: focusgroup ported too
- `d602c6a6a` Bleeding edge: a ready finding ports as it stands
- `d0040a6fa` Bleeding edge: the wasm-bindgen 0.2.130 port is on rust-port
- `de616fbe2` Bleeding edge: a finding is one commit, ported with port.mjs
- `df67a0bcb` Bleeding edge 2026-10-31: dependencies to their newest
- `7b50567b1` Bleeding edge: the report lists the toolchain that moved since the last run, with its release notes
- `57aab05b6` Bleeding edge: the toolchain and dependency features in use, from their release notes
- `82a62bc8d` B26 edgeReadsReleaseNotes: every bump on bleeding-edge is read through its release notes
- `eafff39ad` Bleeding edge: the release notes read for the 23 dependencies ahead of rust-port
- `01e53a361` Bleeding edge report 2026-11-01: 0 failing checks, on develop
- `f600fd88c` Bleeding edge analysis 2026-11-01
- `38ecafc4f` Bleeding edge 2026-11-02: dependencies to their newest
- `7eef1f0de` Bleeding edge 2026-11-03: dependencies to their newest
- `0d61d9dd1` Bleeding edge 2026-11-04: dependencies to their newest
- `b6c263dd1` Bleeding edge 2026-11-05: dependencies to their newest
- `d7b335fa7` Bleeding edge 2026-11-06: dependencies to their newest
- `5a2b5fc55` Bleeding edge 2026-11-07: dependencies to their newest
- `99ac426e2` Bleeding edge 2026-11-08: dependencies to their newest
- `66d6ae8ad` Bleeding edge report 2026-11-08: 0 failing checks, on develop
- `857acfc12` Edge: React Flow 13.0.0-next.3, its split stores
- `d1f21cdf5` Bleeding edge 2026-11-09: dependencies to their newest
- `916d18a06` Bleeding edge 2026-11-10: dependencies to their newest
- `6e5382bc3` Bleeding edge 2026-11-11: dependencies to their newest
- `3264abf7a` Bleeding edge 2026-11-12: dependencies to their newest
- `f524e22d6` Bleeding edge: Rust 1.100 read against the crates, with its sweep script and an allocation probe
- `1613d3f6e` Bleeding edge: the Rust 1.100 report names the checks that ran
- `69d5b7696` Bleeding edge: stable Rust, and no crate cooldown here
- `892599e9c` Bleeding edge: the Rust 1.100 findings after develop's pin moved
- `af6b7eb90` Bleeding edge: the Rust 1.100 findings are ported to develop
- `279fb2abd` Bleeding edge 2026-11-13: dependencies to their newest
- `622aa9113` Bleeding edge 2026-11-14: dependencies to their newest
- `25ee28217` Bleeding edge 2026-11-15: dependencies to their newest
- `e57b44f35` Bleeding edge 2026-11-16: dependencies to their newest
- `ad28ff797` Bleeding edge 2026-11-17: dependencies to their newest
- `1b786aafc` Bleeding edge 2026-11-18: dependencies to their newest
- `a34fcee1a` Bleeding edge 2026-11-19: dependencies to their newest
- `555288f29` Bleeding edge 2026-11-20: dependencies to their newest
- `9f2b2449e` Bleeding edge 2026-11-21: dependencies to their newest
- `ecfa9fc47` Bleeding edge 2026-11-22: dependencies to their newest
- `11240370e` Bleeding edge 2026-11-23: dependencies to their newest
- `8badc95e5` Bleeding edge 2026-11-24: dependencies to their newest
- `a288107ea` Bleeding edge 2026-11-25: dependencies to their newest
- `531c0b841` Bleeding edge 2026-11-26: dependencies to their newest

**Findings: 0 of 1 port onto `develop` alone** (cherry-picked with `port.mjs`, generated files rebuilt, typecheck and unit tests run there). Whether a finding is ready also takes the engine check in its spec row.

- ❌ `857acfc12` Edge: React Flow 13.0.0-next.3, its split stores: the unit tests failed:

<details><summary>Why `857acfc12` doesn't port</summary>

```
the unit tests failed:
[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed dimensional-flow
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_3","type":"GroupNode","name":"Group_3","x":1346,"y":274,"init":{"label":"C · Matrix reads as a frame","members":["TableInput_1","TableInfo_3","Display_5","Display_6","GetColumn_1","Display_7"],"color":"purple","collapsed":false,"width":904,"height":697,"lockedPosition":false}},"want":"{\"id\":\"Group_3\",\"type\":\"GroupNode\",\"name\":\"Group_3\",\"x\":1346,\"y\":274,\"init\":{\"label\":\"C · Matrix reads as a frame\",\"members\":[\"Note_4\",\"TableInput_1\",\"TableInfo_3\",\"Display_5\",\"Display_6\",\"GetColumn_1\",\"Display_7\"],\"color\":\"purple\",\"collapsed\":false,\"width\":904,\"height\":697,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed dimensional-flow
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_4","type":"GroupNode","name":"Group_4","x":481,"y":274,"init":{"label":"D · Transpose to a column","members":["Note_5","ListInput_2","TableTranspose_1"],"color":"teal","collapsed":false,"width":845,"height":515,"lockedPosition":false}},"want":"{\"id\":\"Group_4\",\"type\":\"GroupNode\",\"name\":\"Group_4\",\"x\":481,\"y\":274,\"init\":{\"label\":\"D · Transpose to a column\",\"members\":[\"Note_5\",\"ListInput_2\",\"TableTranspose_1\",\"Display_8\"],\"color\":\"teal\",\"collapsed\":false,\"width\":845,\"height\":515,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed dimensional-flow
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_5","type":"GroupNode","name":"Group_5","x":-373,"y":1541,"init":{"label":"E · The type wall","members":["Note_6","ValueInput_2","Cast_1","Display_9","ValueInput_3","Cast_2","Display_10","ValueInput_4","ValueInput_5","Arithmetic_1","Display_11"],"color":"lime","collapsed":false,"width":1365,"height":923,"lockedPosition":false}},"want":"{\"id\":\"Group_5\",\"type\":\"GroupNode\",\"name\":\"Group_5\",\"x\":-373,\"y\":1541,\"init\":{\"label\":\"E · The type wall\",\"members\":[\"Note_6\",\"ValueInput_2\",\"Cast_1\",\"Display_9\",\"ValueInput_3\",\"Cast_2\",\"Display_10\",\"ValueInput_4\",\"ValueInput_5\",\"Comparison_1\",\"Arithmetic_1\",\"Display_11\"],\"color\":\"lime\",\"collapsed\":false,\"width\":1365,\"height\":923,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed script-tour
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_4","type":"GroupNode","name":"Group_4","x":-130,"y":181,"init":{"label":"Friday the 13ths","members":["Script_6","Display_5"],"color":"teal","collapsed":false,"width":860,"height":349,"lockedPosition":false}},"want":"{\"id\":\"Group_4\",\"type\":\"GroupNode\",\"name\":\"Group_4\",\"x\":-130,\"y\":181,\"init\":{\"label\":\"Friday the 13ths\",\"members\":[\"ValueInput_4\",\"Script_6\",\"Display_5\"],\"color\":\"teal\",\"collapsed\":false,\"width\":860,\"height\":349,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed service-territory
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"ComputedColumn_1_c","type":"ComputedColumnNode","name":"ComputedColumn_1_c","x":392,"y":263,"init":{"label":"Expected incidents","expr":"ROUND(annual * @[Rel Freq] / SUM([Rel Freq]), 2)","addAs":"auto","sideVars":[],"width":235,"height":290},"literals":{},"stringLiterals":{"name":"Incidents per Yr"}},"want":"{\"id\":\"ComputedColumn_1_c\",\"type\":\"ComputedColumnNode\",\"name\":\"ComputedColumn_1_c\",\"x\":392,\"y\":263,\"init\":{\"label\":\"Expected incidents\",\"expr\":\"ROUND(annual * @[Rel Freq] / SUM([Rel Freq]), 2)\",\"addAs\":\"auto\",\"sideVars\":[\"annual\"],\"width\":235,\"height\":290},\"literals\":{},\"stringLiterals\":{\"name\":\"Incidents per Yr\"}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed chart-showcase
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"SliderInput_1","type":"SliderInputNode","name":"SliderInput_1","x":-5512,"y":-2305,"init":{"label":"Reading","value":1,"width":200,"height":258},"literals":{"max":1,"min":0,"step":0.01}},"want":"{\"id\":\"SliderInput_1\",\"type\":\"SliderInputNode\",\"name\":\"SliderInput_1\",\"x\":-5512,\"y\":-2305,\"init\":{\"label\":\"Reading\",\"value\":6,\"width\":200,\"height\":258},\"literals\":{\"max\":1,\"min\":0,\"step\":0.01}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed famous-math
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"FormatController_15","type":"FormatControllerNode","name":"FormatController_15","x":3426,"y":2366,"init":{"label":"Format","hostNodeId":"","socketKey":"","side":"output","format":"scientific","customPattern":"0.00","decimalDigits":3,"decimalMode":"places","unit":"custom","customUnit":" J","socketDataType":"numlist","textCase":"none","bold":false,"italic":false,"textScale":14,"textAlign":"right","textMarkdown":false,"textMono":false,"logicalStyle":"truefalse","lambdaView":"signature","chartFontScale":1,"grouping":true,"negativeStyle":"minus","scaleMode":"none","advancedOpen":false,"width":116,"height":64,"inheritFormat":false,"chip":false}},"want":"{\"id\":\"FormatController_15\",\"type\":\"FormatControllerNode\",\"name\":\"FormatController_15\",\"x\":3426,\"y\":2366,\"init\":{\"label\":\"Format\",\"hostNodeId\":\"Display_15\",\"socketKey\":\"out\",\"side\":\"output\",\"format\":\"scientific\",\"customPattern\":\"0.00\",\"decimalDigits\":3,\"decimalMode\":\"places\",\"unit\":\"custom\",\"customUnit\":\" J\",\"socketDataType\":\"numlist\",\"textCase\":\"none\",\"bold\":false,\"italic\":false,\"textScale\":14,\"textAlign\":\"right\",\"textMarkdown\":false,\"textMono\":false,\"logicalStyle\":\"truefalse\",\"lambdaView\":\"signature\",\"chartFontScale\":1,\"grouping\":true,\"negativeStyle\":\"minus\",\"scaleMode\":\"none\",\"advancedOpen\":false,\"width\":116,\"height\":64,\"inheritFormat\":false,\"chip\":false}}"},{"got":{"id":"Group_8","type":"GroupNode","name":"Group_8","x":3219,"y":2163,"init":{"label":"Results","members":["Display_12","Display_13","Display_14","FormatController_12","FormatController_13","FormatController_14","FormatController_15"],"color":"green","collapsed":false,"width":425,"height":673,"lockedPosition":false}},"want":"{\"id\":\"Group_8\",\"type\":\"GroupNode\",\"name\":\"Group_8\",\"x\":3219,\"y\":2163,\"init\":{\"label\":\"Results\",\"members\":[\"Display_12\",\"Display_13\",\"Display_14\",\"Display_15\",\"FormatController_12\",\"FormatController_13\",\"FormatController_14\",\"FormatController_15\"],\"color\":\"green\",\"collapsed\":false,\"width\":425,\"height\":673,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed product-launch-gantt
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_1","type":"GroupNode","name":"Group_1","x":395,"y":985,"init":{"label":"The plan","members":["CubeInput_1","ValueInput_1"],"color":"amber","collapsed":false,"width":511,"height":414,"lockedPosition":false}},"want":"{\"id\":\"Group_1\",\"type\":\"GroupNode\",\"name\":\"Group_1\",\"x\":395,\"y\":985,\"init\":{\"label\":\"The plan\",\"members\":[\"CubeInput_1\",\"ValueInput_1\",\"ValueInput_2\"],\"color\":\"amber\",\"collapsed\":false,\"width\":511,\"height\":414,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/draftFlush.test.ts[2m > [22m[2mopen drafts flush before a capture[2m > [22m[2mcommits every registered draft once, and a failing one never blocks the rest
[22m[39m[solenoid] draft flush failed Error: boom
    at [90m/tmp/bleeding-edge-port-4627/[39mtests/graph/draftFlush.test.ts:9:44
    at flushDrafts [90m(/tmp/bleeding-edge-port-4627/[39msrc/graph/draftFlush.ts:11:11[90m)[39m
    at [90m/tmp/bleeding-edge-port-4627/[39mtests/graph/draftFlush.test.ts:11:12
    at [90mfile:///tmp/bleeding-edge-port-4627/[39mnode_modules/[4mvitest[24m/dist/chunks/run.CjdgFZiW.js:1632:35
    at [90mfile:///tmp/bleeding-edge-port-4627/[39mnode_modules/[4mvitest[24m/dist/chunks/run.CjdgFZiW.js:2801:26
    at [90mfile:///tmp/bleeding-edge-port-4627/[39mnode_modules/[4mvitest[24m/dist/chunks/run.CjdgFZiW.js:3338:20
    at new Promise (<anonymous>)
    at runWithCancel [90m(file:///tmp/bleeding-edge-port-4627/[39mnode_modules/[4mvitest[24m/dist/chunks/run.CjdgFZiW.js:3333:10[90m)[39m
    at [90mfile:///tmp/bleeding-edge-port-4627/[39mnode_modules/[4mvitest[24m/dist/chunks/run.CjdgFZiW.js:3318:20
    at new Promise (<anonymous>)


[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/docsPointers.test.ts[2m > [22mno dead .md pointers in live docs[2m > [22mdocs/dev-notes.md cites only existing files
[31m[1mAssertionError[22m: expected [ 'chart-figures.md' ] to deeply equal [][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [][39m
[31m+ [[39m
[31m+   "chart-figures.md",[39m
[31m+ ][39m

[36m [2m❯[22m tests/graph/docsPointers.test.ts:[2m74:20[22m[39m
    [90m 72|[39m     (_rel[33m,[39m file) [33m=>[39m {
    [90m 73|[39m       const dead = mdCitations(read(file)).filter((t) => !resolves(fil…
    [90m 74|[39m       [34mexpect[39m(dead)[33m.[39m[34mtoEqual[39m([])[33m;[39m
    [90m   |[39m                    [31m^[39m
    [90m 75|[39m     }[33m,[39m
    [90m 76|[39m   )[33m;[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯[22m[39m
```

</details>

<details><summary>35 npm direct dependencies ahead of develop</summary>

| Package | On base | Here |
|---|---|---|
| `@anthropic-ai/sdk` | ^1.5.0 | ^1.14.0 |
| `@lezer/common` | ^1.5.5 | ^1.5.7 |
| `@lezer/javascript` | ^1.5.6 | ^1.5.7 |
| `@tauri-apps/api` | ^2.12.2 | ^2.12.5 |
| `@tauri-apps/cli` | ^2.12.1 | ^2.12.6 |
| `@tauri-apps/plugin-dialog` | ^2.8.1 | ^2.8.4 |
| `@tauri-apps/plugin-fs` | ^2.6.0 | ^2.7.1 |
| `@tauri-apps/plugin-opener` | ^2.7.0 | ^2.7.3 |
| `@types/node` | ^26.6.5 | ^26.6.11 |
| `@types/react` | ^19.2.18 | ^19.3.3 |
| `@types/react-dom` | ^19.2.7 | ^19.3.0 |
| `@vitejs/plugin-react` | ^6.2.1 | ^6.3.0 |
| `@xyflow/react` | ^13.0.1 | 13.0.3 |
| `@xyflow/system` | 1.0.0 | 1.0.1 |
| `colord` | ^2.10.0 | ^2.14.1 |
| `dompurify` | ^3.4.16 | ^3.5.0 |
| `elkjs` | ^0.12.0 | ^0.12.2 |
| `eslint` | ^9.39.5 | ^10.16.0 |
| `eslint-plugin-obsidianmd` | ^0.5.1 | ^0.6.0 |
| `katex` | ^0.19.0 | ^0.19.1 |
| `magic-string` | 0.30.21 | 1.4.5 |
| `marked` | ^18.1.3 | ^18.3.0 |
| `papaparse` | ^5.7.0 | ^5.7.1 |
| `postcss` | 8.5.32 | 8.5.34 |
| `puppeteer-core` | ^25.13.0 | ^25.19.0 |
| `react` | ^19.3.0 | ^19.3.1 |
| `react-dom` | ^19.3.0 | ^19.3.1 |
| `react-is` | ^19.3.0 | ^19.3.1 |
| `recharts` | ^3.10.1 | ^3.11.2 |
| `rollup-plugin-license` | ^3.7.1 | ^3.7.2 |
| `three` | 0.186.1 | 0.187.0 |
| `tsrs` | 0.20.1-ts7.1.0-beta | 7.1.0-beta.tsrs5 |
| `typescript-eslint` | ^8.72.2 | ^8.74.0 |
| `vite` | ^8.3.4 | ^8.4.0 |
| `vitest` | ^5.1.0 | ^5.1.2 |

</details>

## Checks

| | Check | Time |
|---|---|---|
| ❌ | Engine module builds (npm run build:wasm) | 34s |
| ❌ | Site snapshots regenerate (node scripts/prerender-site.mjs) | 47s |
| ✅ | Typecheck | 1s |
| ❌ | Unit tests | 37s |
| ✅ | Site build | 3s |
| ✅ | Headless CLI build | 2s |
| ❌ | Obsidian plugin build | 29s |
| ❌ | crates/solenoid-core: clippy | 31s |
| ❌ | crates/solenoid-core: tests | 38s |
| ❌ | crates/solenoid-graph: clippy | 29s |
| ❌ | crates/solenoid-graph: tests | 36s |
| ❌ | crates/solenoid-parquet: clippy | 20s |
| ❌ | crates/solenoid-parquet: tests | 32s |
| ✅ | crates/solenoid-schedule: clippy | 2s |
| ✅ | crates/solenoid-schedule: tests | 2s |
| ❌ | crates/solenoid-core: clippy (wasm) | 60s |
| ❌ | Desktop shell compiles (src-tauri) | 0s |

Setup steps that failed:

- ❌ cargo: src-tauri lockfile

## Direct dependencies that moved today

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
|  | `eslint` | npm | 10.15.0 | 10.16.0 | [releases](https://github.com/eslint/eslint/releases) |
|  | `postcss` | npm | 8.5.33 | 8.5.34 | [releases](https://github.com/postcss/postcss/releases) |
|  | `recharts` | npm | 3.11.1 | 3.11.2 | [releases](https://github.com/recharts/recharts/releases) |

<details><summary>35 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `@eslint-community/regexpp` | npm | 4.12.3 | 4.12.4 |
| `@eslint/config-array` | npm | 0.23.6 | 0.23.7 |
| `@rollup/rollup-android-arm-eabi` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-android-arm64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-android-x64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-darwin-arm64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-darwin-x64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-freebsd-arm64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-freebsd-x64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-arm-gnueabihf` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-arm-musleabihf` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-arm64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-arm64-musl` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-loong64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-loong64-musl` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-ppc64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-ppc64-musl` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-riscv64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-riscv64-musl` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-s390x-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-x64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-linux-x64-musl` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-openbsd-x64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-openharmony-arm64` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-win32-arm64-msvc` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-win32-ia32-msvc` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-win32-x64-gnu` | npm | 4.68.8 | 4.68.9 |
| `@rollup/rollup-win32-x64-msvc` | npm | 4.68.8 | 4.68.9 |
| `cc` | solenoid-parquet | 1.11.3 | 1.12.0 |
| `find-msvc-tools` | solenoid-parquet | 0.1.15 | 0.1.16 |
| `immer` | npm | 11.2.10 | 11.2.13 |
| `modern-tar` | npm | 0.8.6 | 0.8.7 |
| `rollup` | npm | 4.68.8 | 4.68.9 |
| `victory-vendor` ⚠️ | npm | 37.4.1 | 38.1.1 |
| `ws` | npm | 8.23.0 | 8.23.1 |

</details>

## Security audits

- npm: 4 moderate, 4 total
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: RUSTSEC-2026-0594 cookie 0.18.2: Private cookie nonces can repeat in processes that fork; RUSTSEC-2026-0592 url 2.5.8: Stack overflow in `Url::origin()` on nested `blob:` URLs

## Failure logs

<details><summary>❌ cargo: src-tauri lockfile</summary>

`cargo update --manifest-path src-tauri/Cargo.toml`

```
[1m[92m    Updating[0m crates.io index
[1m[91merror[0m: failed to select a version for `reqwest`.
    ... required by package `solenoid v1.6.2 (/home/runner/work/solenoid/solenoid/src-tauri)`
versions that meet the requirements `^0.13` are: 0.13.5, 0.13.4, 0.13.3, 0.13.2, 0.13.1, 0.13.0

package `solenoid` depends on `reqwest` with feature `rustls-tls` but `reqwest` does not have that feature.
help: available features: __native-tls, __native-tls-alpn, __rustls, __rustls-aws-lc-rs, __tls, blocking, brotli, charset, cookies, default, default-tls, deflate, form, gzip, h2, hickory-dns, http2, http3, json, multipart, native-tls, native-tls-no-alpn, native-tls-vendored, native-tls-vendored-no-alpn, query, rustls, rustls-native-certs, rustls-no-provider, socks, stream, system-proxy, webpki-roots, zstd


failed to select a version for `reqwest` which could resolve this conflict
```

</details>

<details><summary>❌ Engine module builds (npm run build:wasm)</summary>

`npm run build:wasm`

```
[1m[92m   Compiling[0m bit-vec v0.8.0
[1m[92m   Compiling[0m typed-path v0.13.0
[1m[92m   Compiling[0m jiff-core v0.1.8
[1m[92m   Compiling[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m itoa v1.0.19
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m atoi_simd v0.18.1
[1m[92m   Compiling[0m zip v9.8.2
[1m[92m   Compiling[0m jiff v0.2.46
[1m[92m   Compiling[0m bit-set v0.8.0
[1m[92m   Compiling[0m js-sys v0.3.107
[1m[92m   Compiling[0m regex-automata v0.4.19
[1m[92m   Compiling[0m logos v0.15.1
[1m[92m   Compiling[0m quick-xml v0.42.0
[1m[92m   Compiling[0m codepage v0.1.3
[1m[92m   Compiling[0m csv-core v0.1.13
[1m[92m   Compiling[0m foldhash v0.2.0
[1m[92m   Compiling[0m jiff-tzdb v1.0.0
[1m[92m   Compiling[0m ryu-js v1.0.4
[1m[92m   Compiling[0m ryu v1.0.23
[1m[92m   Compiling[0m jiff-core v1.0.2
[1m[92m   Compiling[0m tinyvec v1.13.3
[1m[92m   Compiling[0m byteorder v1.5.0
[1m[92m   Compiling[0m fast-float2 v0.2.4
[1m[92m   Compiling[0m calamine v0.38.0
[1m[92m   Compiling[0m jiff v1.0.3
[1m[92m   Compiling[0m unicode-normalization v0.1.26
[1m[92m   Compiling[0m csv v1.4.0
[1m[92m   Compiling[0m fancy-regex v0.20.2
[1m[92m   Compiling[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m   Compiling[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m   Compiling[0m netcore v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m md-5 v0.11.0
[1m[92m   Compiling[0m sha1 v0.11.0
[1m[92m   Compiling[0m sha2 v0.11.2
[1m[92m   Compiling[0m uuid v1.29.3
[1m[92m   Compiling[0m base64 v0.23.1
[1m[92m   Compiling[0m rustc-hash v2.1.3
[1m[92m   Compiling[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m strsim v0.11.1
[1m[92m   Compiling[0m netcore-engine v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[92m   Compiling[0m wasm-bindgen-futures v0.4.80
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
node:internal/errors:999
  const err = new Error(message);
              ^

Error: Command failed: cargo build --profile release --target wasm32-unknown-unknown --manifest-path crates/solenoid-graph/Cargo.toml --target-dir crates/solenoid-graph/target
    at genericNodeError (node:internal/errors:999:15)
    at wrappedFn (node:internal/errors:544:14)
    at checkExecSyncError (node:child_process:990:11)
    at execFileSync (node:child_process:1026:15)
    at run (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:12:28)
    at build (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:75:3)
    at file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:93:1
    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)
    at async node:internal/modules/esm/loader:650:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:105:5) {
  status: 101,
  signal: null,
  output: [ null, null, null ],
  pid: 7888,
  stdout: null,
  stderr: null
}

Node.js v26.13.1
```

</details>

<details><summary>❌ Site snapshots regenerate (node scripts/prerender-site.mjs)</summary>

`node scripts/prerender-site.mjs`

```
dist/assets/chartRender-CKvlbtYp.js                                             736.04 kB │ gzip:   210.06 kB
dist/assets/main-fnKvL2rl.js                                                  1,596.08 kB │ gzip:   509.62 kB
dist/assets/ROMAN-Dpivsh3G.js                                                 2,595.64 kB │ gzip:    79.81 kB
dist/assets/ARABIC-CF7AReFL.js                                                2,986.42 kB │ gzip:   123.68 kB
dist/assets/harvest-1NytJZ7F.js                                               3,169.27 kB │ gzip:   707.93 kB
dist/assets/index-Dn6UqjfU.js                                                 4,927.56 kB │ gzip: 1,443.60 kB

[32m✓ built in 2.46s[39m

> solenoid@1.6.2 postbuild
> node scripts/check-dist-classnames.mjs

check-dist-classnames: OK — XMatchNode, ListIndexNode present in 662 bundle file(s).
prerender/about.html  2 KB
[33m(!) Your Vite config uses features that are unsupported by `configLoader: 'native'`, which is planned to become the default in a future major version of Vite:
  - import "./src/graph/landing/siteMeta" without a file extension (vite.config.ts:8:104). Add the file extension
Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to suppress this warning.[39m
[33mBoth esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored.[39m The following esbuild options were set: `{ keepNames: true }`
[33m[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.[39m
[33m[MODULE_LEVEL_DIRECTIVE] The semantics of the module level directive "use no memo" in "node_modules/react-compiler-runtime/dist/index.js" may not be preserved when bundling.
    ╭─[ node_modules/react-compiler-runtime/dist/index.js:14:1 ]
    │
 14 │ "use no memo";
    │ ───────┬──────  
    │        ╰──────── module level directive may not be preserved
    │ 
    │ Help: For more information, see https://rolldown.rs/in-depth/directives#other-directives
────╯
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/settingsStore.ts is dynamically imported by src/graph/fileBridge.ts but also statically imported by src/graph/AppToolbar.tsx, src/graph/Settings.tsx, src/graph/TidyOptionsPopover.tsx, src/graph/canvasKeyboard.ts, src/graph/components/ConnectionNodes.tsx, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] node_modules/@tauri-apps/api/core.js is dynamically imported by src/graph/androidFolders.ts, src/graph/devtoolsHotkey.ts, src/graph/fullscreen.ts, src/graph/httpBridge.ts, src/graph/ipcBridge.ts, ... but also statically imported by node_modules/@tauri-apps/api/app.js, node_modules/@tauri-apps/api/dpi.js, node_modules/@tauri-apps/api/event.js, node_modules/@tauri-apps/api/image.js, node_modules/@tauri-apps/api/path.js, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/fileBridge.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/Settings.tsx, src/graph/StatusBar.tsx, src/graph/WebDemoBanner.tsx, src/graph/WindowControls.tsx, src/graph/androidBack.ts, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/fcReconcile.ts is dynamically imported by src/graph/nodes/annotation.ts, src/graph/nodes/obsidian.ts but also statically imported by src/graph/cableSettle.ts, src/graph/canvasActions.ts, src/graph/components/AggregateNode.tsx, src/graph/components/ArgMinMaxNode.tsx, src/graph/components/CableSwitchNode.tsx, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/process.ts is dynamically imported by src/graph/scriptGate.ts but also statically imported by src/App.tsx, src/graph/StatusBar.tsx, src/graph/activeGraph.ts, src/graph/aiReveal.ts, src/graph/cableSettle.ts, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/noticeStore.ts is dynamically imported by src/graph/fileBridge.ts but also statically imported by src/graph/alertStore.ts, src/graph/chooseFile.ts, src/graph/components/HtmlPageOverlay.tsx, src/graph/components/NoticeToasts.tsx, src/graph/connectionStore.ts, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/pluginColumnTypes.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/nodes/connection.ts, dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/pluginDataPath.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/nodes/connection.ts, dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/noteFrontmatterSync.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/components/ConnectionNodes.tsx, src/graph/components/ImportObsidianNode.tsx, src/graph/components/NoteNode.tsx, src/graph/nodes/annotation.ts, dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/canvasCommands.ts is dynamically imported by src/graph/flow/FlowCanvas.tsx but also statically imported by src/graph/MobileControls.tsx, src/graph/OutlinePanel.tsx, src/graph/TabletActions.tsx, src/graph/TopBar.tsx, src/graph/canvasActions.ts, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/documentStore.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/OutlinePanel.tsx, src/graph/WorkspaceTree.tsx, src/graph/canvasKeyboard.ts, src/graph/components/CardReference.tsx, src/graph/components/DocumentProperties.tsx, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/persistence.ts is dynamically imported by src/graph/androidBack.ts but also statically imported by src/graph/CommandPalette.tsx, src/graph/aiReveal.ts, src/graph/canvasActions.ts, src/graph/canvasKeyboard.ts, src/graph/components/ConnectionNodes.tsx, ..., dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/chooseFile.ts is dynamically imported by src/graph/fileBridge.ts but also statically imported by src/graph/components/ConnectionNodes.tsx, src/graph/components/HtmlPageNode.tsx, src/graph/components/ImportObsidianNode.tsx, src/graph/components/WriteNodes.tsx, dynamic import will not move module into another chunk.
[39m
[33m[INEFFECTIVE_DYNAMIC_IMPORT] src/graph/graphStub.ts is dynamically imported by src/graph/nodes/obsidian.ts but also statically imported by src/graph/components/WriteNodes.tsx, dynamic import will not move module into another chunk.
[39m
file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/common/QueryHandler.js:211
                const waitForSelectorError = new (error instanceof TimeoutError ? TimeoutError : Error)(`Waiting for selector \`${selector}\` failed`);
                                             ^

TimeoutError: Waiting for selector `h1` failed
    at CSSQueryHandler.waitFor (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/common/QueryHandler.js:211:46)
    at async CdpFrame.waitForSelector (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/api/Frame.js:546:21)
    at async CdpPage.waitForSelector (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/api/Page.js:1459:16)
    at async file:///home/runner/work/solenoid/solenoid/scripts/prerender-site.mjs:32:5 {
  cause: TimeoutError: Waiting failed: 30000ms exceeded
      at new WaitTask (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/common/WaitTask.js:50:34)
      at IsolatedWorld.waitForFunction (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/api/Realm.js:49:26)
      at CSSQueryHandler.waitFor (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/common/QueryHandler.js:176:95)
      at async CdpFrame.waitForSelector (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/api/Frame.js:546:21)
      at async CdpPage.waitForSelector (file:///home/runner/work/solenoid/solenoid/node_modules/puppeteer-core/lib/puppeteer/api/Page.js:1459:16)
      at async file:///home/runner/work/solenoid/solenoid/scripts/prerender-site.mjs:32:5
}

Node.js v26.13.1
```

</details>

<details><summary>❌ Unit tests</summary>

`npx vitest run`

```

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed famous-math
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"FormatController_15","type":"FormatControllerNode","name":"FormatController_15","x":3426,"y":2366,"init":{"label":"Format","hostNodeId":"","socketKey":"","side":"output","format":"scientific","customPattern":"0.00","decimalDigits":3,"decimalMode":"places","unit":"custom","customUnit":" J","socketDataType":"numlist","textCase":"none","bold":false,"italic":false,"textScale":14,"textAlign":"right","textMarkdown":false,"textMono":false,"logicalStyle":"truefalse","lambdaView":"signature","chartFontScale":1,"grouping":true,"negativeStyle":"minus","scaleMode":"none","advancedOpen":false,"width":116,"height":64,"inheritFormat":false,"chip":false}},"want":"{\"id\":\"FormatController_15\",\"type\":\"FormatControllerNode\",\"name\":\"FormatController_15\",\"x\":3426,\"y\":2366,\"init\":{\"label\":\"Format\",\"hostNodeId\":\"Display_15\",\"socketKey\":\"out\",\"side\":\"output\",\"format\":\"scientific\",\"customPattern\":\"0.00\",\"decimalDigits\":3,\"decimalMode\":\"places\",\"unit\":\"custom\",\"customUnit\":\" J\",\"socketDataType\":\"numlist\",\"textCase\":\"none\",\"bold\":false,\"italic\":false,\"textScale\":14,\"textAlign\":\"right\",\"textMarkdown\":false,\"textMono\":false,\"logicalStyle\":\"truefalse\",\"lambdaView\":\"signature\",\"chartFontScale\":1,\"grouping\":true,\"negativeStyle\":\"minus\",\"scaleMode\":\"none\",\"advancedOpen\":false,\"width\":116,\"height\":64,\"inheritFormat\":false,\"chip\":false}}"},{"got":{"id":"Group_8","type":"GroupNode","name":"Group_8","x":3219,"y":2163,"init":{"label":"Results","members":["Display_12","Display_13","Display_14","FormatController_12","FormatController_13","FormatController_14","FormatController_15"],"color":"green","collapsed":false,"width":425,"height":673,"lockedPosition":false}},"want":"{\"id\":\"Group_8\",\"type\":\"GroupNode\",\"name\":\"Group_8\",\"x\":3219,\"y\":2163,\"init\":{\"label\":\"Results\",\"members\":[\"Display_12\",\"Display_13\",\"Display_14\",\"Display_15\",\"FormatController_12\",\"FormatController_13\",\"FormatController_14\",\"FormatController_15\"],\"color\":\"green\",\"collapsed\":false,\"width\":425,\"height\":673,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/graphDeltaChain.test.ts[2m > [22m[2ma run of edits undone and redone by delta[2m > [22m[2mseed product-launch-gantt
[22m[39m[solenoid] undo delta missed its target; loading it whole {"fields":[],"cables":{"missing":[],"extra":[]},"cableOrder":"same","order":"same","off":[{"got":{"id":"Group_1","type":"GroupNode","name":"Group_1","x":395,"y":985,"init":{"label":"The plan","members":["CubeInput_1","ValueInput_1"],"color":"amber","collapsed":false,"width":511,"height":414,"lockedPosition":false}},"want":"{\"id\":\"Group_1\",\"type\":\"GroupNode\",\"name\":\"Group_1\",\"x\":395,\"y\":985,\"init\":{\"label\":\"The plan\",\"members\":[\"CubeInput_1\",\"ValueInput_1\",\"ValueInput_2\"],\"color\":\"amber\",\"collapsed\":false,\"width\":511,\"height\":414,\"lockedPosition\":false}}"}]}

[90mstderr[2m | tests/graph/draftFlush.test.ts[2m > [22m[2mopen drafts flush before a capture[2m > [22m[2mcommits every registered draft once, and a failing one never blocks the rest
[22m[39m[solenoid] draft flush failed Error: boom
    at [90m/home/runner/work/solenoid/solenoid/[39mtests/graph/draftFlush.test.ts:9:44
    at flushDrafts [90m(/home/runner/work/solenoid/solenoid/[39msrc/graph/draftFlush.ts:11:11[90m)[39m
    at [90m/home/runner/work/solenoid/solenoid/[39mtests/graph/draftFlush.test.ts:11:12
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.zBhXlcZQ.js:1695:35
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.zBhXlcZQ.js:2864:26
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.zBhXlcZQ.js:3402:20
    at new Promise (<anonymous>)
    at runWithCancel [90m(file:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.zBhXlcZQ.js:3397:10[90m)[39m
    at [90mfile:///home/runner/work/solenoid/solenoid/[39mnode_modules/[4mvitest[24m/dist/chunks/run.zBhXlcZQ.js:3381:20
    at new Promise (<anonymous>)


[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 3 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/cargoLabels.test.ts[2m > [22mevery Rust test file of the core and the graph core has a plain-English name
[31m[1mAssertionError[22m: add a line to LABELS in scripts/cargo-test.mjs: expected [ Array(1) ] to deeply equal [][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [][39m
[31m+ [[39m
[31m+   "solenoid-core/tests/alloc_probe.rs",[39m
[31m+ ][39m

[36m [2m❯[22m tests/graph/cargoLabels.test.ts:[2m16:69[22m[39m
    [90m 14|[39m     }
    [90m 15|[39m   }
    [90m 16|[39m   expect(missing, "add a line to LABELS in scripts/cargo-test.mjs").to…
    [90m   |[39m                                                                     [31m^[39m
    [90m 17|[39m })[33m;[39m
    [90m 18|[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯[22m[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/docsPointers.test.ts[2m > [22mno dead .md pointers in live docs[2m > [22mdocs/dev-notes.md cites only existing files
[31m[1mAssertionError[22m: expected [ 'chart-figures.md' ] to deeply equal [][39m

[32m- Expected[39m
[31m+ Received[39m

[32m- [][39m
[31m+ [[39m
[31m+   "chart-figures.md",[39m
[31m+ ][39m

[36m [2m❯[22m tests/graph/docsPointers.test.ts:[2m74:20[22m[39m
    [90m 72|[39m     (_rel[33m,[39m file) [33m=>[39m {
    [90m 73|[39m       const dead = mdCitations(read(file)).filter((t) => !resolves(fil…
    [90m 74|[39m       [34mexpect[39m(dead)[33m.[39m[34mtoEqual[39m([])[33m;[39m
    [90m   |[39m                    [31m^[39m
    [90m 75|[39m     }[33m,[39m
    [90m 76|[39m   )[33m;[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯[22m[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/wasmStamp.test.ts[2m > [22mthe module is current with the crates it links (run npm run build:wasm)
[31m[1mAssertionError[22m: expected '166ad716b562e88155fd3e29a353fb5b5fc06…' to be '554b01f6211037410e3148b9d5e95a15f8a93…' // Object.is equality[39m

Expected: [32m"[7m554b01f6211037410e3148b9d5e95a15f8a9379612c3c966f5d87f90208fc00[27me"[39m
Received: [31m"[7m166ad716b562e88155fd3e29a353fb5b5fc067b5b12d02b3e4b58545438a573[27me"[39m

[36m [2m❯[22m tests/graph/wasmStamp.test.ts:[2m11:19[22m[39m
    [90m  9|[39m   [35mconst[39m root [33m=[39m path[33m.[39m[34mresolve[39m(__dirname[33m,[39m [32m"../.."[39m)[33m;[39m
    [90m 10|[39m   const stamped = fs.readFileSync(path.join(root, (MODULE as { out: st…
    [90m 11|[39m   [34mexpect[39m(stamped)[33m.[39m[34mtoBe[39m([34msourceStamp[39m(root))[33m;[39m
    [90m   |[39m                   [31m^[39m
    [90m 12|[39m })[33m;[39m
    [90m 13|[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯[22m[39m
```

</details>

<details><summary>❌ Obsidian plugin build</summary>

`npm run plugin:build`

```
[1m[92m   Compiling[0m bit-vec v0.8.0
[1m[92m   Compiling[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m jiff-core v0.1.8
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m typed-path v0.13.0
[1m[92m   Compiling[0m itoa v1.0.19
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m zip v9.8.2
[1m[92m   Compiling[0m jiff v0.2.46
[1m[92m   Compiling[0m bit-set v0.8.0
[1m[92m   Compiling[0m atoi_simd v0.18.1
[1m[92m   Compiling[0m js-sys v0.3.107
[1m[92m   Compiling[0m regex-automata v0.4.19
[1m[92m   Compiling[0m logos v0.15.1
[1m[92m   Compiling[0m quick-xml v0.42.0
[1m[92m   Compiling[0m codepage v0.1.3
[1m[92m   Compiling[0m csv-core v0.1.13
[1m[92m   Compiling[0m foldhash v0.2.0
[1m[92m   Compiling[0m jiff-tzdb v1.0.0
[1m[92m   Compiling[0m ryu-js v1.0.4
[1m[92m   Compiling[0m fast-float2 v0.2.4
[1m[92m   Compiling[0m byteorder v1.5.0
[1m[92m   Compiling[0m ryu v1.0.23
[1m[92m   Compiling[0m jiff-core v1.0.2
[1m[92m   Compiling[0m tinyvec v1.13.3
[1m[92m   Compiling[0m unicode-normalization v0.1.26
[1m[92m   Compiling[0m jiff v1.0.3
[1m[92m   Compiling[0m csv v1.4.0
[1m[92m   Compiling[0m calamine v0.38.0
[1m[92m   Compiling[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m   Compiling[0m fancy-regex v0.20.2
[1m[92m   Compiling[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m   Compiling[0m netcore v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m sha1 v0.11.0
[1m[92m   Compiling[0m sha2 v0.11.2
[1m[92m   Compiling[0m md-5 v0.11.0
[1m[92m   Compiling[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m uuid v1.29.3
[1m[92m   Compiling[0m strsim v0.11.1
[1m[92m   Compiling[0m base64 v0.23.1
[1m[92m   Compiling[0m rustc-hash v2.1.3
[1m[92m   Compiling[0m netcore-engine v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[92m   Compiling[0m wasm-bindgen-futures v0.4.80
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
node:internal/errors:999
  const err = new Error(message);
              ^

Error: Command failed: cargo build --profile ship --target wasm32-unknown-unknown --manifest-path crates/solenoid-graph/Cargo.toml --target-dir crates/solenoid-graph/target --features plugin
    at genericNodeError (node:internal/errors:999:15)
    at wrappedFn (node:internal/errors:544:14)
    at checkExecSyncError (node:child_process:990:11)
    at execFileSync (node:child_process:1026:15)
    at run (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:12:28)
    at build (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:75:3)
    at file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:93:1
    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)
    at async node:internal/modules/esm/loader:650:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:105:5) {
  status: 101,
  signal: null,
  output: [ null, null, null ],
  pid: 11094,
  stdout: null,
  stderr: null
}

Node.js v26.13.1
```

</details>

<details><summary>❌ crates/solenoid-core: clippy</summary>

`cargo clippy --manifest-path crates/solenoid-core/Cargo.toml --all-targets -- -D warnings`

```
[1m[92m   Compiling[0m multiversion_no_op v1.0.0
[1m[92m    Checking[0m core_detect v1.0.0
[1m[92m   Compiling[0m getrandom v0.4.3
[1m[92m    Checking[0m adler2 v2.0.1
[1m[92m    Checking[0m miniz_oxide v0.9.1
[1m[92m    Checking[0m indexmap v2.14.2
[1m[92m    Checking[0m digest v0.11.3
[1m[92m   Compiling[0m syn v3.0.10
[1m[92m    Checking[0m bumpalo v3.20.4
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m    Checking[0m log v0.4.35
[1m[92m    Checking[0m zlib-rs v0.6.9
[1m[92m    Checking[0m flate2 v1.1.11
[1m[92m    Checking[0m zopfli v0.8.4
[1m[92m    Checking[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m    Checking[0m itoa v1.0.19
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m    Checking[0m typed-path v0.13.0
[1m[92m   Compiling[0m serde_derive v1.0.229
[1m[92m    Checking[0m cpufeatures v0.3.1
[1m[92m    Checking[0m debug_unsafe v0.1.4
[1m[92m    Checking[0m jiff-core v0.1.8
[1m[92m    Checking[0m bit-vec v0.8.0
[1m[92m   Compiling[0m g2poly v1.2.2
[1m[92m    Checking[0m bit-set v0.8.0
[1m[92m    Checking[0m atoi_simd v0.18.1
[1m[92m    Checking[0m jiff v0.2.46
[1m[92m    Checking[0m regex-automata v0.4.19
[1m[92m    Checking[0m quick-xml v0.42.0
[1m[92m    Checking[0m codepage v0.1.3
[1m[92m    Checking[0m csv-core v0.1.13
[1m[92m    Checking[0m fast-float2 v0.2.4
[1m[92m    Checking[0m byteorder v1.5.0
[1m[92m    Checking[0m jiff-tzdb v1.0.0
[1m[92m    Checking[0m tinyvec v1.13.3
[1m[92m    Checking[0m ryu v1.0.23
[1m[92m    Checking[0m jiff-core v1.0.2
[1m[92m    Checking[0m ryu-js v1.0.4
[1m[92m    Checking[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m    Checking[0m jiff v1.0.3
[1m[92m    Checking[0m unicode-normalization v0.1.26
[1m[92m    Checking[0m csv v1.4.0
[1m[92m    Checking[0m fancy-regex v0.20.2
[1m[92m    Checking[0m sha1 v0.11.0
[1m[92m    Checking[0m sha2 v0.11.2
[1m[92m    Checking[0m md-5 v0.11.0
[1m[92m    Checking[0m lru v0.18.5
[1m[92m    Checking[0m fastrand v2.5.0
[1m[92m    Checking[0m strsim v0.11.1
[1m[92m    Checking[0m rustc-hash v2.1.3
[1m[92m    Checking[0m qrcodegen v1.8.0
[1m[92m    Checking[0m base64 v0.23.1
[1m[92m    Checking[0m uuid v1.29.3
[1m[92m   Compiling[0m zeroize_derive v1.5.0
[1m[92m   Compiling[0m logos-derive v0.15.1
[1m[92m    Checking[0m logos v0.15.1
[1m[92m   Compiling[0m g2gen v1.2.2
[1m[92m    Checking[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m    Checking[0m g2p v1.2.2
[1m[92m    Checking[0m rqrr v0.11.0
[1m[92m    Checking[0m zeroize v1.9.2
[1m[92m    Checking[0m zip v9.8.2
[1m[92m    Checking[0m calamine v0.38.0
[1m[92m    Checking[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0msrc/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
[1m[33mwarning[0m: build failed, waiting for other jobs to finish...
[1m[91merror[0m: could not compile `solenoid-core` (lib test) due to 1 previous error
```

</details>

<details><summary>❌ crates/solenoid-core: tests</summary>

`cargo test --manifest-path crates/solenoid-core/Cargo.toml`

```
[1m[92m   Compiling[0m adler2 v2.0.1
[1m[92m   Compiling[0m scopeguard v1.2.0
[1m[92m   Compiling[0m equivalent v1.0.3
[1m[92m   Compiling[0m indexmap v2.14.2
[1m[92m   Compiling[0m encoding_rs v0.8.44
[1m[92m   Compiling[0m digest v0.11.3
[1m[92m   Compiling[0m miniz_oxide v0.9.1
[1m[92m   Compiling[0m libc v0.2.191
[1m[92m   Compiling[0m zlib-rs v0.6.9
[1m[92m   Compiling[0m bumpalo v3.20.4
[1m[92m   Compiling[0m log v0.4.35
[1m[92m   Compiling[0m zopfli v0.8.4
[1m[92m   Compiling[0m getrandom v0.4.3
[1m[92m   Compiling[0m zeroize v1.9.2
[1m[92m   Compiling[0m constant_time_eq v0.6.2
[1m[92m   Compiling[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m bit-vec v0.8.0
[1m[92m   Compiling[0m flate2 v1.1.11
[1m[92m   Compiling[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m regex-syntax v0.8.12
[1m[92m   Compiling[0m itoa v1.0.19
[1m[92m   Compiling[0m jiff-core v0.1.8
[1m[92m   Compiling[0m g2poly v1.2.2
[1m[92m   Compiling[0m typed-path v0.13.0
[1m[92m   Compiling[0m cpufeatures v0.3.1
[1m[92m   Compiling[0m g2gen v1.2.2
[1m[92m   Compiling[0m zip v9.8.2
[1m[92m   Compiling[0m jiff v0.2.46
[1m[92m   Compiling[0m regex-automata v0.4.19
[1m[92m   Compiling[0m atoi_simd v0.18.1
[1m[92m   Compiling[0m bit-set v0.8.0
[1m[92m   Compiling[0m logos v0.15.1
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m   Compiling[0m codepage v0.1.3
[1m[92m   Compiling[0m quick-xml v0.42.0
[1m[92m   Compiling[0m csv-core v0.1.13
[1m[92m   Compiling[0m fast-float2 v0.2.4
[1m[92m   Compiling[0m jiff-tzdb v1.0.0
[1m[92m   Compiling[0m jiff-core v1.0.2
[1m[92m   Compiling[0m ryu-js v1.0.4
[1m[92m   Compiling[0m byteorder v1.5.0
[1m[92m   Compiling[0m ryu v1.0.23
[1m[92m   Compiling[0m tinyvec v1.13.3
[1m[92m   Compiling[0m calamine v0.38.0
[1m[92m   Compiling[0m csv v1.4.0
[1m[92m   Compiling[0m unicode-normalization v0.1.26
[1m[92m   Compiling[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m   Compiling[0m jiff v1.0.3
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m   Compiling[0m fancy-regex v0.20.2
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m g2p v1.2.2
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m   Compiling[0m sha1 v0.11.0
[1m[92m   Compiling[0m sha2 v0.11.2
[1m[92m   Compiling[0m md-5 v0.11.0
[1m[92m   Compiling[0m lru v0.18.5
[1m[92m   Compiling[0m rustc-hash v2.1.3
[1m[92m   Compiling[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m fastrand v2.5.0
[1m[92m   Compiling[0m strsim v0.11.1
[1m[92m   Compiling[0m base64 v0.23.1
[1m[92m   Compiling[0m uuid v1.29.3
[1m[92m   Compiling[0m rqrr v0.11.0
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0msrc/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
[1m[33mwarning[0m: build failed, waiting for other jobs to finish...
[1m[91merror[0m: could not compile `solenoid-core` (lib test) due to 1 previous error
```

</details>

<details><summary>❌ crates/solenoid-graph: clippy</summary>

`cargo clippy --manifest-path crates/solenoid-graph/Cargo.toml --all-targets -- -D warnings`

```
[1m[92m    Checking[0m core_detect v1.0.0
[1m[92m    Checking[0m hashbrown v0.17.2
[1m[92m    Checking[0m simdutf8 v0.1.5
[1m[92m   Compiling[0m lazy_static v1.5.1
[1m[92m   Compiling[0m fnv v1.0.7
[1m[92m   Compiling[0m beef v0.5.2
[1m[92m   Compiling[0m multiversion_no_op v1.0.0
[1m[92m    Checking[0m indexmap v2.14.2
[1m[92m    Checking[0m miniz_oxide v0.9.1
[1m[92m    Checking[0m digest v0.11.3
[1m[92m   Compiling[0m syn v3.0.10
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m   Compiling[0m getrandom v0.3.4
[1m[92m    Checking[0m zlib-rs v0.6.9
[1m[92m    Checking[0m log v0.4.35
[1m[92m    Checking[0m bumpalo v3.20.4
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m    Checking[0m zopfli v0.8.4
[1m[92m    Checking[0m flate2 v1.1.11
[1m[92m    Checking[0m aho-corasick v1.1.5
[1m[92m    Checking[0m itoa v1.0.19
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m    Checking[0m debug_unsafe v0.1.4
[1m[92m    Checking[0m cpufeatures v0.3.1
[1m[92m    Checking[0m jiff-core v0.1.8
[1m[92m    Checking[0m bit-vec v0.8.0
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m    Checking[0m typed-path v0.13.0
[1m[92m    Checking[0m regex-automata v0.4.19
[1m[92m    Checking[0m bit-set v0.8.0
[1m[92m    Checking[0m jiff v0.2.46
[1m[92m   Compiling[0m serde_derive v1.0.229
[1m[92m    Checking[0m atoi_simd v0.18.1
[1m[92m    Checking[0m codepage v0.1.3
[1m[92m    Checking[0m quick-xml v0.42.0
[1m[92m    Checking[0m csv-core v0.1.13
[1m[92m    Checking[0m jiff-core v1.0.2
[1m[92m    Checking[0m ryu-js v1.0.4
[1m[92m    Checking[0m fast-float2 v0.2.4
[1m[92m    Checking[0m byteorder v1.5.0
[1m[92m    Checking[0m foldhash v0.2.0
[1m[92m    Checking[0m jiff-tzdb v1.0.0
[1m[92m    Checking[0m tinyvec v1.13.3
[1m[92m    Checking[0m ryu v1.0.23
[1m[92m    Checking[0m csv v1.4.0
[1m[92m    Checking[0m unicode-normalization v0.1.26
[1m[92m    Checking[0m jiff v1.0.3
[1m[92m    Checking[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m    Checking[0m netcore v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m    Checking[0m fancy-regex v0.20.2
[1m[92m    Checking[0m sha2 v0.11.2
[1m[92m    Checking[0m sha1 v0.11.0
[1m[92m    Checking[0m md-5 v0.11.0
[1m[92m    Checking[0m qrcodegen v1.8.0
[1m[92m    Checking[0m base64 v0.23.1
[1m[92m    Checking[0m fastrand v2.5.0
[1m[92m    Checking[0m uuid v1.29.3
[1m[92m    Checking[0m rustc-hash v2.1.3
[1m[92m    Checking[0m strsim v0.11.1
[1m[92m    Checking[0m netcore-engine v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m zeroize_derive v1.5.0
[1m[92m   Compiling[0m logos-derive v0.15.1
[1m[92m    Checking[0m logos v0.15.1
[1m[92m    Checking[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m    Checking[0m zeroize v1.9.2
[1m[92m    Checking[0m zip v9.8.2
[1m[92m    Checking[0m calamine v0.38.0
[1m[92m    Checking[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
```

</details>

<details><summary>❌ crates/solenoid-graph: tests</summary>

`cargo test --manifest-path crates/solenoid-graph/Cargo.toml`

```
[1m[92m   Compiling[0m block-buffer v0.12.1
[1m[92m   Compiling[0m core_detect v1.0.0
[1m[92m   Compiling[0m scopeguard v1.2.0
[1m[92m   Compiling[0m equivalent v1.0.3
[1m[92m   Compiling[0m adler2 v2.0.1
[1m[92m   Compiling[0m simdutf8 v0.1.5
[1m[92m   Compiling[0m hashbrown v0.17.2
[1m[92m   Compiling[0m encoding_rs v0.8.44
[1m[92m   Compiling[0m indexmap v2.14.2
[1m[92m   Compiling[0m digest v0.11.3
[1m[92m   Compiling[0m miniz_oxide v0.9.1
[1m[92m   Compiling[0m log v0.4.35
[1m[92m   Compiling[0m bumpalo v3.20.4
[1m[92m   Compiling[0m zlib-rs v0.6.9
[1m[92m   Compiling[0m zopfli v0.8.4
[1m[92m   Compiling[0m zeroize v1.9.2
[1m[92m   Compiling[0m constant_time_eq v0.6.2
[1m[92m   Compiling[0m getrandom v0.4.3
[1m[92m   Compiling[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m jiff-core v0.1.8
[1m[92m   Compiling[0m flate2 v1.1.11
[1m[92m   Compiling[0m typed-path v0.13.0
[1m[92m   Compiling[0m bit-vec v0.8.0
[1m[92m   Compiling[0m cpufeatures v0.3.1
[1m[92m   Compiling[0m itoa v1.0.19
[1m[92m   Compiling[0m regex-syntax v0.8.12
[1m[92m   Compiling[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m regex-automata v0.4.19
[1m[92m   Compiling[0m atoi_simd v0.18.1
[1m[92m   Compiling[0m zip v9.8.2
[1m[92m   Compiling[0m bit-set v0.8.0
[1m[92m   Compiling[0m jiff v0.2.46
[1m[92m   Compiling[0m logos v0.15.1
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m   Compiling[0m getrandom v0.3.4
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m   Compiling[0m codepage v0.1.3
[1m[92m   Compiling[0m quick-xml v0.42.0
[1m[92m   Compiling[0m csv-core v0.1.13
[1m[92m   Compiling[0m foldhash v0.2.0
[1m[92m   Compiling[0m ryu-js v1.0.4
[1m[92m   Compiling[0m jiff-tzdb v1.0.0
[1m[92m   Compiling[0m tinyvec v1.13.3
[1m[92m   Compiling[0m ryu v1.0.23
[1m[92m   Compiling[0m jiff-core v1.0.2
[1m[92m   Compiling[0m byteorder v1.5.0
[1m[92m   Compiling[0m fast-float2 v0.2.4
[1m[92m   Compiling[0m calamine v0.38.0
[1m[92m   Compiling[0m jiff v1.0.3
[1m[92m   Compiling[0m csv v1.4.0
[1m[92m   Compiling[0m unicode-normalization v0.1.26
[1m[92m   Compiling[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m netcore v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m fancy-regex v0.20.2
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m   Compiling[0m sha2 v0.11.2
[1m[92m   Compiling[0m sha1 v0.11.0
[1m[92m   Compiling[0m md-5 v0.11.0
[1m[92m   Compiling[0m strsim v0.11.1
[1m[92m   Compiling[0m base64 v0.23.1
[1m[92m   Compiling[0m fastrand v2.5.0
[1m[92m   Compiling[0m uuid v1.29.3
[1m[92m   Compiling[0m rustc-hash v2.1.3
[1m[92m   Compiling[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m netcore-engine v0.1.0 (https://github.com/bubba8587/netcore-rs?rev=68e667f650dda9a3e2534b633af7da076ba4e2a1#68e667f6)
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
```

</details>

<details><summary>❌ crates/solenoid-parquet: clippy</summary>

`cargo clippy --manifest-path crates/solenoid-parquet/Cargo.toml --all-targets -- -D warnings`

```
[1m[92m    Checking[0m arrow-data v60.2.0
[1m[92m    Checking[0m alloc-stdlib v0.3.0
[1m[92m   Compiling[0m logos-derive v0.15.1
[1m[92m    Checking[0m zeroize v1.9.2
[1m[92m    Checking[0m arrow-array v60.2.0
[1m[92m    Checking[0m lexical-parse-integer v1.0.6
[1m[92m    Checking[0m lexical-write-integer v1.0.6
[1m[92m   Compiling[0m serde_derive v1.0.229
[1m[92m    Checking[0m aho-corasick v1.1.5
[1m[92m    Checking[0m ryu v1.0.23
[1m[92m    Checking[0m bitflags v2.13.2
[1m[92m   Compiling[0m snap v1.1.2
[1m[92m    Checking[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m    Checking[0m typed-path v0.13.0
[1m[92m    Checking[0m arrow-cmp v60.2.0
[1m[92m    Checking[0m jiff-core v0.1.8
[1m[92m    Checking[0m arrow-select v60.2.0
[1m[92m    Checking[0m bit-vec v0.8.0
[1m[92m    Checking[0m base64 v0.23.1
[1m[92m    Checking[0m itoa v1.0.19
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m    Checking[0m cpufeatures v0.3.1
[1m[92m    Checking[0m bit-set v0.8.0
[1m[92m    Checking[0m jiff v0.2.46
[1m[92m    Checking[0m zip v9.8.2
[1m[92m    Checking[0m atoi_simd v0.18.1
[1m[92m    Checking[0m lexical-write-float v1.0.6
[1m[92m    Checking[0m regex-automata v0.4.19
[1m[92m    Checking[0m lexical-parse-float v1.0.6
[1m[92m    Checking[0m logos v0.15.1
[1m[92m    Checking[0m brotli-decompressor v6.4.0
[1m[92m    Checking[0m quick-xml v0.42.0
[1m[92m    Checking[0m codepage v0.1.3
[1m[92m    Checking[0m csv-core v0.1.13
[1m[92m    Checking[0m jiff-tzdb v1.0.0
[1m[92m    Checking[0m foldhash v0.2.0
[1m[92m    Checking[0m byteorder v1.5.0
[1m[92m    Checking[0m twox-hash v2.1.5
[1m[92m    Checking[0m jiff-core v1.0.2
[1m[92m    Checking[0m tinyvec v1.13.3
[1m[92m    Checking[0m ryu-js v1.0.4
[1m[92m    Checking[0m fast-float2 v0.2.4
[1m[92m    Checking[0m calamine v0.38.0
[1m[92m    Checking[0m unicode-normalization v0.1.26
[1m[92m    Checking[0m jiff v1.0.3
[1m[92m    Checking[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m    Checking[0m fancy-regex v0.20.2
[1m[92m    Checking[0m lz4_flex v0.14.2
[1m[92m    Checking[0m csv v1.4.0
[1m[92m    Checking[0m brotli v9.1.3
[1m[92m    Checking[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m    Checking[0m lexical-core v1.0.6
[1m[92m    Checking[0m arrow-ipc v60.2.0
[1m[92m    Checking[0m zstd v0.14.5
[1m[92m    Checking[0m arrow-ord v60.2.0
[1m[92m    Checking[0m sha1 v0.11.0
[1m[92m    Checking[0m sha2 v0.11.2
[1m[92m    Checking[0m md-5 v0.11.0
[1m[92m    Checking[0m atoi v3.1.1
[1m[92m    Checking[0m uuid v1.29.3
[1m[92m    Checking[0m rustc-hash v2.1.3
[1m[92m    Checking[0m qrcodegen v1.8.0
[1m[92m    Checking[0m strsim v0.11.1
[1m[92m   Compiling[0m seq-macro v0.3.6
[1m[92m    Checking[0m fastrand v2.5.0
[1m[92m    Checking[0m arrow-cast v60.2.0
[1m[92m    Checking[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[92m    Checking[0m parquet v60.2.0
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
```

</details>

<details><summary>❌ crates/solenoid-parquet: tests</summary>

`cargo test --manifest-path crates/solenoid-parquet/Cargo.toml`

```
[1m[92m   Compiling[0m zopfli v0.8.4
[1m[92m   Compiling[0m zstd-safe v8.4.0
[1m[92m   Compiling[0m zeroize v1.9.2
[1m[92m   Compiling[0m constant_time_eq v0.6.2
[1m[92m   Compiling[0m lexical-write-integer v1.0.6
[1m[92m   Compiling[0m lexical-parse-integer v1.0.6
[1m[92m   Compiling[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m regex-syntax v0.8.12
[1m[92m   Compiling[0m cpufeatures v0.3.1
[1m[92m   Compiling[0m itoa v1.0.19
[1m[92m   Compiling[0m base64 v0.23.1
[1m[92m   Compiling[0m debug_unsafe v0.1.4
[1m[92m   Compiling[0m typed-path v0.13.0
[1m[92m   Compiling[0m jiff-core v0.1.8
[1m[92m   Compiling[0m ryu v1.0.23
[1m[92m   Compiling[0m bit-vec v0.8.0
[1m[92m   Compiling[0m bitflags v2.13.2
[1m[92m   Compiling[0m flatbuffers v25.12.19
[1m[92m   Compiling[0m jiff v0.2.46
[1m[92m   Compiling[0m bit-set v0.8.0
[1m[92m   Compiling[0m zip v9.8.2
[1m[92m   Compiling[0m regex-automata v0.4.19
[1m[92m   Compiling[0m atoi_simd v0.18.1
[1m[92m   Compiling[0m lexical-write-float v1.0.6
[1m[92m   Compiling[0m lexical-parse-float v1.0.6
[1m[92m   Compiling[0m logos v0.15.1
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m   Compiling[0m brotli-decompressor v6.4.0
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m   Compiling[0m quick-xml v0.42.0
[1m[92m   Compiling[0m codepage v0.1.3
[1m[92m   Compiling[0m csv-core v0.1.13
[1m[92m   Compiling[0m jiff-tzdb v1.0.0
[1m[92m   Compiling[0m fast-float2 v0.2.4
[1m[92m   Compiling[0m byteorder v1.5.0
[1m[92m   Compiling[0m jiff-core v1.0.2
[1m[92m   Compiling[0m foldhash v0.2.0
[1m[92m   Compiling[0m twox-hash v2.1.5
[1m[92m   Compiling[0m tinyvec v1.13.3
[1m[92m   Compiling[0m ryu-js v1.0.4
[1m[92m   Compiling[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m   Compiling[0m unicode-normalization v0.1.26
[1m[92m   Compiling[0m jiff v1.0.3
[1m[92m   Compiling[0m lz4_flex v0.14.2
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m   Compiling[0m calamine v0.38.0
[1m[92m   Compiling[0m csv v1.4.0
[1m[92m   Compiling[0m brotli v9.1.3
[1m[92m   Compiling[0m zstd v0.14.5
[1m[92m   Compiling[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m   Compiling[0m lexical-core v1.0.6
[1m[92m   Compiling[0m fancy-regex v0.20.2
[1m[92m   Compiling[0m arrow-ipc v60.2.0
[1m[92m   Compiling[0m snap v1.1.2
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m arrow-ord v60.2.0
[1m[92m   Compiling[0m sha2 v0.11.2
[1m[92m   Compiling[0m sha1 v0.11.0
[1m[92m   Compiling[0m md-5 v0.11.0
[1m[92m   Compiling[0m atoi v3.1.1
[1m[92m   Compiling[0m fastrand v2.5.0
[1m[92m   Compiling[0m uuid v1.29.3
[1m[92m   Compiling[0m rustc-hash v2.1.3
[1m[92m   Compiling[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m strsim v0.11.1
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[92m   Compiling[0m parquet v60.2.0
[1m[92m   Compiling[0m arrow-cast v60.2.0
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0m/home/runner/work/solenoid/solenoid/crates/solenoid-core/src/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
[1m[33mwarning[0m: build failed, waiting for other jobs to finish...
```

</details>

<details><summary>❌ crates/solenoid-core: clippy (wasm)</summary>

`cargo clippy --manifest-path crates/solenoid-core/Cargo.toml --target wasm32-unknown-unknown -- -D warnings`

```
[1m[92m   Compiling[0m multiversion_no_op v1.0.0
[1m[92m   Compiling[0m fnv v1.0.7
[1m[92m   Compiling[0m beef v0.5.2
[1m[92m   Compiling[0m getrandom v0.4.3
[1m[92m   Compiling[0m lazy_static v1.5.1
[1m[92m    Checking[0m hashbrown v0.17.2
[1m[92m    Checking[0m indexmap v2.14.2
[1m[92m    Checking[0m digest v0.11.3
[1m[92m   Compiling[0m zmij v1.0.23
[1m[92m    Checking[0m simd-adler32 v0.3.10
[1m[92m   Compiling[0m serde v1.0.229
[1m[92m    Checking[0m log v0.4.35
[1m[92m    Checking[0m bumpalo v3.20.4
[1m[92m    Checking[0m zlib-rs v0.6.9
[1m[92m    Checking[0m flate2 v1.1.11
[1m[92m    Checking[0m zopfli v0.8.4
[1m[92m    Checking[0m aho-corasick v1.1.5
[1m[92m   Compiling[0m zeroize_derive v1.5.0
[1m[92m   Compiling[0m logos-derive v0.15.1
[1m[92m    Checking[0m pin-project-lite v0.2.18
[1m[92m   Compiling[0m unicode-general-category v1.1.0
[1m[92m   Compiling[0m serde_derive v1.0.229
[1m[92m    Checking[0m jiff-core v0.1.8
[1m[92m   Compiling[0m libm v0.2.16
[1m[92m    Checking[0m debug_unsafe v0.1.4
[1m[92m    Checking[0m futures-task v0.3.34
[1m[92m    Checking[0m bit-vec v0.8.0
[1m[92m    Checking[0m futures-core v0.3.34
[1m[92m   Compiling[0m serde_json v1.0.154
[1m[92m    Checking[0m itoa v1.0.19
[1m[92m    Checking[0m slab v0.4.12
[1m[92m    Checking[0m typed-path v0.13.0
[1m[92m    Checking[0m futures-util v0.3.34
[1m[92m    Checking[0m regex-automata v0.4.19
[1m[92m    Checking[0m zeroize v1.9.2
[1m[92m    Checking[0m bit-set v0.8.0
[1m[92m    Checking[0m atoi_simd v0.18.1
[1m[92m    Checking[0m jiff v0.2.46
[1m[92m    Checking[0m logos v0.15.1
[1m[92m    Checking[0m codepage v0.1.3
[1m[92m    Checking[0m quick-xml v0.42.0
[1m[92m    Checking[0m csv-core v0.1.13
[1m[92m    Checking[0m ryu v1.0.23
[1m[92m    Checking[0m jiff-tzdb v1.0.0
[1m[92m    Checking[0m byteorder v1.5.0
[1m[92m    Checking[0m fast-float2 v0.2.4
[1m[92m    Checking[0m foldhash v0.2.0
[1m[92m    Checking[0m jiff-core v1.0.2
[1m[92m    Checking[0m tinyvec v1.13.3
[1m[92m    Checking[0m ryu-js v1.0.4
[1m[92m    Checking[0m solenoid-schedule v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-schedule)
[1m[92m    Checking[0m jiff v1.0.3
[1m[92m    Checking[0m unicode-normalization v0.1.26
[1m[92m    Checking[0m interim v0.2.1 (/home/runner/work/solenoid/solenoid/crates/vendor/interim)
[1m[92m    Checking[0m csv v1.4.0
[1m[92m    Checking[0m fancy-regex v0.20.2
[1m[92m    Checking[0m sha1 v0.11.0
[1m[92m    Checking[0m sha2 v0.11.2
[1m[92m    Checking[0m md-5 v0.11.0
[1m[92m    Checking[0m base64 v0.23.1
[1m[92m    Checking[0m strsim v0.11.1
[1m[92m    Checking[0m uuid v1.29.3
[1m[92m    Checking[0m rustc-hash v2.1.3
[1m[92m    Checking[0m qrcodegen v1.8.0
[1m[92m   Compiling[0m wasm-bindgen-macro v0.2.130
[1m[92m    Checking[0m js-sys v0.3.107
[1m[92m    Checking[0m zip v9.8.2
[1m[92m    Checking[0m calamine v0.38.0
[1m[92m    Checking[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[91merror[E0599][0m[1m: no method named `to_zoned` found for struct `jiff::Timestamp` in the current scope[0m
  [1m[94m--> [0msrc/relative_date.rs:81:72
   [1m[94m|[0m
[1m[94m81[0m [1m[94m|[0m     let base = Timestamp::from_millisecond(local.floor() as i64).ok()?.to_zoned(TimeZone::UTC);
   [1m[94m|[0m                                                                        [1m[91m^^^^^^^^[0m
   [1m[94m|[0m
[1m[96mhelp[0m: there is a method `to_owned` with a similar name, but with different arguments
  [1m[94m--> [0m/rustc/0ef1bc386059596dada8fb65b50425aab2ea637a/library/alloc/src/borrow.rs:48:4

[1mFor more information about this error, try `rustc --explain E0599`.[0m
[1m[91merror[0m: could not compile `solenoid-core` (lib) due to 1 previous error
```

</details>

<details><summary>❌ Desktop shell compiles (src-tauri)</summary>

`cargo check --manifest-path src-tauri/Cargo.toml`

```
[1m[92m    Updating[0m crates.io index
[1m[91merror[0m: failed to select a version for `reqwest`.
    ... required by package `solenoid v1.6.2 (/home/runner/work/solenoid/solenoid/src-tauri)`
versions that meet the requirements `^0.13` are: 0.13.5, 0.13.4, 0.13.3, 0.13.2, 0.13.1, 0.13.0

package `solenoid` depends on `reqwest` with feature `rustls-tls` but `reqwest` does not have that feature.
help: available features: __native-tls, __native-tls-alpn, __rustls, __rustls-aws-lc-rs, __tls, blocking, brotli, charset, cookies, default, default-tls, deflate, form, gzip, h2, hickory-dns, http2, http3, json, multipart, native-tls, native-tls-no-alpn, native-tls-vendored, native-tls-vendored-no-alpn, query, rustls, rustls-native-certs, rustls-no-provider, socks, stream, system-proxy, webpki-roots, zstd


failed to select a version for `reqwest` which could resolve this conflict
```

</details>


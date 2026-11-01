# Bleeding edge, 2026-11-01

Every dependency at its newest release and the newest platform features tried out, rebased onto `develop` @ `af2c5550b` by `.github/workflows/bleeding-edge.yml`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**Every check passes.** Today 3 direct dependencies moved (2 across a major), 35 transitive. rustc 1.99.1 (58cf8f9c3 2026-10-13), Node v24.22.1.

## This branch on its base

Rebased from `9aa5a5d1a` onto `develop` @ `af2c5550b`: 16 commits carried, one bump added.

- `a5d543798` Bleeding edge 2026-10-30: every dependency at its newest, on rust-port
- `89aeb9627` Edge: text-fit: the Dashboard half box's glyph-width estimate
- `8c6672d39` Bleeding edge: the experiments ledger
- `de0267259` Bleeding edge: its leaves and specs, on this branch only, and ready-to-port verdicts
- `a09e61208` Bleeding edge: uuids for its leaves, and the renumbering in its spec
- `8684c7588` Bleeding edge: four platform features ported to rust-port
- `0bab87f59` Bleeding edge: focusgroup ported too
- `30dec07c3` Bleeding edge: a ready finding ports as it stands
- `4bd3103db` Bleeding edge: the wasm-bindgen 0.2.130 port is on rust-port
- `638e730c8` Bleeding edge: a finding is one commit, ported with port.mjs
- `69be40c9c` Bleeding edge 2026-10-31: dependencies to their newest
- `a96401a56` Bleeding edge: the report lists the toolchain that moved since the last run, with its release notes
- `f0f0a3618` Bleeding edge: build with the newest stable Rust, not the work branches' pin
- `f4a9705d7` Bleeding edge: the toolchain and dependency features in use, from their release notes
- `df9e90404` B26 edgeReadsReleaseNotes: every bump on bleeding-edge is read through its release notes
- `480dadc9c` Bleeding edge: the release notes read for the 23 dependencies ahead of rust-port

**Dropped: 2 commits conflicted with new work** outside the dependency files. Each is still on `bleeding-edge-prev`; redo it on top of this branch if it's still wanted.

- ❌ `ead5bd681` Edge: Rust 2024 edition: let chains replace nested if-lets (conflicts in `crates/solenoid-core/src/nodes/list.rs`, `crates/solenoid-graph/src/boundary.rs`, `crates/solenoid-graph/src/direct.rs`, `src/graph/engineWasm/solenoid_graph_bg.wasm`, `src/graph/engineWasm/source-stamp.txt`)
- ❌ `ea43a26dd` Bleeding edge: the Rust findings are ported; the port runs each touched crate's Rust checks (conflicts in `.github/bleeding-edge/port.mjs`)

**Findings: 0 of 1 port onto `develop` alone** (cherry-picked with `port.mjs`, generated files rebuilt, typecheck and unit tests run there). Whether a finding is ready also takes the engine check in its spec row.

- ❌ `89aeb9627` Edge: text-fit: the Dashboard half box's glyph-width estimate: Edge: text-fit: the Dashboard half box's glyph-width estimate

<details><summary>Why `89aeb9627` doesn't port</summary>

```
Edge: text-fit: the Dashboard half box's glyph-width estimate

A phone's half box sized its value from the character count (a glyph taken as 0.6 em, 130cqw over --chars), which misjudged commas and currency signs, so neighbors drew at different widths. text-fit: shrink sets the value at its largest size and shrinks it to 86% of the box by the text's own measure; --chars is gone from the three components that set it. A counting value pads to its final length with figure spaces, so it fits once and holds still.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BJp3bVvDK9qNZ5oxC2FHcC

Ported from bleeding-edge 89aeb9627.
PORT_MSG
Author identity unknown

*** Please tell me who you are.

Run

  git config --global user.email "you@example.com"
  git config --global user.name "Your Name"

to set your account's default identity.
Omit --global to set the identity only in this repository.

fatal: empty ident name (for <runner@runnervm48cm3.t2lhhf2v0huelkhzvzbikqqxyh.dx.internal.cloudapp.net>) not allowed

    at must (file:///home/runner/work/_temp/port.mjs:35:78)
    at file:///home/runner/work/_temp/port.mjs:148:3
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.22.1
```

</details>

<details><summary>21 npm direct dependencies ahead of develop</summary>

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
| `dompurify` | ^3.4.16 | ^3.4.17 |
| `elkjs` | ^0.12.0 | ^0.12.1 |
| `katex` | ^0.19.0 | ^0.19.1 |
| `magic-string` | 0.30.21 | 1.4.5 |
| `marked` | ^18.1.0 | ^18.1.2 |
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
| ✅ | Engine module builds (npm run build:wasm) | 84s |
| ✅ | Site snapshots regenerate (node scripts/prerender-site.mjs) | 24s |
| ✅ | Typecheck | 1s |
| ✅ | Unit tests | 44s |
| ✅ | Site build | 4s |
| ✅ | Headless CLI build | 2s |
| ✅ | Obsidian plugin build | 2s |
| ✅ | crates/solenoid-core: clippy | 20s |
| ✅ | crates/solenoid-core: tests | 153s |
| ✅ | crates/solenoid-graph: clippy | 18s |
| ✅ | crates/solenoid-graph: tests | 36s |
| ✅ | crates/solenoid-parquet: clippy | 28s |
| ✅ | crates/solenoid-parquet: tests | 52s |
| ✅ | crates/solenoid-schedule: clippy | 3s |
| ✅ | crates/solenoid-schedule: tests | 4s |
| ✅ | crates/solenoid-core: clippy (wasm) | 29s |
| ✅ | Desktop shell compiles (src-tauri) | 106s |

## Direct dependencies that moved today

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
| ⚠️ major | `magic-string` | npm | 0.30.21 | 1.4.5 | [releases](https://github.com/Rich-Harris/magic-string/releases) |
| ⚠️ major | `three` | npm | 0.186.1 | 0.187.0 | [releases](https://github.com/mrdoob/three/releases) |
|  | `@lezer/common` | npm | 1.5.4 | 1.5.5 | [releases](https://www.npmjs.com/package/@lezer/common?activeTab=versions) |

<details><summary>35 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `@lezer/lr` | npm | 1.4.11 | 1.4.12 |
| `@rollup/rollup-android-arm-eabi` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-android-arm64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-android-x64` | npm | (new) | 4.67.4 |
| `@rollup/rollup-darwin-arm64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-darwin-x64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-freebsd-arm64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-freebsd-x64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-arm-gnueabihf` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-arm-musleabihf` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-arm64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-arm64-musl` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-loong64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-loong64-musl` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-ppc64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-ppc64-musl` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-riscv64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-riscv64-musl` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-s390x-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-x64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-linux-x64-musl` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-openbsd-x64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-openharmony-arm64` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-win32-arm64-msvc` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-win32-ia32-msvc` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-win32-x64-gnu` | npm | 4.66.0 | 4.67.4 |
| `@rollup/rollup-win32-x64-msvc` | npm | 4.66.0 | 4.67.4 |
| `@types/estree (in rollup)` | npm | 1.0.9 | (gone) |
| `es-toolkit` | npm | 1.53.0 | 1.53.1 |
| `magic-string (in @vitest/mocker)` | npm | 1.4.5 | (gone) |
| `magic-string (in rollup-plugin-license)` | npm | (new) | 0.30.21 |
| `magic-string (in vitest)` | npm | 1.4.5 | (gone) |
| `rollup` | npm | 4.66.0 | 4.67.4 |
| `tinybench` | npm | 6.2.2 | 6.2.3 |
| `ws` | npm | 8.22.0 | 8.22.1 |

</details>

## Security audits

- npm: none
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: none

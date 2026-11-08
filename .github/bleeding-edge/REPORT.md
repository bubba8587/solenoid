# Bleeding edge, 2026-11-08

Every dependency at its newest release and the newest platform features tried out, rebased onto `develop` @ `ef6f3104a` by `.github/workflows/bleeding-edge.yml`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**Every check passes.** Today 1 direct dependencies moved (0 across a major), 34 transitive. rustc 1.99.1 (58cf8f9c3 2026-10-13), Node v26.13.0.

## This branch on its base

Rebased from `d493e6290` onto `develop` @ `ef6f3104a`: 23 commits carried, one bump added.

- `09cce9c14` Bleeding edge 2026-10-30: every dependency at its newest, on rust-port
- `06f5cfec0` Bleeding edge: the experiments ledger
- `d57bcc702` Bleeding edge: its leaves and specs, on this branch only, and ready-to-port verdicts
- `1c649408f` Bleeding edge: uuids for its leaves, and the renumbering in its spec
- `6934000b8` Bleeding edge: four platform features ported to rust-port
- `8982f18e7` Bleeding edge: focusgroup ported too
- `c863180af` Bleeding edge: a ready finding ports as it stands
- `67adbcd44` Bleeding edge: the wasm-bindgen 0.2.130 port is on rust-port
- `5bcc895a9` Bleeding edge: a finding is one commit, ported with port.mjs
- `028d91cda` Bleeding edge 2026-10-31: dependencies to their newest
- `0ecec56f5` Bleeding edge: the report lists the toolchain that moved since the last run, with its release notes
- `06cfd7884` Bleeding edge: build with the newest stable Rust, not the work branches' pin
- `86cfd9c4e` Bleeding edge: the toolchain and dependency features in use, from their release notes
- `723aedddb` B26 edgeReadsReleaseNotes: every bump on bleeding-edge is read through its release notes
- `92f242b75` Bleeding edge: the release notes read for the 23 dependencies ahead of rust-port
- `7c9a83847` Bleeding edge report 2026-11-01: 0 failing checks, on develop
- `fdddc45f5` Bleeding edge analysis 2026-11-01
- `68630470b` Bleeding edge 2026-11-02: dependencies to their newest
- `9f7b5cdc3` Bleeding edge 2026-11-03: dependencies to their newest
- `b6a04bd1b` Bleeding edge 2026-11-04: dependencies to their newest
- `7b130c915` Bleeding edge 2026-11-05: dependencies to their newest
- `c078fdcbe` Bleeding edge 2026-11-06: dependencies to their newest
- `52f56fda0` Bleeding edge 2026-11-07: dependencies to their newest

<details><summary>26 npm direct dependencies ahead of develop</summary>

| Package | On base | Here |
|---|---|---|
| `@anthropic-ai/sdk` | ^1.3.0 | ^1.6.0 |
| `@lezer/common` | ^1.5.3 | ^1.5.5 |
| `@tauri-apps/api` | ^2.12.2 | ^2.12.4 |
| `@tauri-apps/cli` | ^2.12.1 | ^2.12.4 |
| `@tauri-apps/plugin-dialog` | ^2.8.1 | ^2.8.4 |
| `@tauri-apps/plugin-fs` | ^2.6.0 | ^2.7.1 |
| `@tauri-apps/plugin-opener` | ^2.7.0 | ^2.7.2 |
| `@types/node` | ^26.6.5 | ^26.6.6 |
| `@types/react` | ^19.2.18 | ^19.3.0 |
| `@types/react-dom` | ^19.2.7 | ^19.3.0 |
| `@vitejs/plugin-react` | ^6.1.2 | ^6.2.1 |
| `@xyflow/react` | ^12.12.0 | ^12.12.1 |
| `@xyflow/system` | 0.0.83 | 0.0.84 |
| `dompurify` | ^3.4.16 | ^3.4.17 |
| `elkjs` | ^0.12.0 | ^0.12.1 |
| `katex` | ^0.19.0 | ^0.19.1 |
| `magic-string` | 0.30.21 | 1.4.5 |
| `marked` | ^18.1.0 | ^18.1.3 |
| `puppeteer-core` | ^25.13.0 | ^25.16.0 |
| `react` | ^19.3.0 | ^19.3.1 |
| `react-dom` | ^19.3.0 | ^19.3.1 |
| `react-is` | ^19.3.0 | ^19.3.1 |
| `three` | 0.186.1 | 0.187.0 |
| `tsrs` | 0.20.1-ts7.1.0-beta | 0.23.0-ts7.1.0-beta |
| `vite` | ^8.3.4 | ^8.3.6 |
| `vitest` | ^5.0.3 | ^5.1.0 |

</details>

## Checks

| | Check | Time |
|---|---|---|
| ✅ | Engine module builds (npm run build:wasm) | 89s |
| ✅ | Site snapshots regenerate (node scripts/prerender-site.mjs) | 32s |
| ✅ | Typecheck | 1s |
| ✅ | Unit tests | 34s |
| ✅ | Site build | 5s |
| ✅ | Headless CLI build | 2s |
| ✅ | Obsidian plugin build | 2s |
| ✅ | crates/solenoid-core: clippy | 39s |
| ✅ | crates/solenoid-core: tests | 133s |
| ✅ | crates/solenoid-graph: clippy | 39s |
| ✅ | crates/solenoid-graph: tests | 115s |
| ✅ | crates/solenoid-parquet: clippy | 28s |
| ✅ | crates/solenoid-parquet: tests | 53s |
| ✅ | crates/solenoid-schedule: clippy | 3s |
| ✅ | crates/solenoid-schedule: tests | 4s |
| ✅ | crates/solenoid-core: clippy (wasm) | 82s |
| ✅ | Desktop shell compiles (src-tauri) | 104s |

## Direct dependencies that moved today

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
|  | `jiff` | solenoid-core | 0.2.39 | 0.2.40 | [releases](https://github.com/BurntSushi/jiff/releases) |

<details><summary>34 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `ansi-regex` | npm | 6.5.0 | 6.6.0 |
| `bitflags` | solenoid-core | 1.3.2 | (gone) |
| `bitflags` | solenoid-graph | 1.3.2 | (gone) |
| `bitflags` | solenoid-parquet | 1.3.2, 2.13.2 | 2.13.2 |
| `defmt` | solenoid-core | 1.2.0 | (gone) |
| `defmt` | solenoid-graph | 1.2.0 | (gone) |
| `defmt` | solenoid-parquet | 1.2.0 | (gone) |
| `defmt` | src-tauri | 1.2.0 | (gone) |
| `defmt-macros` | solenoid-core | 1.2.0 | (gone) |
| `defmt-macros` | solenoid-graph | 1.2.0 | (gone) |
| `defmt-macros` | solenoid-parquet | 1.2.0 | (gone) |
| `defmt-macros` | src-tauri | 1.2.0 | (gone) |
| `defmt-parser` | solenoid-core | 1.1.0 | (gone) |
| `defmt-parser` | solenoid-graph | 1.1.0 | (gone) |
| `defmt-parser` | solenoid-parquet | 1.1.0 | (gone) |
| `defmt-parser` | src-tauri | 1.1.0 | (gone) |
| `jiff` | solenoid-graph | 0.2.39 | 0.2.40 |
| `jiff` | solenoid-parquet | 0.2.39 | 0.2.40 |
| `jiff` | src-tauri | 0.2.39 | 0.2.40 |
| `jiff-core` | solenoid-core | 0.1.2 | 0.1.3 |
| `jiff-core` | solenoid-graph | 0.1.2 | 0.1.3 |
| `jiff-core` | solenoid-parquet | 0.1.2 | 0.1.3 |
| `jiff-core` | src-tauri | 0.1.2 | 0.1.3 |
| `jiff-static` | solenoid-core | 0.2.39 | 0.2.40 |
| `jiff-static` | solenoid-graph | 0.2.39 | 0.2.40 |
| `jiff-static` | solenoid-parquet | 0.2.39 | 0.2.40 |
| `jiff-static` | src-tauri | 0.2.39 | 0.2.40 |
| `thiserror` | solenoid-core | 2.0.21 | (gone) |
| `thiserror` | solenoid-graph | 2.0.21 | (gone) |
| `thiserror` | solenoid-parquet | 2.0.21 | (gone) |
| `thiserror-impl` | solenoid-core | 2.0.21 | (gone) |
| `thiserror-impl` | solenoid-graph | 2.0.21 | (gone) |
| `thiserror-impl` | solenoid-parquet | 2.0.21 | (gone) |
| `ws` | npm | 8.22.1 | 8.22.2 |

</details>

## Security audits

- npm: none
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: none

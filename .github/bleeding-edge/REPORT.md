# Bleeding edge, 2026-11-06

Every dependency at its newest release and the newest platform features tried out, rebased onto `develop` @ `5bfe76215` by `.github/workflows/bleeding-edge.yml`. The branch keeps its own commits across runs: dependency bumps, fixes and experiments made here ride along on every rebase. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**Every check passes.** Today 3 direct dependencies moved (0 across a major), 11 transitive. rustc 1.99.1 (58cf8f9c3 2026-10-13), Node v26.13.0.

## This branch on its base

Rebased from `adce37018` onto `develop` @ `5bfe76215`: 21 commits carried, one bump added.

- `1097726b7` Bleeding edge 2026-10-30: every dependency at its newest, on rust-port
- `a2f0996e0` Bleeding edge: the experiments ledger
- `3f1239c4e` Bleeding edge: its leaves and specs, on this branch only, and ready-to-port verdicts
- `a8d23929f` Bleeding edge: uuids for its leaves, and the renumbering in its spec
- `0b3c2a972` Bleeding edge: four platform features ported to rust-port
- `2f566a8bf` Bleeding edge: focusgroup ported too
- `93d0fb50a` Bleeding edge: a ready finding ports as it stands
- `985832a6e` Bleeding edge: the wasm-bindgen 0.2.130 port is on rust-port
- `acc3b81cb` Bleeding edge: a finding is one commit, ported with port.mjs
- `db68d7d46` Bleeding edge 2026-10-31: dependencies to their newest
- `593e43607` Bleeding edge: the report lists the toolchain that moved since the last run, with its release notes
- `ab882e54d` Bleeding edge: build with the newest stable Rust, not the work branches' pin
- `aea8de9d9` Bleeding edge: the toolchain and dependency features in use, from their release notes
- `db10784a2` B26 edgeReadsReleaseNotes: every bump on bleeding-edge is read through its release notes
- `02daa6666` Bleeding edge: the release notes read for the 23 dependencies ahead of rust-port
- `ee83d2390` Bleeding edge report 2026-11-01: 0 failing checks, on develop
- `a34aa3dc5` Bleeding edge analysis 2026-11-01
- `af1617285` Bleeding edge 2026-11-02: dependencies to their newest
- `7309db5e3` Bleeding edge 2026-11-03: dependencies to their newest
- `2833c05de` Bleeding edge 2026-11-04: dependencies to their newest
- `8aef36520` Bleeding edge 2026-11-05: dependencies to their newest

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
| `tsrs` | 0.20.1-ts7.1.0-beta | 0.22.0-ts7.1.0-beta |
| `vite` | ^8.3.4 | ^8.3.6 |
| `vitest` | ^5.0.3 | ^5.1.0 |

</details>

## Checks

| | Check | Time |
|---|---|---|
| ✅ | Engine module builds (npm run build:wasm) | 74s |
| ✅ | Site snapshots regenerate (node scripts/prerender-site.mjs) | 24s |
| ✅ | Typecheck | 1s |
| ✅ | Unit tests | 27s |
| ✅ | Site build | 4s |
| ✅ | Headless CLI build | 1s |
| ✅ | Obsidian plugin build | 2s |
| ✅ | crates/solenoid-core: clippy | 33s |
| ✅ | crates/solenoid-core: tests | 114s |
| ✅ | crates/solenoid-graph: clippy | 34s |
| ✅ | crates/solenoid-graph: tests | 102s |
| ✅ | crates/solenoid-parquet: clippy | 25s |
| ✅ | crates/solenoid-parquet: tests | 45s |
| ✅ | crates/solenoid-schedule: clippy | 2s |
| ✅ | crates/solenoid-schedule: tests | 3s |
| ✅ | crates/solenoid-core: clippy (wasm) | 71s |
| ✅ | Desktop shell compiles (src-tauri) | 91s |

## Direct dependencies that moved today

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
|  | `@anthropic-ai/sdk` | npm | 1.5.0 | 1.6.0 | [releases](https://github.com/anthropics/anthropic-sdk-typescript/releases) |
|  | `flate2` | solenoid-core | 1.1.10 | 1.1.11 | [releases](https://github.com/rust-lang/flate2-rs/releases) |
|  | `flate2` | solenoid-graph | 1.1.10 | 1.1.11 | [releases](https://github.com/rust-lang/flate2-rs/releases) |

<details><summary>11 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `brotli-decompressor` | solenoid-parquet | 6.2.0 | 6.3.0 |
| `brotli-decompressor` | src-tauri | 6.2.0 | 6.3.0 |
| `cc` | solenoid-parquet | 1.11.0 | 1.11.1 |
| `cc` | src-tauri | 1.11.0 | 1.11.1 |
| `es-toolkit` | npm | 1.53.1 | 1.53.2 |
| `flate2` | solenoid-parquet | 1.1.10 | 1.1.11 |
| `flate2` | src-tauri | 1.1.10 | 1.1.11 |
| `serde_spanned` | src-tauri | 0.6.9, 1.1.2 | 0.6.9, 1.1.3 |
| `toml` | src-tauri | 0.8.2, 1.2.0+spec-1.1.0 | 0.8.2, 1.2.1+spec-1.1.0 |
| `toml_datetime` | src-tauri | 0.6.3, 1.1.2+spec-1.1.0 | 0.6.3, 1.1.3+spec-1.1.0 |
| `toml_edit` | src-tauri | 0.19.15, 0.20.2, 0.25.18+spec-1.1.0 | 0.19.15, 0.20.2, 0.25.19+spec-1.1.0 |

</details>

## Security audits

- npm: none
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: none

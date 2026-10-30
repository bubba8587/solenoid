# Bleeding edge, 2026-10-30

Every dependency at its newest release, on top of `rust-port` @ `adfd689aa`. Regenerated daily by `.github/workflows/bleeding-edge.yml`; never work on this branch. The weekly reading of the release notes (what breaks, what's new, what's worth using) is in [ANALYSIS.md](ANALYSIS.md).

**2 of 16 checks fail.** 9 direct dependencies moved (2 across a major), 49 transitive. rustc 1.99.1 (58cf8f9c3 2026-10-13), Node v24.22.1.

## Checks

| | Check | Time |
|---|---|---|
| ❌ | Engine module builds (npm run build:wasm) | 114s |
| ✅ | Typecheck | 1s |
| ❌ | Unit tests | 47s |
| ✅ | Site build | 4s |
| ✅ | Headless CLI build | 2s |
| ✅ | Obsidian plugin build | 2s |
| ✅ | crates/solenoid-core: clippy | 15s |
| ✅ | crates/solenoid-core: tests | 64s |
| ✅ | crates/solenoid-graph: clippy | 14s |
| ✅ | crates/solenoid-graph: tests | 32s |
| ✅ | crates/solenoid-parquet: clippy | 24s |
| ✅ | crates/solenoid-parquet: tests | 46s |
| ✅ | crates/solenoid-schedule: clippy | 2s |
| ✅ | crates/solenoid-schedule: tests | 4s |
| ✅ | crates/solenoid-core: clippy (wasm) | 23s |
| ✅ | Desktop shell compiles (src-tauri) | 96s |

## Direct dependencies that moved

| | Package | Where | From | To | Notes |
|---|---|---|---|---|---|
| ⚠️ major | `magic-string` | npm | 0.30.21 | 1.4.5 | [releases](https://github.com/Rich-Harris/magic-string/releases) |
| ⚠️ major | `three` | npm | 0.186.1 | 0.187.0 | [releases](https://github.com/mrdoob/three/releases) |
|  | `@lezer/common` | npm | 1.5.4 | 1.5.5 | [releases](https://www.npmjs.com/package/@lezer/common?activeTab=versions) |
|  | `js-sys` | solenoid-core | 0.3.77 | 0.3.107 | [releases](https://github.com/wasm-bindgen/wasm-bindgen/releases) |
|  | `js-sys` | solenoid-graph | 0.3.77 | 0.3.107 | [releases](https://github.com/wasm-bindgen/wasm-bindgen/releases) |
|  | `wasm-bindgen` | solenoid-core | 0.2.100 | 0.2.130 | [releases](https://github.com/wasm-bindgen/wasm-bindgen/releases) |
|  | `wasm-bindgen` | solenoid-graph | 0.2.100 | 0.2.130 | [releases](https://github.com/wasm-bindgen/wasm-bindgen/releases) |
|  | `wasm-bindgen-futures` | solenoid-graph | 0.4.50 | 0.4.80 | [releases](https://github.com/wasm-bindgen/wasm-bindgen/releases) |
|  | `windows-sys` | src-tauri | 0.45.0, 0.52.0, 0.59.0, 0.61.2 | 0.45.0, 0.52.0, 0.61.2 | [releases](https://github.com/microsoft/windows-rs/releases) |

<details><summary>49 transitive changes</summary>

| Package | Where | From | To |
|---|---|---|---|
| `@lezer/lr` | npm | 1.4.11 | 1.4.12 |
| `encoding_rs` | src-tauri | 0.8.42 | 0.8.44 |
| `es-toolkit` | npm | 1.53.0 | 1.53.1 |
| `futures-core` | solenoid-core | (new) | 0.3.34 |
| `futures-core` | solenoid-graph | (new) | 0.3.34 |
| `futures-core` | solenoid-parquet | (new) | 0.3.34 |
| `futures-task` | solenoid-core | (new) | 0.3.34 |
| `futures-task` | solenoid-graph | (new) | 0.3.34 |
| `futures-task` | solenoid-parquet | (new) | 0.3.34 |
| `futures-util` | solenoid-core | (new) | 0.3.34 |
| `futures-util` | solenoid-graph | (new) | 0.3.34 |
| `futures-util` | solenoid-parquet | (new) | 0.3.34 |
| `js-sys` | solenoid-parquet | 0.3.77 | 0.3.107 |
| `js-sys` | src-tauri | 0.3.77 | 0.3.107 |
| `magic-string (in @vitest/mocker)` | npm | 1.4.5 | (gone) |
| `magic-string (in rollup-plugin-license)` | npm | (new) | 0.30.21 |
| `magic-string (in vitest)` | npm | 1.4.5 | (gone) |
| `once_cell` | solenoid-core | 1.21.4 | (gone) |
| `once_cell` | solenoid-graph | 1.21.4 | (gone) |
| `pin-project-lite` | solenoid-core | (new) | 0.2.17 |
| `pin-project-lite` | solenoid-graph | (new) | 0.2.17 |
| `pin-project-lite` | solenoid-parquet | (new) | 0.2.17 |
| `reqwest` | src-tauri | 0.12.28, 0.13.1 | 0.12.28, 0.13.5 |
| `slab` | solenoid-core | (new) | 0.4.12 |
| `slab` | solenoid-graph | (new) | 0.4.12 |
| `slab` | solenoid-parquet | (new) | 0.4.12 |
| `tokio` | solenoid-graph | (new) | 1.54.1 |
| `wasm-bindgen` | solenoid-parquet | 0.2.100 | 0.2.130 |
| `wasm-bindgen` | src-tauri | 0.2.100 | 0.2.130 |
| `wasm-bindgen-backend` | solenoid-core | 0.2.100 | (gone) |
| `wasm-bindgen-backend` | solenoid-graph | 0.2.100 | (gone) |
| `wasm-bindgen-backend` | solenoid-parquet | 0.2.100 | (gone) |
| `wasm-bindgen-backend` | src-tauri | 0.2.100 | (gone) |
| `wasm-bindgen-futures` | src-tauri | 0.4.50 | 0.4.80 |
| `wasm-bindgen-macro` | solenoid-core | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro` | solenoid-graph | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro` | solenoid-parquet | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro` | src-tauri | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro-support` | solenoid-core | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro-support` | solenoid-graph | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro-support` | solenoid-parquet | 0.2.100 | 0.2.130 |
| `wasm-bindgen-macro-support` | src-tauri | 0.2.100 | 0.2.130 |
| `wasm-bindgen-shared` | solenoid-core | 0.2.100 | 0.2.130 |
| `wasm-bindgen-shared` | solenoid-graph | 0.2.100 | 0.2.130 |
| `wasm-bindgen-shared` | solenoid-parquet | 0.2.100 | 0.2.130 |
| `wasm-bindgen-shared` | src-tauri | 0.2.100 | 0.2.130 |
| `wasm-streams` ⚠️ | src-tauri | 0.4.2 | 0.5.0 |
| `web-sys` | solenoid-graph | 0.3.77 | (gone) |
| `web-sys` | src-tauri | 0.3.77 | 0.3.107 |

</details>

## Security audits

- npm: none
- crates/solenoid-core: none
- crates/solenoid-graph: none
- crates/solenoid-parquet: none
- crates/solenoid-schedule: none
- src-tauri: none

## Failure logs

<details><summary>❌ Engine module builds (npm run build:wasm)</summary>

`npm run build:wasm`

```
[1m[92m   Compiling[0m solenoid-core v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-core)
[1m[92m   Compiling[0m solenoid-graph v0.1.0 (/home/runner/work/solenoid/solenoid/crates/solenoid-graph)
[1m[91merror[E0282][0m[1m: type annotations needed[0m
    [1m[94m--> [0msrc/boundary.rs:1154:24
     [1m[94m|[0m
[1m[94m1154[0m [1m[94m|[0m             for key in Object::keys(outputs.unchecked_ref()).iter() {
     [1m[94m|[0m                        [1m[91m^^^^^^^^^^^^[0m [1m[94m-----------------------[0m [1m[94mtype must be known at this point[0m
     [1m[94m|[0m                        [1m[91m|[0m
     [1m[94m|[0m                        [1m[91mcannot infer type of the type parameter `T` declared on the associated function `keys`[0m
     [1m[94m|[0m
[1m[96mhelp[0m: consider specifying a concrete type for the type parameter `T`
     [1m[94m|[0m
[1m[94m1154[0m [1m[94m| [0m            for key in Object::keys[92m::</* Type */>[0m(outputs.unchecked_ref()).iter() {
     [1m[94m|[0m                                    [92m++++++++++++++[0m

[1m[91merror[E0282][0m[1m: type annotations needed[0m
    [1m[94m--> [0msrc/boundary.rs:1273:20
     [1m[94m|[0m
[1m[94m1273[0m [1m[94m|[0m         for key in Object::keys(out.unchecked_ref()).iter() {
     [1m[94m|[0m                    [1m[91m^^^^^^^^^^^^[0m [1m[94m-------------------[0m [1m[94mtype must be known at this point[0m
     [1m[94m|[0m                    [1m[91m|[0m
     [1m[94m|[0m                    [1m[91mcannot infer type of the type parameter `T` declared on the associated function `keys`[0m
     [1m[94m|[0m
[1m[96mhelp[0m: consider specifying a concrete type for the type parameter `T`
     [1m[94m|[0m
[1m[94m1273[0m [1m[94m| [0m        for key in Object::keys[92m::</* Type */>[0m(out.unchecked_ref()).iter() {
     [1m[94m|[0m                                [92m++++++++++++++[0m

[1m[91merror[E0282][0m[1m: type annotations needed[0m
   [1m[94m--> [0msrc/wasm.rs:160:5
    [1m[94m|[0m
[1m[94m160[0m [1m[94m|[0m     Object::keys(value.unchecked_ref())
    [1m[94m|[0m     [1m[91m^^^^^^^^^^^^[0m [1m[94m---------------------[0m [1m[94mtype must be known at this point[0m
    [1m[94m|[0m     [1m[91m|[0m
    [1m[94m|[0m     [1m[91mcannot infer type of the type parameter `T` declared on the associated function `keys`[0m
    [1m[94m|[0m
[1m[96mhelp[0m: consider specifying a concrete type for the type parameter `T`
    [1m[94m|[0m
[1m[94m160[0m [1m[94m| [0m    Object::keys[92m::</* Type */>[0m(value.unchecked_ref())
    [1m[94m|[0m                 [92m++++++++++++++[0m

[1m[91merror[E0282][0m[1m: type annotations needed[0m
   [1m[94m--> [0msrc/wasm.rs:369:16
    [1m[94m|[0m
[1m[94m369[0m [1m[94m|[0m     for key in Object::keys(inputs.unchecked_ref()).iter() {
    [1m[94m|[0m                [1m[91m^^^^^^^^^^^^[0m [1m[94m----------------------[0m [1m[94mtype must be known at this point[0m
    [1m[94m|[0m                [1m[91m|[0m
    [1m[94m|[0m                [1m[91mcannot infer type of the type parameter `T` declared on the associated function `keys`[0m
    [1m[94m|[0m
[1m[96mhelp[0m: consider specifying a concrete type for the type parameter `T`
    [1m[94m|[0m
[1m[94m369[0m [1m[94m| [0m    for key in Object::keys[92m::</* Type */>[0m(inputs.unchecked_ref()).iter() {
    [1m[94m|[0m                            [92m++++++++++++++[0m

[1mFor more information about this error, try `rustc --explain E0282`.[0m
[1m[91merror[0m: could not compile `solenoid-graph` (lib) due to 4 previous errors
node:internal/errors:986
  const err = new Error(message);
              ^

Error: Command failed: cargo build --release --target wasm32-unknown-unknown --manifest-path crates/solenoid-graph/Cargo.toml --target-dir crates/solenoid-graph/target
    at genericNodeError (node:internal/errors:986:15)
    at wrappedFn (node:internal/errors:540:14)
    at checkExecSyncError (node:child_process:943:11)
    at execFileSync (node:child_process:979:15)
    at run (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:10:28)
    at build (file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:54:3)
    at file:///home/runner/work/solenoid/solenoid/scripts/build-wasm.mjs:70:1
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  status: 101,
  signal: null,
  output: [ null, null, null ],
  pid: 8053,
  stdout: null,
  stderr: null
}

Node.js v24.22.1
```

</details>

<details><summary>❌ Unit tests</summary>

`npx vitest run`

```
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


[31m⎯⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Tests 2 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m

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

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯[22m[39m

[41m[1m FAIL [22m[49m [30m[42m shared [49m[39m tests/graph/wasmStamp.test.ts[2m > [22mthe module is current with the crates it links (run npm run build:wasm)
[31m[1mAssertionError[22m: expected '9d06b997515666febe636ddfe86bcd4d8f16f…' to be 'e5943569b2a3caa01918c9cba72c69cb2d968…' // Object.is equality[39m

Expected: [32m"e5943569b2a3caa01918c9cba72c69cb2d968a29eae98af78e7aa1f9437433bb"[39m
Received: [31m"9d06b997515666febe636ddfe86bcd4d8f16fd9b2bf56fef2eadaf908ea45c38"[39m

[36m [2m❯[22m tests/graph/wasmStamp.test.ts:[2m12:19[22m[39m
    [90m 10|[39m   const root = path.resolve(__dirname, "../..");
    [90m 11|[39m   const stamped = fs.readFileSync(path.join(root, (MODULE as { out: st…
    [90m 12|[39m   expect(stamped).toBe(sourceStamp(root));
    [90m   |[39m                   [31m^[39m
    [90m 13|[39m });
    [90m 14|[39m

[31m[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯[22m[39m
```

</details>


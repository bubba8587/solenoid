# solenoid-core

A Rust port of Solenoid's headless TypeScript core, built for two targets: WebAssembly for the web app
(`npm run build:wasm` writes `src/graph/engineWasm/`) and native for tests. Experimental, on the
`solenoid/tsrs` branch. The method is borrowed from [tsrs](https://github.com/oxc-project/tsrs).

## The rule: the TypeScript is the spec

- The TS on `develop` at the pinned commit below is the specification. Any difference from it
  (a cell, an error's code or message, a thrown error) is a bug in the Rust, even when the Rust answer
  looks more reasonable.
- The port is mechanical. One Rust module per TS file (`frameVerbs.ts` → `frame_verbs.rs`), functions
  keep their TS names in snake_case and their order of operations, and nothing gets redesigned. Internal-only
  differences (data layout, `Rc` sharing) are fine when no answer changes.
- The JavaScript the TS leans on implicitly (`String(x)`, `Number(x)`, `trim`, UTF-16 string `<`,
  `Math.round`) lives in `jsnum.rs`.
- Correctness rests on the conformance checks, not review:
  - `npm run test:core` runs the shared corpus (`fixtures/frame-verbs`) natively.
  - `tests/graph/wasmEngine.test.ts` runs the corpus and a seeded differential fuzzer through the real wasm
    module and the real backend wrapper, against the JS oracle. To widen it:
    `FUZZ_RUNS=100000 FUZZ_SEED=7 npx vitest run tests/graph/wasmEngine.test.ts`.

## Tracking develop

Pinned upstream: `develop` @ `31ce0f7`.

On each rebase, list what moved in the ported TS:
`git diff 31ce0f7..develop -- src/graph/frameVerbs.ts src/graph/frame.ts src/graph/frameBackend.ts src/graph/valueKinds.ts src/graph/stringOrder.ts src/graph/unitValue.ts fixtures/frame-verbs`.
Port each change, run the checks above, then move the pin.

## What it does and doesn't do

| Capability | Status | Evidence |
| --- | --- | --- |
| Frame verbs: select, drop, rename, sort, distinct, head, filter, filterMulti, groupBy, unpivot, window, fillBlanks, replaceValues, sliceRows | Ported | 254 corpus cases natively; corpus + 600k fuzz cases through wasm |
| join (all 8 kinds, unit-scaled keys), append, bindColumns, sample | Ported | as above |
| pivot | Not ported: the wrapper runs it on the JS oracle (Polars doesn't run it either) | corpus through wasm |
| Units, formats | Unit-blind, as Polars is: the TS lowers reading/unit scales into the op and restores metadata | `lowerForEngine` |
| Formula language, compute pass, node `data()` | Not started | |

## Where it runs

`initFrameBackend` picks Polars on desktop when it's on, else this engine in wasm when Settings → Rust engine
is on (the default), else the JS oracle. The wasm engine holds every cell kind, so unlike Polars it needs no
oracle fallback for text or logical errors.

## Performance (200k rows × 5 columns, Node, best of 3)

`BENCH=1 npx vitest run tests/graph/wasmEngineBench.test.ts`. The Rust figure includes a 100-row preview; the frame
is already in wasm.

| op | JS ms | Rust ms | × |
| --- | ---: | ---: | ---: |
| sort by a number | 143.7 | 42.3 | 3.4 |
| sort by text | 181.7 | 65.5 | 2.8 |
| filter value > 0 | 14.2 | 8.3 | 1.7 |
| filter text contains | 13.4 | 14.7 | 0.9 |
| distinct key | 13.3 | 16.3 | 0.8 |
| group by key: sum, avg, median | 150.1 | 44.0 | 3.4 |
| window: cumsum by cat over day | 124.1 | 65.0 | 1.9 |
| window: rank by cat | 149.1 | 76.7 | 1.9 |
| pipeline: filter, group, sort | 96.9 | 28.6 | 3.4 |
| left join a 1000-row lookup | 101.1 | 20.9 | 4.8 |

Uploading the frame into wasm takes 207 ms and a full download 206 ms, because both cross as JSON. That's the
first thing to fix (a columnar binary hand-off), followed by per-row allocations in keys and case folding.

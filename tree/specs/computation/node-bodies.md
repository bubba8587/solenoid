---
aliases: ["Node bodies"]
tags: [spec, computation]
---
<!-- [[D102]] graphOnCore, [[D99]] rustIsSpec -->

# Spec: card bodies on the core

Serves [[D102]] graphOnCore and [[D99]] rustIsSpec. A card's body, its class's `data()`, moves into the Rust core
(`crates/solenoid-core/src/nodes/`) class by class, the way [[rust-core]] moves formulas: its answers frozen first,
then the Rust held to them, then the TypeScript body deleted.

## What moves and what stays

- **Moves:** the body, everything `data()` computes from its inputs and saved fields, and the shared readers it leans
  on (`readInput`, the broadcasters, the non-finite guard, unit arithmetic).
- **Stays TypeScript:** the class itself (sockets, saved fields, socket swaps, `formatCarry`, the component), arrival
  coercion (`coerceInputs.ts`) and the error guard (`errorValue.ts` `installErrorGuards`), which wrap the body as
  before; a card whose body needs the browser (a file, the network, the vault) or the canvas.

## The call (`nodeOnCore.ts`, `engine_node`)

A ported class's `data()` is `return nodeOnCore(this, inputs)`. It sends:

| Field | What |
|---|---|
| `kind` | the class name, which picks the body (`nodes::run`) |
| `init`, `literals`, `stringLiterals` | what a save holds: `extractInit` and the two literal maps; `init` also carries the run-time fields the class names in `static coreFields` (Math Function's resolved angle mode), which no save keeps (`coreInit`) |
| `sockets`, `outputs` | each input's key, declared type and label, each output's key and declared type, in the card's order |
| `inputs` | each wired input's values on the card wire (`nodeWire.ts`), in order |
| `clock` | `engineClock()`, for a body that reads today |

The reply is the outputs, or the error the body throws (thrown again for the error guard), beside `display`: the
fields the body sets on the card for its component (`cachedResult` and the like), which `nodeOnCore` assigns.

**The card wire** (`nodeWire.ts`; `nodes/values.rs`) is the core's value wire (`coreValue`, units included) plus what
only cards hand each other: a frame cell by cell with each column's unit, format and typed text (`V::Frame`), a cube
(`V::Cube`), and plain data a card makes whole, a chart, a document, an image, an SVG or a diagram, as JSON whose
non-finite numbers, -0 and `undefined` are tagged (`V::Json`). A frame ref (a lazy verb's plan) doesn't cross: the lazy
verb cards route to the frame backend (Polars on desktop, the core in wasm) and stay TypeScript. A value that can't
cross (a frame ref, text with a lone surrogate) answers `#VALUE!` on the card. A trap answers `#ERROR!` and the module comes back as [[rust-core]] § Where it
runs says.

The core is required: the app's first render waits for it with no deadline (`main.tsx`), and every test file loads it
(`tests/setup/graphEngine.ts`). Settings → Rust engine no longer reaches a ported card.

## Freezing (`FREEZE_NODES`)

- `FREEZE_NODES=1 npx vitest run` records every body call the suite makes (`tests/setup/nodeRecorder.ts` wraps each
  class's `data()`): the call as above, the outputs or the thrown error, the fields the body changed and what they held
  before. `tests/graph/nodeFuzz.test.ts` adds 150 calls per catalog card on random values of its socket types, with
  units on a unit-aware card's numbers. `FREEZE_NODES=ArithmeticNode,…` records only those classes.
- `node scripts/freeze-nodes.mjs [Class …]` folds the calls into `fixtures/core/nodes/<Class>.json.gz`: deduplicated,
  at most 2,500 a class, a call holding a value that can't cross counted in `.dev/node-freeze-report.json` and not
  kept. A call whose answer differed between two identical calls (a random draw, the clock) is kept marked
  `unstable` and not checked. The recorder writes a call once per worker and stops a class at 2,500 distinct calls.
- A class is frozen while its TypeScript body exists; once it is deleted, its fixture changes only on purpose, in the
  commit that changes the behaviour.

## Checks

- `cargo test --manifest-path crates/solenoid-core/Cargo.toml --test nodes` replays every frozen case of every class
  with a body on the core, natively (`NODES=ArithmeticNode,…` narrows it). A field the body sets must equal the frozen
  one, or what the card held before where the frozen call left it alone.
- `tests/graph/coreNodes.test.ts` replays the same cases through the wasm module and the TS's reading of the reply.
- The whole vitest suite runs the ported cards on the core.

## What has moved

| Family | Classes | Rust |
|---|---|---|
| Scalar | Arithmetic, Math Function, Base Convert, Clamp, MROUND, ROUND, GCD, Two-Input Math, SUMPRODUCT, SERIESSUM, MULTINOMIAL, Bessel | `nodes/scalar.rs` |
| Logic | Comparison, Between, Is Close, IF, Boolean Op, NOT, CHOOSE, SWITCH, IFS, ISEVEN/ISODD | `nodes/logic.rs` |
| Complex | COMPLEX, Unpack, the unary and binary ops, Power, Poly Roots, Quadratic Roots | `nodes/complex.rs` |
| Packs | Parallel Combine, E-Series, AWG, Solar Position, Sunrise/Sunset, Moon Phase, ISA Atmosphere, Antoine, Colebrook, Pipe Roughness, HR Zones, EM Spectrum, Convert, Tornado | `nodes/packs.rs` |

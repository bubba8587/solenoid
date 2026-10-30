---
aliases: ["Bleeding-edge dependency fixes"]
tags: [spec, bleeding-edge]
---
<!-- [[B22]] edgeNewestDependencies, [[B25]] edgeReadyToPort -->

# Spec: Dependency fixes on the bleeding-edge branch

Serves [[B22]] edgeNewestDependencies and [[B25]] edgeReadyToPort. It lists what the newest dependencies broke on the bleeding-edge branch and how each was fixed, one `Fix:` commit each. A fix ports together with the upgrade that needs it: the branch's own `Fix:` commit sits above the day's bump, so it can't carry the upgrade, and the port is a separate commit made from the base, carrying the pins and lockfile entries of exactly the packages the fix needs, the fix, and the rebuilt engine module where it changes. It is pushed as `bleeding-edge-port/<name>` once the typecheck and unit tests pass on it ([[branch#Working on the branch]], step 7), and a work branch cherry-picks that one commit. How the dependencies move is [[branch#Dependencies]].

## wasm-bindgen 0.2.130 and js-sys 0.3.107

**Ready to port**: cherry-pick the tip of `bleeding-edge-port/wasm-bindgen-0.2.130` (`08fa83037`), checked on rust-port `053c10baa` on 2026-10-30: the module built and all 8630 unit tests and the typecheck passed. It moves wasm-bindgen to 0.2.130, wasm-bindgen-futures to 0.4.80 and js-sys to 0.3.107 in both crates and nothing else. Rebuilding the module afterwards needs `wasm-bindgen-cli` 0.2.130; an older CLI stops the build and names the version to install.

- **js-sys made `Object` generic** (`Object<T>`), so `Object::keys(x.unchecked_ref())` no longer infers which `Object` it reads. The four calls in `crates/solenoid-graph` (`boundary.rs`, `wasm.rs`) name it: `Object::keys::<JsValue>(…)`.
- **wasm-bindgen's new glue** declares the instance as `let wasmModule, wasmInstance, wasm;`, keeps JS objects in the instance's externref table instead of a JS-side heap, caches its init promise in `__wbg_init_promise`, and frees a class with `free(ptr, 1)` without `>>> 0`. The trap-reset patch in `scripts/build-wasm.mjs` found none of its old anchors, so it is rewritten for the new glue: every closure and finalizer still carries the epoch guard (the build counts them and fails on one unguarded), and `__wbg_reset` drops the instance and the init promise and returns the compiled module; a fresh instance starts with an empty externref table on its own. The trap tests pass on it.
- **The CLI** must be `wasm-bindgen-cli` 0.2.130, matching the crate.

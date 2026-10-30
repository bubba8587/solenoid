---
aliases: ["Bleeding-edge dependency fixes"]
tags: [spec, bleeding-edge]
---
<!-- [[B22]] edgeNewestDependencies, [[B25]] edgeReadyToPort -->

# Spec: Dependency fixes on the bleeding-edge branch

Serves [[B22]] edgeNewestDependencies and [[B25]] edgeReadyToPort. It lists what the newest dependencies broke on the bleeding-edge branch and how each was fixed, one `Fix:` commit each. A fix is ready to port together with the upgrade that needs it, and only with it: a work branch taking the same upgrade cherry-picks the fix in the same change. How the dependencies move is [[branch#Dependencies]].

## wasm-bindgen 0.2.130 and js-sys 0.3.107

**Ready to port with the upgrade** to wasm-bindgen 0.2.130, wasm-bindgen-futures 0.4.80 and js-sys 0.3.107 (and `wasm-bindgen-cli` 0.2.130); without that upgrade it doesn't apply.

- **js-sys made `Object` generic** (`Object<T>`), so `Object::keys(x.unchecked_ref())` no longer infers which `Object` it reads. The four calls in `crates/solenoid-graph` (`boundary.rs`, `wasm.rs`) name it: `Object::keys::<JsValue>(…)`.
- **wasm-bindgen's new glue** declares the instance as `let wasmModule, wasmInstance, wasm;`, keeps JS objects in the instance's externref table instead of a JS-side heap, caches its init promise in `__wbg_init_promise`, and frees a class with `free(ptr, 1)` without `>>> 0`. The trap-reset patch in `scripts/build-wasm.mjs` found none of its old anchors, so it is rewritten for the new glue: every closure and finalizer still carries the epoch guard (the build counts them and fails on one unguarded), and `__wbg_reset` drops the instance and the init promise and returns the compiled module; a fresh instance starts with an empty externref table on its own. The trap tests pass on it.
- **The CLI** must be `wasm-bindgen-cli` 0.2.130, matching the crate.

<!-- [[C66]] scriptNode -->

# Spec: Script sandbox

Serves [[C66]] scriptNode. The mechanics a builder implements: what the system does and blocks, with the decision each behaviour serves. Lifted from `docs/subsystem-invariants.md` § Script sandbox; a WHY that is not in a node belongs in one.

One shared module Worker, spawned lazily, one request id per call. `scriptRun.ts` is the
evaluator and imports NOTHING from the app: it is the worker's whole bundle (no React, no
DOM-touching module side effects) and the inline fallback for hosts without Workers
(vitest). The worker deletes the I/O doors (`fetch`, `XMLHttpRequest`, `WebSocket`,
`indexedDB`, `caches`, `importScripts`, `Worker`, `navigator`, `postMessage`…) from its
global scope and prototype chain before the first call; `import()` is syntax and stays, so
this is containment against accidents, not a security boundary. Return values cross as
clonable data (`toClonable` marks functions/symbols/Map/Set) and are folded onto the value
model on the MAIN thread by `scriptCoerce.ts`. The wall clock lives in the executor: a call
past `SCRIPT_TIMEOUT_MS` resolves `#VALUE!` "Timed out", the stuck worker is terminated and
respawned, and the other in-flight calls re-dispatch on the replacement (they were
innocent). The main thread ALSO compiles the source (`compileScript`, cached by text) for
immediate syntax feedback on the card, so `new Function` runs in both contexts: the desktop
CSP must allow `'unsafe-eval'` in `script-src` or every Script reads a CSP refusal as its
error.

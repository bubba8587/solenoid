---
aliases: ["Script sandbox"]
tags: [spec, computation]
---
<!-- [[C66]] scriptNode -->

# Spec: Script sandbox

Serves [[C66]] scriptNode. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Script card runs a user-written JavaScript function on its inputs. The function runs inside a Web Worker, a separate background thread with the input and output routes removed, so a runaway or careless script cannot freeze the app or reach the network. The parts:

| File | Role |
|---|---|
| `nodes/script.ts` | The card: sockets from the function's parameters, arguments in, result out |
| `nodes/scriptRun.ts` | The evaluator: parse, compile, call, make the result clonable |
| `scriptWorker.ts` | The worker: removes the input and output routes, then answers calls |
| `scriptExecutor.ts` | The main-thread client: one shared worker, request ids, the time limit |
| `nodes/scriptCoerce.ts` | Folds the returned value onto the app's value model |

## The source

The source must be a single function expression: `(a, b) => …`, `a => …`, or `function name(a, b) { … }`, optionally `async`, optionally after leading `//` or `/* */` comments. `scriptParams` reads its parameter list:

- Each parameter must be a plain name, not a destructured or defaulted one, and not a reserved word: "Parameters must be plain names, not "…"". A parameter becomes an input socket, and a pattern has no single name to show.
- A name may appear once: "Parameter "…" appears twice".
- A source with no recognizable function head reads "Write a function: (x) => x * 2".

The card adds an input for each new parameter and returns the departing ones so their cables are dropped before the sockets are removed ([[D10]] onePrunePath).

`compileScript` evaluates the source with `new Function("Solenoid", "\"use strict\"; return (…);")`. A result that is not a function reads "Write a function: (x) => x * 2". Compiled functions are cached by source text; the cache clears when it passes 64 entries.

The one global a script sees is `Solenoid`, frozen, with a single method: `Solenoid.date(serial)` marks a number as a date serial, mapping over lists and rows. JavaScript values otherwise type themselves (a number is a number, a string is text, a `Date` is a date).

`scriptIsVolatile` scans the source for `Math.random`, `Date.now`, `new Date()`, `crypto.getRandomValues`, `crypto.randomUUID` and `performance.now`. A match means each run can differ, so the card shows a Recalculate button ("Run the script again"). The scan reads text, not meaning, so a renamed alias escapes it and a string can match falsely; either way the only cost is that button being missing or extra.

## One call

1. The card's `data()` returns null for an empty source, and `#SYNTAX!` with the compile message when the source does not compile. The main thread compiles too, for immediate syntax feedback on the card.
2. Each parameter's argument is its cable's value, or the typed literal when unwired, converted to plain JavaScript (`scriptArgToJs`). An unwired input with nothing typed is `undefined`; a wired blank is `null`. An error cell in any argument becomes the result without running the script.
3. `executeScript(src, args)` sends `{ id, src, args }` to the worker, with a fresh request id per call, and starts the timer.
4. In the worker, `invokeScript` compiles (cached) and calls the function, awaiting a returned promise. A throw is `#VALUE!` with `Name: message`; a compile failure is `#SYNTAX!`.
5. The return value is passed through `toClonable` so it can cross back to the main thread. Functions and symbols become an `__unclonable` marker, as do `Map`, `Set` and anything nested more than 7 levels deep; typed arrays become plain arrays. The depth limit clears the deepest legal shape (cube rows holding frame rows holding lists) with a level to spare.
6. On the main thread, `coerceScriptResult` folds the value onto the value model and names its family; an unclonable marker becomes `#TYPE!`. A result with no family (an empty list, all blanks or errors) keeps the card's last settled family.

## The worker

- One shared module worker, spawned on the first call.
- Before its first call, the worker deletes these names from its global scope and every object on its prototype chain: `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `WebTransport`, `RTCPeerConnection`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, `Worker`, `SharedWorker`, `Notification`, `navigator` and `postMessage`. It keeps a private handle to `postMessage` for its replies. `import()` is syntax and cannot be removed, so this is containment against accidents, not a security boundary; the author of a document wrote its scripts.
- `scriptRun.ts` imports nothing from the app. It is the worker's whole bundle, with no React and no module that touches the DOM when loaded, and it is also the inline evaluator on hosts without Workers.

## The time limit

The timer lives in the executor, not the worker, because a stuck worker cannot answer. A call still running after `SCRIPT_TIMEOUT_MS` (1000 ms) resolves to `#VALUE!` "Timed out after 1 s". The executor then terminates the worker, spawns a replacement, and sends every other in-flight call to the replacement with a fresh timer; those calls did nothing wrong.

If the worker itself fails (a policy forbidding eval, a bundling fault), every in-flight call resolves to `#VALUE!` with the reason, and the next call spawns a fresh worker. A failure posting a request resolves that call to `#VALUE!`.

## Hosts without Workers

In vitest and other headless hosts, `executeScript` runs `invokeScript` inline, with no time limit. It deep-copies the arguments first (`structuredClone`), as posting to a worker would, so a script that mutates an argument never edits the upstream card's cached value.

## Desktop security policy

Because `new Function` runs on both the main thread and in the worker, the desktop content security policy (`src-tauri/tauri.conf.json`) must allow `'unsafe-eval'` in `script-src`. Without it, every Script card shows the policy refusal as its error.

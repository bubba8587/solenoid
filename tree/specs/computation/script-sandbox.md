---
aliases: ["Script sandbox"]
tags: [spec, computation]
---
<!-- [[C66]] scriptNode, [[D35]] errorInErrorOut -->

# Spec: Script sandbox

Serves [[C66]] scriptNode. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Script card runs a user-written JavaScript function on its inputs. Each parameter becomes an input socket, the arguments are converted to plain JavaScript, and the returned value is folded back onto the app's value model, where it types itself. The function runs inside a Web Worker, a separate background thread with the input and output routes removed, so a runaway or careless script cannot freeze the app or reach the network.

| File | Role |
|---|---|
| `nodes/script.ts` | The card: sockets from the function's parameters, arguments in, result out |
| `nodes/scriptRun.ts` | The evaluator: parse, compile, call, make the result clonable |
| `scriptWorker.ts` | The worker: removes the input and output routes, then answers calls |
| `scriptExecutor.ts` | The main-thread client: one shared worker, request ids, the time limit |
| `nodes/scriptCoerce.ts` | Converts the arguments to JavaScript and folds the returned value onto the value model |

## The source

The source is stored in the card's `expr` field, the same persistence key Expression uses, and edited through `applyScriptChange`, which follows Expression's edit path. It must be a single function expression: `(a, b) => …`, `a => …`, or `function name(a, b) { … }`, optionally `async`, optionally after leading `//` or `/* */` comments. `scriptParams` reads its parameter list:

- Each parameter must be a plain name, not a destructured or defaulted one, and not a reserved word: "Parameters must be plain names, not "…"". A parameter becomes an input socket, and a pattern has no single name to show.
- A name may appear once: "Parameter "…" appears twice".
- A source with no recognizable function head reads "Write a function: (x) => x * 2".

On each commit `_rebuild` adds a `trueany` input for each new parameter and returns the departing ones, so the caller drops their cables before removing the sockets ([[input-cable-pruning#The ordering rule]]).

`compileScript` evaluates the source with `new Function("Solenoid", "\"use strict\"; return (…);")`. A result that is not a function reads "Write a function: (x) => x * 2". Compiled functions are cached by source text; the cache clears when it passes 64 entries.

The one global a script sees is `Solenoid`, frozen, with a single method. JavaScript values already type themselves (a number is a number, a string is text, a `Date` is a date); the one thing a JavaScript value cannot say is "this number is a date serial", so `Solenoid.date(serial)` says it. It maps over lists, passes `null` and a `Date` through unchanged, and tags anything else as `{ __solDate: v }`; the coercer later checks that the tagged value is a finite number.

`scriptIsVolatile` scans the source for `Math.random`, `Date.now`, `new Date()`, `crypto.getRandomValues`, `crypto.randomUUID` and `performance.now`. A match means each run can differ, so the card shows a Recalculate button ("Run the script again"). The scan reads text, not meaning, so a renamed alias escapes it and a string can match falsely; either way the only cost is that button being missing or extra.

## One call

1. The card's `data()` returns null for an empty source, and `#SYNTAX!` with the compile message when the source does not compile. The main thread compiles too, for immediate syntax feedback on the card.
2. Each parameter's argument is its cable's value, or the typed literal when unwired, converted to plain JavaScript (`scriptArgToJs`, below). A parameter is a value slot (`autoLiterals`), so an unwired one takes a typed number or text; exactly one of `literals` and `stringLiterals` holds it, because the inline field clears the other. An unwired input with nothing typed is `undefined`; a wired blank is `null`.
3. An error anywhere in an argument, at any depth (a list cell, a row cell, a converted Frame row), becomes the result without running the script ([[D35]] errorInErrorOut at cell grain; the engine's error guard sees only whole-value errors).
4. `executeScript(src, args)` sends `{ id, src, args }` to the worker, with a fresh request id per call, and starts the timer.
5. In the worker, `invokeScript` compiles (cached) and calls the function, awaiting a returned promise. A throw is `#VALUE!` with `Name: message`; a compile failure is `#SYNTAX!`. The card shows the message under the source field.
6. The return value is passed through `toClonable` so it can cross back to the main thread. Functions and symbols become an `__unclonable` marker, as do `Map`, `Set` and anything nested more than 7 levels deep; typed arrays become plain arrays. The depth limit clears the deepest legal shape (cube rows holding frame rows holding lists) with a level to spare.
7. On the main thread, `coerceScriptResult` folds the value onto the value model and names its family (below). The result socket then reconciles its family and rank to the value (`reconcileResultRank`). A result with no family (an empty list, all blanks or errors) keeps the card's last settled family.

## The arguments

`scriptArgToJs` hands the script the same shapes it can return, so what one script emits another can read:

- A Frame becomes an array of `{name: value}` rows. A lazy Frame, or a head-N preview, is collected in full first (through the preview's `__ref` handle), never silently truncated. Date columns stay serials and unit-locked columns stay their typed magnitudes, since that is how the cells are stored.
- A Cube becomes rows whose cells may hold nested rows (a nested Frame or Cube) or lists. A unit cell unwraps to its display magnitude, so Script is unit-blind. Nested Frames are assumed materialized, as Cubes are built.
- A LAMBDA, a chart or a document has no script form: `#TYPE!` "A script reads data values; a lambda has no script form" (or a chart, a document), before the run.
- Everything else passes through unchanged.

## The result

`coerceScriptResult` accepts four shapes: a scalar, a list, rows of values (a list of lists), or `{name: value}` row objects. A row object is any plain object that is not a `Date`, an error, a `Solenoid.date` tag, a complex number or an unclonable marker.

**Each cell** folds by its JavaScript type:

| Returned | Becomes | Family |
|---|---|---|
| `null`, `undefined` | blank | none |
| an error value | itself | none |
| `Solenoid.date(n)` | the serial `n`; `#TYPE!` "Solenoid.date takes a date serial number or a Date" when `n` is not finite | date |
| a `Date` | its serial; `#DOMAIN!` for an invalid date | date |
| a number | itself; `#DOMAIN!` "The result is not a number" for NaN | number |
| a `bigint` | a number; `#OVERFLOW!` beyond the safe-integer range | number |
| a boolean | itself | logical |
| a string | itself | text |
| a complex number | itself | complex |
| anything else | `#TYPE!` "Returned …; return numbers, text, booleans, dates, lists of them, or {name: value} rows" | none |

**Every container is single-typed.** A list or a table mixing families is `#AMBIGUOUS!`, never a mixed list. Data that is mixed by nature is a Frame, whose rows are legitimately mixed while each column is one type.

**The shapes:**

- A scalar is its cell. A list is its cells; `[]` is an empty list with no family.
- Rows of values build a table. Ragged rows pad with null, as every broadcaster pads. A row holding a further list is `#SHAPE!` "Returned rows nested deeper than a table"; a list mixing rows and plain values is `#SHAPE!`.
- `{name: value}` rows, or one such object, build a Frame. Columns are the keys in order of first appearance, each typed by its cells: a column mixing families is `#AMBIGUOUS!`, a complex column is `#TYPE!`, and a column of only blanks or errors is text. Rows with no keys at all are `#SHAPE!`. A list mixing row objects with other values is `#SHAPE!`.
- When any row cell holds a list or a nested row object, the rows build a Cube instead, the one container whose cells are loose by type (`CubeCell`). A nested list of row objects builds a nested Frame or Cube, and another list coerces cell by cell. A structural refusal inside a nested build (`#SHAPE!` or `#AMBIGUOUS!`) aborts the whole result; a single bad cell stays a cell error.

**The family vote.** Number, text and date map to their own result sockets. Logical and complex values are first-class but have no result socket of their own, so they ride the wildcard (`auto`). A Frame votes `frame` and a Cube votes `cube`, which swap the whole result socket. A mixed vote or no vote casts nothing.

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

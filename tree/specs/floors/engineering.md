---
aliases: ["Engineering rules"]
tags: [spec, floors]
---
<!-- [[C8]] declareOnce, [[C9]] labelUnenforced, [[C17]] shareImpl, [[B2]] webTryDesktopFull -->

# Spec: Engineering rules

Serves [[C8]] declareOnce, [[C9]] labelUnenforced, [[C17]] shareImpl and [[B2]] webTryDesktopFull.

The cross-cutting code-hygiene rules. Unlike the other floors this spec has no `covers:` glob: each rule binds every file in the repo, source and tests alike, whenever the file does the thing the rule names. A file that relies on one cites the parent leaf it serves, or nothing.

## Declarations

### An override lives on the declaration it overrides

**MUST:** when a derived value can't be computed for every case, the exception is a field on the same declaration (the `fx` field on an `OP_META` table), never a separate lookup map keyed by the same identity.

A separate map is a second place that must be kept in step, sitting away from the thing it modifies ([[C8]] declareOnce). [[C51]] formulaNaming derives a formula name by despacing the op label, which works only while the label despaces to the function's name. The bare labels of the Sets and Fill ops ("Union", "Constant") despace to UNION and CONSTANT rather than SETUNION and FILLVALUE, so `fx` sits on `SET_OP_META`, `SET_RELATION_META` and `FILL_OP_META`.

### Lists of names are generated

**MUST:** when code keeps a list of names that share some trait (which functions take a whole range, which ops a card offers), the list is generated from wherever that trait is declared. If it truly can't be generated, a test checks what each listed name does, not just that the name is on the list.

A typed-in list breaks without a sound: leave a name off and nothing errors, the name just behaves differently. Ten functions (`T.TEST`, `F.TEST`, `Z.TEST`, `CHISQ.TEST`, `SUMX2MY2`, `SUMX2PY2`, `SUMXMY2`, `MODE.SNGL`, `PROB`, `SERIESSUM`) were once missing from `RANGE_FUNCTIONS`, so each ran once per cell and gave a believable wrong answer. A test that compares the list against a second typed-in list proves nothing, since both can be wrong together; a test that `T.TEST` returns one number, not four, is a real check.

*Exception:* `RANGE_FUNCTIONS` (`excelFormula.ts`) is typed by hand for the Formula.js functions, because Formula.js publishes no signatures to generate it from. `rangeRouting.test.ts` checks what each of those functions returns. **Removed by:** a signature table for Formula.js.

*Exception:* `ShortcutsOverlay.tsx` keeps its own copy of the key bindings, because it only displays them. **Removed by:** the overlay reading the bindings table.

## Checks

### A gating metric has one implementation

**MUST:** a number that gates CI is computed in one module and answers one question. The human-readable report and the ratchet test call the same function, and neither recomputes it. A metric that would answer two questions is split into two fields: "is this Excel name callable" is never derived from "is this node reachable somehow".

A report that measures differently from its test is how a ratchet stops ratcheting without anyone noticing. The report once matched a card by its host's label and listed nine registered `FILL*` functions as a gap, and a gap computed as `!inFormula` let `SCAN` drop out of a gap it was still in. A metric that folds two questions together also lets an improvement on one hide a regression on the other. The parity measurement is the worked case ([[formula-language#Parity measurement]]).

The node-to-formula coverage figure divides by the in-scope cards, never the whole catalog. This is the author's ruling: sliders, notes, sinks and chrome were never candidates for a formula name, so a whole-catalog denominator understates coverage and answers a different question. The excluded population is reported on its own line.

### Completeness checks use every

**MUST:** a claim of the form "this node supports X" over a set of names is checked with `every`. `some` is allowed only where partial support is the deliberate, documented contract.

`some` reports a node as covered while most of its names still fail. It once hid ten names (the seven B-suffixed text functions, `ERF.PRECISE`, `ERFC.PRECISE` and `VALUETOTEXT`), each declared against a real node while the formula surface answered `#NAME?`.

## Module boundaries

### The formula path is rete-free

**MUST:** a module the formula path imports never pulls in rete, the socket lattice or the Frame model, and this holds for every module in the [[C17]] shareImpl seam, including the next one written. A new shared module states the constraint in its header the way `dateSerial.ts`, `convertUnits.ts` and `listOps.ts` do. `formulaPathIsReteFree.test.ts` pins it.

**MUST (what to extract):** share only what both surfaces can hold. A formula holds neither Frames nor Cubes ([[formula-language#The dispatch ladder]]), so a node kernel that also handles them doesn't move whole. The Frame and Cube half stays node-side and calls the shared core, and a helper that would drag in rete arrives as an argument instead of an import. The pattern is `indexAccess.ts` plus the Frame and Cube branch in `nodes/list.ts`, with `tagFrameCellUnit` passed into `indexInto`.

The headless formula path (`run-graph` and the evaluator) shouldn't have to load the editor. While the rule was only a convention it broke three times: `excelFunctions` reached rete through `nodes/date.ts` and `nodes/convert.ts` until the serial helpers and the unit table were extracted, and `indexAccess.ts` was first created by lifting the INDEX node's `data()` whole, which imported `frame.ts`. That is why the rule binds the moment a module is created, and says what not to extract.

Two modules look like pure value code but reach rete, and are the usual traps: `frame.ts` (through `sockets.ts`) and `unitColumn.ts` (through `unitBridge.ts` → `formatAnnotationStore.ts` → `nodes/date.ts`).

### Heavy libraries load lazily

recharts is one lazy chunk. Every renderer that uses recharts lives in `components/chartRender.tsx`, and nothing the app imports statically may import it. `chartView.tsx`, which every card imports, stays free of recharts and loads the chunk behind `lazy` and `Suspense`. The other heavy figure and layout libraries follow the same rule: `mermaid` (MermaidView) and `elkjs` (Tidy) are reached only by dynamic import, never a static `from`. A source sweep enforces it: exactly one file under `src/` imports from `recharts`, and that file is `components/chartRender.tsx`.

recharts is the largest optional dependency, and most documents never draw a chart. On the web ([[B2]] webTryDesktopFull) the first load is the product's first impression, and one static import anywhere in the card tree drags the whole library into the main bundle. Reopen if charts become a core surface that most documents use, or the canvas figure views replace recharts.

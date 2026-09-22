---
aliases: ["Socket lattice"]
tags: [spec, values]
---
<!-- [[C10]] socketLattice -->

# Spec: Socket lattice

Serves [[C10]] socketLattice: type separation and dimensional flow, derived from the family × rank product. A builder implements this file without reading the tree. `docs/socket-reference.md` is the per-variant reference for readers.

## Purpose

Element families never cross on their own: crossing takes a Cast, and the only bridge is `logical ↔ number`. Values flow freely up in rank: scalar → list → matrix → frame → cube. Which connections are legal is derived from the family × rank product, never listed pair by pair.

## Constraints

- [[D11]] noAutoCross: a value's type is part of its meaning, so a connection that would silently coerce is refused.
- Reopen if: a new family or a second bridge. Re-derive the lattice and the sweep; never ad-hoc edit a pair.

## Requirements

1. **The grid.** The regular types are an `(element × dimension)` product: `FAMILIES` (number / string / date / complex / logical) × `DIMS` (scalar, list, combo, matrix). Each family's rank-1 rung comes in two forms: `list` (strict) and `combo` (scalar-or-list). [[C10]] socketLattice, [[D14]] derivedSocketTypes.
2. **One predicate derives the within-family accept-sets.** `dimFlows(dOut, dIn)` is `rank(dOut) ≤ rank(dIn)` OR the one exception the rank model cannot express: a combo may narrow into its element scalar. `SOCKET_ACCEPTS` is built from it. [[D13]] widenNeverNarrow.
3. **The bridge is built by the same predicate.** `logical ↔ number` is the ONE cross-family bridge (0/1 ⟷ TRUE/FALSE, the multiply-by-a-condition idiom); it is mirrored through `dimFlows` on both sides, so the combo → scalar exception can't hold on one side and not the other (`logicalcombo → number` must flow wherever `logical → number` does). `coerceInputs` does the runtime conversion. [[D11]] noAutoCross.
4. **Combo collapses a singleton at arrival.** A 1-element list arriving at a combo or any scalar rung is that scalar (`coerceInputs.collapseSingleton`); a strict list rung keeps its list and re-widens a scalar on the way in, so the round trip is lossless. A complex is a tagged scalar and collapses like one. This is what makes the combo→scalar edge true rather than merely permitted.
5. **Cross-type dimensional edges are explicit in `accepts()`** because rank derivation can't express them, and they are the edges a rework is most likely to lose. The complete list:
   - `combo → scalar` within a family (req. 2); `anycombo → any` for the same reason.
   - `any` INPUT: every family scalar and combo, plus `anycombo`. `any` OUTPUT: everything but the object family (lambda / chart / document).
   - `anylist`: 1-D both ways (INPUT takes every rank-1 family value and `anycombo`; OUTPUT reaches every family list/combo). `anycombo`: 0-or-1-D (INPUT takes rank-1 family values and `anylist`; OUTPUT reaches every non-object input).
   - `anytable` INPUT: any rank ≤ 2 family value or `anylist` (a list or scalar WIDENS into the 2-D wildcard). `anytable` OUTPUT: strictly 2-D, reaches concrete matrices only, never narrows.
   - `anydata` INPUT: any rank ≤ 2 family value, `anylist`, `anytable`; refuses frames, cubes and the object family. `anydata` OUTPUT: every non-object input. Only `anylist` / `anytable` outputs need naming in the input branch; `anycombo` / `any` outputs already reached every non-object input. [[E5]] anydataWildcard.
   - `frame` INPUT: any rank ≤ 2 family value, `anytable` or `anylist` (a matrix is rows × cols, a 1-D list is a single ROW, CSV-consistent, transpose for a column; a scalar is 1×1; `coerceInputs` builds it via `frameFromRows`). `frame` OUTPUT: another `frame` or a `cube` only (headers would be lost otherwise).
   - `cube` INPUT: everything `frame` takes plus `frame` itself (the supremum). `cube` OUTPUT: only another cube or `any`: the nesting would be silently dropped by any narrower container. [[E2]] cubeNeverNarrowsToFrame.
   - `trueany` on either side accepts everything; it resolves by adoption (req. 8).
6. **Element-agnostic 2-D inputs use the GRID socket** (`anyTableIn`), not the scalar-circle `any`: TRANSPOSE, HSTACK, CHOOSEROWS/COLS, reshape-flatten, MAP/BYROW/REDUCE values. `any` is the rank-0 wildcard (comparison values, CHOOSE/SWITCH rows, EXPAND's fill, fold seeds); Cast / Display / IS.TEST are `trueany`; Expression and computed-column variables are `anydata`; a LAMBDA's captured-variable inputs are `anylist` (a matrix does not wire into a λ capture). TableInfo is `frame`-typed so anything rank ≤ 2 widens in and it reports R×C.
7. **The socket type is the only date signal.** A date serial is a number at runtime, so every "is this a date?" check routes through `isDateType`; a port whose value IS a date uses the date family. [[D12]] dateValuedPortIsDateTyped.
8. **Adoption keeps rank on the rank-bearing wildcards.** When a cable lands on an adoptive input, `adoptTypeForBase`: an `anylist` / `anytable` base keeps its rank and adopts only the wired ELEMENT family (a wider wire is taken verbatim, a narrower one is lifted to the base's rank in the wired family); a family-less wire carries nothing to adopt, so the port keeps its base, and the rank-0 / combo / `anydata` bases follow the same family-less rule; `trueany` adopts verbatim. `projectTypeToBase` is the OUTPUT-side mirror (WRAPROWS widens, flatten narrows) and its family-less branch must agree with the input side. [[D15]] wildcardsKeepRank.
9. **Adoption never touches connections and is never saved.** `settleWildcardTypes` repeats the adoption pass until nothing changes: a chain of N passthroughs settles in at most N passes, and the pass cap guards a `#CIRC!` loop. It alternates with Conduit lane typing until both settle together, because each can feed the other. One frame-shape walk serves every pass, since shape depends only on topology and literal config, which no pass changes.
   - Output policy comes from the node's `passthrough()` declaration, the same single source unit flow reads.
   - When branches vote, an unwired or error-only source abstains and a `trueany` vote vetoes agreement.
   - A reshape that crosses rank adopts the element family at its own declared rank. [[D15]] wildcardsKeepRank, [[E7]] trueanyNeedsPassthrough.
10. **Two wildcard predicates, on purpose.** `isWildcardType` names the rankless rungs only (a rank-bearing wildcard is a real dimensional constraint, not "untyped"); `isWildcardRung` names every family-less rung and is the one to use for resolving a family. Every see-through-an-untyped-hop check calls `isWildcardType`. [[E4]] oneResolvePredicate.
11. **Each port owns its mutable socket.** `MutableSocket` / `AdoptiveSocket` instances are per port, never module-level, so a retype on one card never lands on another. [[E6]] portOwnsSocket.
12. **A new socket type is a derived edit.** Extend the product; the sweep picks it up. Hand-writing its pairs is the failure mode this spec exists to prevent. [[D14]] derivedSocketTypes.

## Enforcement

`socketConnect.test.ts` sweeps the entire family × dimension cross product with the SAME `dimFlows` predicate (within-family widening + combo→scalar; cross-family blocked except `logical↔number`; every rank ≤ 2 value reaches `anytable` / `frame`; outputs stay 2-D / frame-only; `any` bridges both ways) and pins both family-less adoption branches. `socketReference.test.ts` checks every connection list in `docs/socket-reference.md` against `accepts()`. The "Dimensional Flow" seed demonstrates it visually.

## Out of scope

Unit separation (`#UNIT!` at compute time, `unitLattice.ts`, [[C25]] firstClassUnits): `accepts()` stays unit-blind. Value coercion on arrival beyond req. 4 (`coerceInputs.ts`, `docs/value-semantics.md`). In-place retype reconciliation ([[D16]] retypeReconciles, `fcReconcile.ts`).

## Gaps

A builder that finds this spec silent stops that part and runs `python tools/dte.py gap [[socket-lattice]] --title "..." --by <name>`; it never improvises.

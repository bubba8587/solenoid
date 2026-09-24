---
aliases: ["Socket lattice"]
tags: [spec, values]
---
<!-- [[C10]] socketLattice, [[D11]] noAutoCross, [[D12]] dateValuedPortIsDateTyped, [[D13]] widenNeverNarrow, [[D14]] derivedSocketTypes, [[D15]] wildcardsKeepRank, [[E5]] anydataWildcard, [[E6]] portOwnsSocket, [[E7]] trueanyNeedsPassthrough -->

# Spec: Socket lattice

Serves [[C10]] socketLattice: type separation and dimensional flow, derived from the family × rank product. It covers what the system does and blocks, and the decision each behavior serves; a builder implements this file without reading the tree. `docs/socket-reference.md` is the per-variant reference for readers, with each socket's dot shape and color.

Every socket has a type (`SocketDataType`, `sockets.ts`), and the type decides which cables may connect. Element families never cross on their own: crossing takes a Cast, and the only bridge is `logical ↔ number`. Values flow freely up in rank: scalar, list, matrix, Frame, Cube. Which connections are legal is derived from the family × rank product, never listed pair by pair.

## Constraints

- [[D11]] noAutoCross: a value's type is part of its meaning, so a connection that would silently coerce is refused.
- Reopen if: a new family or a second bridge. Re-derive the lattice and the sweep; never hand-edit a pair.

## Requirements

1. **The grid.** The regular types are an element × dimension product: `FAMILIES` (number, string, date, complex, logical) × `DIMS` (scalar, list, combo, matrix). Each family's rank-1 rung comes in two forms: `list` (strict) and `combo` (scalar or list). [[C10]] socketLattice, [[D14]] derivedSocketTypes.
2. **One predicate derives the within-family accept-sets.** `dimFlows(dOut, dIn)` is `rank(dOut) ≤ rank(dIn)`, or the one exception the rank model can't express: a combo may narrow into its element scalar. `SOCKET_ACCEPTS` is built from it. [[D13]] widenNeverNarrow.
3. **The bridge is built by the same predicate.** `logical ↔ number` is the one cross-family bridge (0 and 1 for FALSE and TRUE, the multiply-by-a-condition idiom). It is mirrored through `dimFlows` on both sides, so the combo-to-scalar exception can't hold on one side and not the other (`logicalcombo → number` flows wherever `logical → number` does). `coerceInputs` does the runtime conversion. [[D11]] noAutoCross.
4. **A combo collapses a singleton on arrival.** A one-element list arriving at a combo or any scalar rung is that scalar (`coerceInputs.collapseSingleton`); a strict list rung keeps its list and re-widens a scalar on the way in, so the round trip is lossless. A complex is a tagged scalar and collapses like one. This is what makes the combo-to-scalar edge true rather than merely permitted.
5. **Cross-type dimensional edges are explicit in `accepts()`**, because rank derivation can't express them and they are the edges a rework is most likely to lose. The complete list:
   - `combo → scalar` within a family (req. 2), and `anycombo → any` for the same reason.
   - `any` as an input takes every family scalar and combo, plus `anycombo`. As an output it reaches everything but the object family (lambda, chart, document).
   - `anylist` is 1-D both ways: as an input it takes every rank-1 family value and `anycombo`; as an output it reaches every family list and combo. `anycombo` is 0-D or 1-D: as an input it takes rank-1 family values and `anylist`; as an output it reaches every non-object input.
   - `anytable` as an input takes any family value of rank 2 or less, or `anylist` (a list or scalar widens into the 2-D wildcard). As an output it is strictly 2-D and reaches concrete matrices only; it never narrows.
   - `anydata` as an input takes any family value of rank 2 or less, `anylist` and `anytable`, and refuses Frames, Cubes and the object family. As an output it reaches every non-object input. Only `anylist` and `anytable` outputs need naming in the input branch, since `anycombo` and `any` outputs already reach every non-object input. [[E5]] anydataWildcard.
   - `frame` as an input takes any family value of rank 2 or less, `anytable` or `anylist`: a matrix is rows × columns, a 1-D list is a single row (as in CSV; transpose for a column), and a scalar is 1×1, with `coerceInputs` building it through `frameFromRows`. As an output it reaches only another `frame` or a `cube`, since anything else would lose the headers.
   - `cube` as an input takes everything `frame` takes, plus `frame` itself (the supremum). As an output it reaches only another `cube` or `any`, since any narrower container would silently drop the nesting. A Frame verb that should take a Cube gets a cube-adoptive input of its own (`cubeAdoptIn` with `noWidenInputs`, the Add Column pattern); how it flattens or refuses nested columns is in the frame-verbs spec. The lattice is never widened for one node. [[D13]] widenNeverNarrow.
   - `trueany` on either side accepts everything; it resolves by adoption (req. 8).
6. **Element-agnostic 2-D inputs use the grid socket** (`anyTableIn`), not the scalar-circle `any`: TRANSPOSE, HSTACK, CHOOSEROWS and CHOOSECOLS, reshape-flatten, and the MAP, BYROW and REDUCE values. `any` is the rank-0 wildcard (comparison values, CHOOSE and SWITCH rows, EXPAND's fill, fold seeds). Cast, Display and IS.TEST are `trueany`; Expression and computed-column variables are `anydata`; a LAMBDA's captured-variable inputs are `anylist`, so a matrix does not wire into a λ capture. Table Info is `frame`-typed, so anything of rank 2 or less widens in and it reports rows × columns.
7. **The socket type is the only date signal.** A date serial is a number at runtime, so every "is this a date?" check goes through `isDateType`, and a port whose value is a date uses the date family. [[D12]] dateValuedPortIsDateTyped.
8. **Adoption keeps rank on the rank-bearing wildcards.** When a cable lands on an adoptive input, `adoptTypeForBase` decides its type. An `anylist` or `anytable` base keeps its rank and adopts only the wired element family: a wider wire is taken as is, and a narrower one is lifted to the base's rank in the wired family. A family-less wire carries nothing to adopt, so the port keeps its base, and the `any`, `anycombo` and `anydata` bases follow the same family-less rule. `trueany` adopts the wired type as is. `projectTypeToBase` is the output-side mirror (WRAPROWS widens, flatten narrows), and its family-less branch must agree with the input side. [[D15]] wildcardsKeepRank.
9. **Adoption never touches connections and is never saved.** `reconcileTrueAnyTypes` repeats the adoption pass until nothing changes, at most 32 passes: a chain of N passthroughs settles in at most N passes, and the cap guards a `#CIRC!` loop. `settleWildcardTypes` alternates it with Conduit lane typing (`reconcileConduitTypes`), at most 8 rounds, until both settle together, because each can feed the other. One frame-shape walk serves every pass, since shape depends only on topology and literal config, which no pass changes. Each pass first sets every adoptive input (the wired output's type through `adoptTypeForBase`, or its `base` when unwired), then every passthrough output that is a `MutableSocket`, projected through `projectTypeToBase` when it is adoptive.
   - Output policy comes from the node's `passthrough()` declaration, the same single source unit flow reads.
   - When branches vote, an unwired source or one flagged `errorOnlyOutput` abstains; a branch votes its input socket's current type, and a `trueany` vote (statically unknowable) vetoes agreement. The projection context (the frame shape on an input, and whether an input is wired) is built lazily, since only an extraction out of a Frame asks for it.
   - A reshape that crosses rank adopts the element family at its own declared rank. [[D15]] wildcardsKeepRank, [[E7]] trueanyNeedsPassthrough.
10. **Two wildcard predicates, on purpose.** `isWildcardType` names the two rankless rungs, `any` and `trueany`, since a rank-bearing wildcard is a real dimensional constraint, not "untyped". `isWildcardRung` names every family-less rung (adding `anycombo`, `anylist`, `anytable` and `anydata`) and is the one to use for resolving a family: the see-through walks (the FC's `concreteTypeOfOutput`, the adoption settle) call it. `isWildcardType` itself is read only by `isWildcardRung` and by `familyOf`'s provisional-number rule. [[D15]] wildcardsKeepRank.
11. **Each port owns its mutable socket.** `MutableSocket` (the FC, Conduit lanes) and `AdoptiveSocket` instances are per port, never module-level, so a retype on one card never lands on another; the reconcile pass finds adoptive ports by `instanceof`. An `AdoptiveSocket` reverts to its `base` when unwired, and a base narrower than `trueany` keeps the port restricted to that rung while it still adopts the wired concrete type. [[E6]] portOwnsSocket.
12. **A new socket type is a derived edit.** Extend the product; the sweep picks it up. Hand-writing its pairs is the failure mode this spec exists to prevent. [[D14]] derivedSocketTypes.

## Rules and their reasons

### Date-valued ports are date-typed

**MUST:** a socket whose value is a date uses the date family (`date`, `datecombo`, `datelist`, `datetable`), never `number` or `numlist` on the grounds that a serial is numerically a number (req. 7). A wildcard rung is not a violation, since it has committed to no family.

A date serial and a plain number are the same `number` at runtime, so once a date rides a numeric port nothing downstream can tell them apart: Cast's date-aware text conversion, the FC's date styles and the type-default display all read the socket, not the number. The date family also brings the typeable date-list editor, which is why such a port declares `stringLiterals` too ([[inline-literal-maps]]).

*Exception:* a port whose label only mentions time while holding a count or an index ("Start period", "Days", "Coupon rate") is a number and stays one. The guard anchors on a label ending in date or dates for exactly this reason. **Removed by:** port semantics declared directly instead of inferred from the label.

### New socket types are derived

**MUST:** a new socket type is added by extending the family × rank product (req. 12). Cross-type dimensional edges are explicit in `accepts()` (req. 5) and swept exhaustively by test; a new type never needs its pairs written by hand. Hand-listed pairs grow with the square of the variant count, and a hand-kept list drifts from the rule it copies.

### The wildcard ladder keeps rank

**MUST:** the untyped ladder is `any` (scalar) → `anycombo` (scalar or list) → `anylist` (list) → `anytable` (matrix) → `anydata` (up to a matrix) → `trueany` (anything). The strict rungs, `anylist` and `anytable`, keep their rank and adopt only the wired element family; the elastic rungs, `any`, `anycombo` and `anydata`, adopt the wired type as is; every rung keeps its base on a family-less wire (req. 8, `adoptTypeForBase`, `RANK_BASES` in the sweep).

**MUST:** adoption (`trueAnyAdopt.ts`) resolves a type without disconnecting anything, and the adopted type is never saved; it is worked out again from the wiring after load (req. 9).

A wildcard that forgot its rank would let a list-shaped port take a matrix, and any untyped hop would become a way around [[D13]] widenNeverNarrow. Adoption is a reading of the current wiring, not something the user authored: dropping cables would destroy work to satisfy a guess, and saving the guess would freeze a type the wiring no longer implies. `trueany` draws as the hollow ring. INDEX takes its element family from its container, including a Frame column when `frameShapeResolver` can know it ahead of time; a Cube cell stays `trueany`, because a Cube is the one container whose cells can differ within a column.

### anydata, the formula-variable wildcard

`anydata` is the socket for a value that may be a scalar, a list or a matrix of any element type and passes on exactly as it arrived. Every formula variable uses it.

**MUST:**
- As an input it accepts every value of rank 2 or less and the smaller wildcards (`any`, `anylist`, `anycombo`, `anytable`), and refuses Frames, Cubes and the object family (req. 5).
- It never changes what it is given: a scalar stays a scalar and a list stays a list.
- As an output it connects wherever `anycombo` does; its actual shape is known only at run time, with the same accepted risk.
- A formula surface's variable and side sockets are `anydata`: Expression variables, and Computed Column side inputs (a side value can be a whole list, as in `SUM(list)`, or a row-aligned list read with `@name`).
- The result socket keeps its family instead. The `resultAs` combo socket serves results of rank 1 or less; a matrix result swaps to the same family's matrix socket and reconciles through `retypeOutputCables` ([[type-propagation-on-in-place-socket-retype]]). Downstream FCs keep their family, and the socket never lies about rank.

Its two neighbors each fail a formula variable. `trueany` accepts everything and doesn't change its input, because it exists to carry a value somewhere unchanged, but it also accepts Frames, Cubes and objects, which must never enter a formula ([[C15]] matricesInFormulas). `anytable` (Any Matrix) turns every scalar or list wired into it into a matrix, so a variable would see `5` as a 1×1 matrix, breaking every function that expects a scalar or a list and changing every downstream rank. `anydata` is the one that doesn't change its input and still keeps Frames, Cubes and objects out; `anycombo` can't do it, because it refuses the matrices [[C15]] admits. The result socket isn't `anydata`, because that would give up the family FCs key on (`familyOf` is none) for a rank the matrix sockets already spell.

### Each port owns its socket instance

**MUST:** every `MutableSocket` or `AdoptiveSocket` port gets its own fresh instance, never a shared module-level one (req. 11). The `staticTrueAny*` / `trueAnySocket` singleton is outside the rule: it is a plain immutable `SolenoidSocket`, so the sweep never sees it.

A shared mutable socket means wiring a date into one card retypes another card's port, which then coerces its input under the wrong type and answers a believable number the user can't trace. The Input Switch's shared `valueSocket` did exactly this.

## The API

- `accepts(inT, outT)` is the one directional primitive. `canConnect(out, inp)` and `SolenoidSocket.canConnectTo(input)` are its directional forms, used by the connection guard. `areCompatible` and `isCompatibleWith` are symmetric and serve only non-connection uses such as legend and highlight grouping.
- `is2DType` is true for the matrices, `anytable`, `frame` and `cube`. `MATRIX_TYPES` is the homogeneous matrices plus `anytable`, not `frame`.
- `elementFamilyOf(dt)` is a type's family at any rank, or `null` outside the five families. `typeAtRank(dt, rank)` is the same family at another rank (`strlist` at rank 2 is `strtable`). `comboOfType(dt)` is the family's combo rung, the honest output type for an element-preserving extraction whose rank depends on runtime arguments (INDEX), and `comboOfFamily(name)` does the same from a family name, which is what a Frame column's `type` is.
- `latticeRank(dt)` is 0 for a scalar and `any`, 1 for a list or combo and for `anylist` and `anycombo`, 2 for a matrix and for `anytable` and `anydata`, and `null` for the rankless structural types.
- `SOCKET_COLORS` are CSS variables, so socket colors follow the theme live; `SOCKET_TYPE_LABELS` is a socket dot's hover title, the only path to "what type is this" that doesn't depend on color.

## Enforcement

`socketConnect.test.ts` sweeps the whole family × dimension cross product with the same `dimFlows` predicate (within-family widening and combo-to-scalar; cross-family blocked except `logical ↔ number`; every value of rank 2 or less reaches `anytable` and `frame`; outputs stay 2-D or Frame-only; `any` bridges both ways) and pins both family-less adoption branches. `socketReference.test.ts` checks every connection list in `docs/socket-reference.md` against `accepts()`. The "Dimensional Flow" seed shows it visually.

## Out of scope

Unit separation (`#UNIT!` at compute time, `unitLattice.ts`, [[C25]] firstClassUnits): `accepts()` stays unit-blind. Value coercion on arrival beyond req. 4 ([[compute-pass]], "Arrival coercion"). In-place retype reconciliation ([[D16]] retypeReconciles, [[type-propagation-on-in-place-socket-retype]]).

## Gaps

A builder that finds this spec silent stops that part and runs `python3 tools/dte.py gap [[socket-lattice]] --title "..." --by <name>`; it never improvises.

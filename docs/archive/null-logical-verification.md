# Verification checklist — Null & Logical (array-semantics build)

How to use: open the **"Null & Logical"** seed (seed menu), then tick each row by
eyeballing the node's value box. A few items aren't in the seed (matrix ops, live
editing) — those are under **Manual checks** at the bottom. Everything here is on
the `working` Vercel deploy.

## Seed clusters (load "Null & Logical")

### A · Aggregators skip null
- [ ] The `vals` Get-Column box reads **`1, null, 3, 4`** (a real `null`, not `0`).
- [ ] **SUM → 8**.
- [ ] **AVERAGE → 2.667** (8 ÷ 3 present values — NOT 2, which would be ÷4).
- [ ] **ISNULL → `FALSE, TRUE, FALSE, FALSE`**.

### B · Comparison & logic → real TRUE/FALSE
- [ ] `5 > 3` Display reads **`TRUE`** (the word, not `1`).
- [ ] The comparison's output socket dot is **purple** (logical), not amber.
- [ ] `× 10` Display reads **`10`** (TRUE coerced to 1, ×10).
- [ ] **AND** Display reads **`TRUE`** (its `b = 1` coerced to TRUE).

### C · Per-cell errors stay in the list
- [ ] `1 / x` Display reads **`1, #DIV/0!, 0.5`** (the error is one cell, not the whole list).
- [ ] Cast Display reads **`1, #VALUE!, 3`** (the `"abc"` cell errored; `1` and `3` are fine).

### D · Test node — null vs unwired
- [ ] The wired 1×1 table → ISNULL Display reads **`[[FALSE]]`** (a chip).
- [ ] **Click that ISNULL's chip** → the table popup opens showing `FALSE` and **does NOT black out the app** (this was the crash).
- [ ] The **unwired** ISNULL reads **`—`** (blank) — unwired is NOT treated as null.

### E · Empty Table Input stays editable
- [ ] The "just a comma" Table Input shows **"empty" + a chip** (not a dead `—`); clicking the chip opens an editable grid.

### F · Kleene logic + Filter on missing data
- [ ] `vals > 2` Display reads **`FALSE, null, FALSE, TRUE`** (the null cell → `null`, not `FALSE`).
- [ ] `Filter vals > 1` Display keeps **`3, 4`** (the `null` row is dropped, and `1` fails `>1`).

### G · Coalesce / Fill (Inc 8)
The `g` column is `1, null, 3, null, 5`; each Fill mode turns the gaps into something.
- [ ] **Fill 0** → `1, 0, 3, 0, 5`.
- [ ] **Forward fill** → `1, 1, 3, 3, 5`.
- [ ] **Drop** → `1, 3, 5` (shorter).
- [ ] **Interpolate** → `1, 2, 3, 4, 5`.
- [ ] **Coalesce (else 9,9,9,9,9)** → `1, 9, 3, 9, 5`.

### H · IS-checks are per-cell on a 2-D table (the `any`-socket logic pass)
The table is `[[1, null], [null, 4]]`.
- [ ] **ISNUMBER** chip → `[[TRUE, FALSE], [FALSE, TRUE]]` (a `null` cell is not a number; per-cell, not per-row; no crash).
- [ ] **ISNULL** chip → `[[FALSE, TRUE], [TRUE, FALSE]]`.

## Manual checks (build these quickly, or edit a seed node)

### Frame editing round-trip (the reported bug)
- [ ] Open the cluster-A Frame's popup, switch to **CSV** view → the blank cell shows **blank**, not `0`.
- [ ] Delete a numeric cell in CSV → switch to **table** view (blank/null) → switch **back to CSV** → still blank (no `0`).

### Matrix null
- [ ] A **Table Input** with text `1,\n,4` → its grid shows a blank cell (null), not `0`.
- [ ] Wire a table that has a blank cell into **MMULT** or **MDETERM** → result is **`#VALUE!`** ("complete data needed"), not a wrong number.
- [ ] **MAP** `1 / x` over a table containing a `0` → that cell reads **`#DIV/0!`** (per-cell error), the other cells compute. Opening its chip shows the code in the grid (no crash).

### Logical type plumbing
- [ ] In the socket legend, there's a **Boolean** row (purple circle/square/grid).
- [ ] A **Logical** node set to **AND/OR/NOT** shows `TRUE`/`FALSE`; set to **IF** it passes a value through (e.g. `IF(1, 5, 3) → 5`).
- [ ] Wire a comparison (logical) into a numeric input → it still connects (coerces to 1/0); wire a `0`/`1` into a logic input → it connects (coerces to TRUE/FALSE).

### Logical & error columns in a Frame
- [ ] A **Frame Input** with a `TRUE`/`FALSE` column (e.g. CSV `flag\nTRUE\nFALSE\nTRUE`) shows that column as **TRUE/FALSE**, and **Get Column → read as Number** gives **`1, 0, 1`** (logical coerces to 1/0).
- [ ] A column of `0`/`1` stays **numeric** (not auto-read as logical).
- [ ] **Add Column** of a list that contains an errored cell (e.g. a `1/0` list) into a frame keeps that cell as **`#DIV/0!`** (per-cell), not a wrong number; the frame chip/popup opens without crashing.

### IS-check ops not in the seed (build one quickly to confirm)
- [ ] **ISERROR** over a list flags a `#DIV/0!` cell **TRUE** but a `null` cell **FALSE** (a gap is not an error).
- [ ] **ISLOGICAL** (ISBOOLEAN) is TRUE only for a real `TRUE`/`FALSE` — NOT `0`/`1` (numbers) or `"TRUE"` (text); **ISTEXT** over a mixed list answers per element.
- [ ] **ISBLANK** still tests the whole input (a populated table → FALSE); per-cell missing is ISNULL's job.

## Known-incomplete (don't flag these — tracked for later)
- The table **popup grid** shows an error cell as its **code text** (e.g. `#DIV/0!`), not yet a red badge.
- **Coalesce** is 2-source (List + Else); chain nodes for 3+ (full N-ary extensible inputs is a possible later upgrade).
- **lower-rank → `frame` widening** — DONE (governing rule: enforce TYPE separation, allow DIMENSIONAL flow): a matrix, a 1-D list (→ one ROW), or a scalar (→ 1×1) now wires straight into any frame input (Get/Add/Split Column, Table Info), coerced to a default-header frame. **Load the "Dimensional Flow" seed** to verify: cluster A (list → Table Info → 1×3), B (scalar → 1×1), C (matrix → Table Info → 3×2 + Get "Col1" → 10,30,50, no Build Frame), D (list → TRANSPOSE → 3×1 column), and **E — the type wall**: a Text "42" and a Date each need an explicit **Cast → Number** (drag one straight into the `× 10` input and the cable is *refused*), while a comparison (logical) feeds `× 10` directly → 10 (the one logical↔number auto-bridge). Machine-checked by the full-sweep `lattice invariants` test in `socketConnect.test.ts`.
- **`any`-socket SHAPE audit** — DONE: the element-agnostic 2-D inputs (TRANSPOSE/HSTACK/CHOOSEROWS/COLS/reshape-flatten/MAP/BYROW/BYCOL/REDUCE-values) now use the GRID socket (`anyTableIn`), matching their grid outputs; a 1-D list still widens in (Range → TRANSPOSE → an N×1 column). True wildcards (Cast/Display/IS.TEST/vars/TableInfo) stay `any` (plain circle). Eyeball: a TRANSPOSE/MAP **input** dot should now be a grid, not a circle; wiring a list into it still connects.

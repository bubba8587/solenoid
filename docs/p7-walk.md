# P7 walk: card vs formula on each kind of nothing

The author's walk for 1.6 item P7 (`1.6-plan.md`), one case at a time. Each case is ruled before the next is
opened; nothing here changes code until the author says so. When P7 lands, the rulings move to their leaves and
specs and this file archives.

## Notation

- **`_`**: the trueblank. On a card, the input has no cable and its field is empty (cleared, so no saved value). In
  a formula, the argument slot is left empty: `ROUND(_, 2)` is written `ROUND(, 2)`, `AND(TRUE, _)` is
  `AND(TRUE, )`.
- **`x`** stays the formula variable whose socket on the Formula card has nothing wired. It is a different kind of
  nothing from `_` and is walked separately.
- A one-argument call with nothing in it (`ABS()`) is "no argument", not `_`, and is parked.
- **Scope for now: the unwired, empty field only.** A cable carrying a blank is out of scope until the author
  reopens it; no rule here covers it.

## Rulings

| # | Case | Formula | Card | Author's ruling (date) |
|---|------|---------|------|------------------------|
| 1 | ROUND, Number `_`, Digits 2 | `ROUND(_, 2)` = 0 (reads as `ROUND(0, 2)`) | `#OVERFLOW!` | Formula: 0 makes sense, for now. Card: `#OVERFLOW!` doesn't make sense (`#VALUE!` would read better). Whether a card reads `_` as 0 / FALSE / "" is open: not ruled out, needs the evidence to stack up (2026-11-05). |
| 2 | ROUND, Number 2.6, Digits `_` | `ROUND(2.6, _)` = 3 (reads as `ROUND(2.6, 0)`) | 3 | Both right; Excel answers 3 too (2026-11-05). |

## Placeholder scheme (the author, 2026-11-05, "for now")

What a card's empty field (`_`) shows and does is one of four kinds; every field declares exactly one. The first three
are told apart by shape:

| Kind | Shows | The card computes with | Example |
|---|---|---|---|
| **Fallback** | the value, muted, upright | that value | a rate field showing `0.1` |
| **Behavior** | a word in brackets, muted, upright | the behavior | XLOOKUP's Return showing `[all]` |
| **Example** | a hint, muted, *italic* | nothing: the card answers blank | Molar Mass's *H2O* |
| **Required** | nothing | nothing: the card answers a named error on purpose (`#SYNTAX!`, "*Number* is blank, and it has no default", as the required-setting role in [[input-roles]] already does) | none yet; kept as an option |

- A **default** is the value a fresh card ships in the field, which a person can clear. It usually matches the
  field's fallback but need not.
- **No hidden defaults:** a value the card's code computes from when a field is empty, which the field doesn't
  show, is outlawed. Each becomes that field's Fallback. Today these are the `Call::read_num(key, dflt)` reads in
  the Rust bodies (see Background).
- **Fallbacks are used cautiously**: they exist so a wiped card doesn't answer a nonsense error.
- **An Example is the field saying a blank here may blank the card.** It is used exactly where that is fine, as in
  Molar Mass today.
- Italics are reserved for Examples. Today every card field's placeholder is italic
  (`.solenoid-node__inline-input::placeholder` and `.solenoid-node__quoted-input::placeholder` in `nodeCard.css`), and
  so is a formula's empty-slot reading (`.fx-ghost` in `FormulaEditor.css`). Fallbacks and Behaviors lose the italic.
- A formula's empty-slot reading (the muted `0` in `ROUND(2.6, )`) is a Fallback, so it loses the italic too.
- The formula side keeps Excel's reading of `_` (case 1). A card's Fallback lives on the card, not in `ARG_ROLES`,
  except where a setting's declared blank already serves both surfaces.

## Assigning kinds (the author, 2026-11-05)

- **Fallback over Example by default**, as Excel reads an empty argument; judgement calls where a field reads better
  otherwise.
- **0 / FALSE / "" is the typical Fallback**, and another value is fine where it is better to use (quality of life),
  again by judgement: MOD's divisor at 1 rather than 0, say.
- **A Fallback that isn't Excel's empty value makes the formula diverge**: `MOD(5, )` is `#DIV/0!` in Excel, but
  the card's empty divisor would read 1. The formula's empty slot then shows and reads that Fallback (a muted `1`)
  so the two surfaces agree and the divergence is visible. That is the second step, after the card side.

## Steps

1. The card side: every field declares its kind, and a test fails for any field that declares none (the
   worklist). The hidden code defaults become Fallbacks at their current values; data fields get 0 / FALSE / ""
   unless a judgement call says otherwise; Examples and Behaviors where they fit; the italics split.
2. The formula side: where a card's Fallback isn't Excel's empty value, the formula's empty slot shows and reads it.

### Where steps 1 and 2 stand (2026-11-05)

Both are built ([[inline-literal-maps#What an empty field is]], [[D96]] emptySlotShowsItsValue). Every catalog card
field declares its kind, and `emptyFieldKinds.test.ts` fails any that doesn't; a card with a formula twin reads an empty
field as the formula reads that empty slot. No body reads an empty field any other way (`read_num` is gone). The frozen
card answers (`card_bodies_answer_as_frozen`) are unchanged: what changes is what an emptied field reads.

How each field got its kind:

- **The old placeholders**, each matching what the card already answered: Examples (Molar Mass, HR Zones, Antoine,
  Alert, EM Spectrum, E-Series, AWG, Colebrook, Switch's Value), Behaviors (XLookup's `[all]` and `[names]`, both Write
  cards' `[all]`, Cast's group separator `[auto]`), Fallbacks (Cast's decimal separator `.`).
- **The hidden code defaults** (96 reads) became Fallbacks at their values, but for these:
  - judged sample values rather than quality of life, so 0: DURATION's coupon and yield, MIRR's two rates,
    SERIESSUM's x and m; UNICHAR's code 65 became an Example (an emptied card answers blank);
  - Outliers' threshold, which moves with the method (3, 1.5, 3.5): `[by method]`.
- **Excel's empty value with no answer changed** (0, FALSE, empty text): 312 fields where the emptied card answered
  the same either way.
- **Judgement calls** (an emptied field's answer changes):
  - 0 where empty answered a nonsense error or a blank: Arithmetic, the math functions, ROUND's Number, Clamp,
    Two-input math, the distributions' x, mean, z, k and p, Fisher, Spell Number, Is Even/Odd, Is Close,
    Depreciation's cost and salvage, ISA Atmosphere's altitude (sea level), Quadratic's b and c, and the wildcard slots
    of Comparison, Between and IFERROR (Excel's 0; they read blank before).
  - The card's own value where 0 would error: Quadratic's a (1), Standardize's σ (1), Depreciation's life and period
    (1), the distributions' σ, degrees of freedom and shapes (their defaults), the discount securities' price,
    redemption and investment, Series' step (1), Slider's max (100) and step (1), Set Cell's row and column (1), FX's
    amount (1), Alert's high (100). SEQUENCE's start is 1, as in Excel.
  - Hidden values surfaced: Surface's levels (8), DDB's factor (2).
  - Behaviors: the solver cards (Equation, Triangle Solver, TVM) `[solve]`, Chart Builder's bounds and styles
    `[auto]`, Join's tolerance `[exact]`, Hypothesis Test's σ `[from sample]`, Shuffle's weights `[equal]`, List
    Index's position `[all]`, Series' stop `[none]`, Binomial Range's high `[same as low]`, Fill's
    Else `[none]`, DROP's counts `[none]`.
  - Examples: KPI's value and prior, Gauge's value, EM Spectrum's wavelength, HR Zones' max and resting, Pipe
    Roughness's diameter. SEQUENCE's columns are a Fallback of 1 (Excel's default), never a word.
  - Required: SEQUENCE's rows.
- **Per op**: LOG's base 10, CEILING.MATH's and FLOOR.MATH's significance 1, DROP's counts `[none]`.
- **Custom card components**: prompts (URLs, pickers, QR fields) are Examples in italics; Behaviors in brackets
  (`[this year]`, `[whole vault]`, `[auto]`, `[vault root]`, goal seek's `[none]` bounds). Goal seek's tolerance showed
  0 while the solver used 1e-7; it shows `1e-7` now.

**Step 2**, the formula following its card where Excel's empty value would error: CONFIDENCE.NORM and CONFIDENCE.T
(α 0.05, σ 1, n 30), SLN's and SYD's life and period (1), DURATION's and MDURATION's frequency (2), STANDARDIZE's σ (1),
the right-tailed distributions' degrees of freedom (CHISQ.DIST.RT, T.DIST.RT, T.DIST.2T 10; F.DIST.RT 5 and 10). Two
wrong words fixed on the way: CEILING.MATH's and FLOOR.MATH's empty significance showed 3 (it reads 1), GESTEP's step 1
(it reads 0). A left-out default that is a value shows as itself (`10`, `1`), not in brackets.

For the author to look over: Dollar's and Base Convert's 0 (both used to show an example, 1.02 and 1010, and compute
0; either could be an Example), and any judgement call above.

Out of scope, waiting: a cable carrying a blank; the formula variables (`x`), which read 0 when empty through
`Call::read_variable`.

## Empty text and empty parentheses (the author, 2026-11-05)

- **Empty text `""` is the same as having typed nothing.** In a total it is skipped like a blank (case 4: `SUM` over
  `[2, ""]` is 2 on the card too). Built next: the cards that refuse `""` today (Aggregate's `#TYPE!`).
- **Empty parentheses on a function that needs an argument are an empty first argument**: `SQRT()` reads as `SQRT(0)`,
  the same as the SQRT card with its field cleared. While editing, the slot shows its muted value, as a card's field does;
  a formula drawn read-only shows exactly what was typed (truth while editing, render what's proper). The value is only
  shown, never written into the formula's text. Only slots that are opened show one (`ROUND(2.6, )`, `SQRT()`), never a
  left-off trailing argument (`LOG(8)`).
- A test of a value reads an empty slot as an empty cell: `ISNUMBER()` is FALSE, `ISBLANK()` TRUE (its kind, not 0).
- Later: the muted value offered as a suggestion while typing an argument, a comma skipping it.

## Open questions

- **Does a card read `_` as Excel's empty argument (0, FALSE, "")?** Reframed by the placeholder scheme: a card
  reads `_` as its field's kind says. Whether a field's Fallback should be Excel's empty-argument value is decided
  field by field; the ledger below keeps the evidence.

## Evidence ledger: a card reading `_` as Excel's empty argument

| From case | Points | Note |
|-----------|--------|------|
| 1 | neutral | Why the card says `#OVERFLOW!`: an empty number field reads as undefined (`Call::unwired` in `crates/solenoid-core/src/nodes/fields.rs` answers `V::Undef`), which is neither a blank nor a number. ROUND computes on it, gets not-a-number, and the non-finite guard labels that `#OVERFLOW!`. The arithmetic card takes the same path to `#DOMAIN!`. The error code is an accident of that path, not a choice. |
| 2 | weak for | The card agrees with Excel, but not by reading `_` as Excel's empty argument: ROUND's Digits is a setting (`inputRoles` on `RoundNNode`, [[D86]] blankRoles), and an empty setting falls back to its default, which happens to be 0. Where a setting's default is Excel's empty-argument value, the two readings give the same answer. |

## Background: what a card's "default" is today (counted 2026-11-05)

Every built-in card input with a field, each class counted once, the pack calculators (Formula cards) left out: 571.
A card has three different things called a default:

1. **A value in the field when the card is dropped** ([[inline-literal-maps#Defaults]]).
   Number fields that are data: 167 start filled, 65 empty, 10 with a muted placeholder. Settings: 43 of 54 number
   settings start filled. The empty data fields mostly mean something empty: the unknown on the solver cards
   (Equation, TVM, Triangle Solver), "auto" on Chart Builder's bounds and styles. Text fields start empty (150).
   So `_` is rarely a fresh card's state; it is a field someone cleared.
2. **A setting's declared blank** (`ARG_ROLES`, [[input-roles]]): only the 58 inputs declared setting or required.
   It is what an emptied setting reads as. A data input has none.
3. **A number in the card's Rust body** (`Call::read_num(key, dflt)`): 77 reads, 48 of them 0, the rest other values
   (a rate of 0.1, a par of 1000, a year of 2024, UNICHAR's code 65). An emptied field computes from a value the card
   doesn't show.

An emptied data field falls to (3) where the body has one, else to undefined (case 1's accidental error).

## Probe

Answers come from a real engine pass (`tests/graph/cardPasses.ts` `inEditor`) for the card and `compileEvaluator`
for the formula, with the card's saved value for the input deleted to make the field empty.

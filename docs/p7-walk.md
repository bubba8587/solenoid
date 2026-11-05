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

## Rulings

| # | Case | Formula | Card | Author's ruling (date) |
|---|------|---------|------|------------------------|
| 1 | ROUND, Number `_`, Digits 2 | `ROUND(_, 2)` = 0 (reads as `ROUND(0, 2)`) | `#OVERFLOW!` | Formula: 0 makes sense, for now. Card: `#OVERFLOW!` doesn't make sense (`#VALUE!` would read better). Whether a card reads `_` as 0 / FALSE / "" is open: not ruled out, needs the evidence to stack up (2026-11-05). |
| 2 | ROUND, Number 2.6, Digits `_` | `ROUND(2.6, _)` = 3 (reads as `ROUND(2.6, 0)`) | 3 | Both right; Excel answers 3 too (2026-11-05). |

## Open questions

- **Does a card read `_` as Excel's empty argument (0, FALSE, "")?** Open. The evidence goes in the ledger below,
  for and against, one case at a time.

## Evidence ledger: a card reading `_` as Excel's empty argument

| From case | Points | Note |
|-----------|--------|------|
| 1 | neutral | Why the card says `#OVERFLOW!`: an empty number field reads as undefined (`Call::unwired` in `crates/solenoid-core/src/nodes/fields.rs` answers `V::Undef`), which is neither a blank nor a number. ROUND computes on it, gets not-a-number, and the non-finite guard labels that `#OVERFLOW!`. The arithmetic card takes the same path to `#DOMAIN!`. The error code is an accident of that path, not a choice. |
| 2 | weak for | The card agrees with Excel, but not by reading `_` as Excel's empty argument: ROUND's Digits is a setting (`inputRoles` on `RoundNNode`, [[D86]] blankRoles), and an empty setting falls back to its default, which happens to be 0. Where a setting's default is Excel's empty-argument value, the two readings give the same answer. |

## Background: what a card's "default" is today (counted 2026-11-05)

Every built-in card input with a field, each class counted once, the pack calculators (Formula cards) left out: 571.
A card has three different things called a default:

1. **A value in the field when the card is dropped** ([[inline-literal-maps#Defaults are real values; examples are placeholders]]).
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

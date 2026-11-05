# P7 walk: card vs formula on each kind of nothing

The author's walk for 1.6 item P7 (`1.6-plan.md`), one case at a time: each is ruled before the next opens. What
stands is built and lives in [[D96]] emptySlotShowsItsValue, [[inline-literal-maps#What an empty field is]],
[[input-roles#Placeholders]] and [[formula-language#Blank and omitted arguments]]; this file keeps the rulings in the
author's terms, what's open, and what waits on the author. When P7 closes it archives.

## Notation (chat only, never code)

- **`_`**: nothing typed. On a card, the input has no cable and its field is empty. In a formula, an empty argument
  slot: `ROUND(_, 2)` is written `ROUND(, 2)`.
- **`x`**: a formula variable whose socket has nothing wired. Its own kind of nothing, walked separately.
- **Scope so far: the empty field and the empty slot.** A cable carrying a blank is out of scope until the author
  reopens it.

## What stands (the author, 2026-11-05)

- **Every empty field is one of four kinds**, told apart by shape:

  | Kind | Shows | The card computes with |
  |---|---|---|
  | Fallback | the value, muted, upright | that value |
  | Behavior | a word in brackets, muted, upright (`[all]`) | the behavior |
  | Example | a hint, muted, *italic* (Molar Mass's *H2O*) | nothing: a blank there may blank the card |
  | Required | nothing | nothing: a named error on purpose |

- **No hidden defaults**: a value a card computes from when a field is empty is that field's Fallback, shown.
- **Fallback over Example by default; 0 / FALSE / "" is the usual Fallback**, another value where it reads better
  (a divisor at 1) by judgement. A value that can't be typed (a list such as INTERPOLATE's `1, 2, 3…`) is a Behavior.
- **The formula follows the card** where a card's Fallback isn't Excel's empty value because Excel's would error
  (CONFIDENCE's α, a depreciation's life): the formula's empty slot reads and shows the card's value.
- **The editor shows the muted value only while editing**; a formula drawn read-only shows exactly what was typed. It
  is shown, never written into the text, and only in opened slots (`ROUND(2.6, )`, `SQRT()`), never past a function's
  last argument.
- **Empty parentheses on a function that needs an argument are an empty first argument** (`SQRT()` is `SQRT(0)`). A
  test of a value reads an empty slot as an empty cell (`ISNUMBER()` FALSE, `ISBLANK()` TRUE).
- **Too many arguments is `#SYNTAX!`**, as Excel refuses it.
- **Empty text `""` is the same as having typed nothing**, and where someone typed nothing the value is nothing: Value
  Input's Text with nothing typed sends a blank (option B). Spaces stay text.

## Open

- **Totals skip `""`** (case 4): the Aggregate card's `SUM` over `[2, ""]` is `#TYPE!` where the formula says 2.
  Next to build.
- **`""` the same as blank everywhere** (option A): would make `ISBLANK("")` TRUE, against Excel. Left open.
- **A formula's empty text shown as the dash** rather than "(empty)": display only.
- **List arguments**: formulas have no array literal (`{1, 2, 3}` doesn't parse), so a list slot's Fallback can't be a
  typed list. Today a card's empty list field reads as nothing, while a formula's empty list slot reads Excel's lone 0
  (`FORECAST.LINEAR(x, , xs)` is `#DIV/0!`). Either the formula's empty list slot reads nothing too, or array literals
  are supported (Excel has them).
- **Suggesting the muted value while typing an argument**, a comma skipping it.

## For the author to look over

- Dollar's Dollar and Base Convert's Value fall back to 0; both used to show an example (1.02, 1010). Either could be an
  Example instead.
- PRICE, YIELD and the ODD functions don't implement Excel's `basis`; passing one is now `#SYNTAX!` (too many
  arguments) where it used to be silently ignored.
- The judgement calls, listed in the commit "Every card field declares its empty kind" (`git log --grep "empty kind"`).

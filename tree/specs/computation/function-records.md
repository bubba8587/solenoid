---
aliases: ["Function records"]
tags: [spec, computation]
---
<!-- [[C140]] functionRecords; covers: scripts/function-records/*.ts, scripts/function-records/plans/*.ts -->

# Spec: Function records

Serves [[C140]] functionRecords. Every function Solenoid computes has one record: a Cube that lists the function's cases, each with Excel's answer beside Solenoid's, the kind of truth that settles it, a verdict, and the citation that explains any difference. The records are where a function's answers are checked, and the Function Reference shows a function's record in the Cube popup. This spec says what a record holds, how its cases are chosen, how answers are written and compared, how Excel's answers get in, and when a record is ready.

```mermaid
flowchart LR
    src["the existing tests,<br>IronCalc's workbooks,<br>the edge grid"] -->|"harvest cases:<br>formula and inputs only"| rec["a function's record<br>(a Cube, one file)"]
    rec -->|"generate"| wb["a family's workbook:<br>each case a live formula"]
    wb -->|"opened, recalculated<br>and saved in Excel"| saved["the saved workbook"]
    saved -->|"the importer, which<br>refuses a file Excel didn't save"| rec
    rec -->|"the one run, once every<br>family is organized"| ours["Solenoid's answers"]
    ours --> rec
    rec --> verdict["a verdict per case;<br>the record is ready when<br>nothing is unexplained"]
    rec --> view["the Function Reference<br>shows it in the Cube popup"]
```

## What a record holds

A record is one file per function, `fixtures/functions/<NAME>.json`, where `<NAME>` is the function's name as a formula spells it (`STDEV.S.json`). Every name the core answers has a record: every name in the core's call table (`data/call_traits.json`) without a refusal, and every pack function. A function's family is the top-level Add menu group of the node its Function Reference row names, so TEXT and VALUE belong to Output and LEFT to Text; a function no node covers belongs to the family "Formula only". A family is the unit the work moves in: one workbook, one review. The file is Cube Input text: a JSON array of records, so a Cube Input or the Cube popup reads it with no other code ([[frame-verbs#Frames and Cubes]]). Its columns are untyped and every answer is text, so a column never claims a type its cells don't share.

Each top-level row of a record is one group of cases, with these keys:

- `group`: the group's name as the Function Reference shows it, such as "ignore_empty: empty slot" or "Examples".
- `axis`: what the group varies, one of `examples` (cases harvested from tests or workbooks), `argument` (one argument across the edge grid), `mode` (one value of a setting argument, such as XMATCH's `match_mode` of -1) or `pair` (two arguments varied together, authored by hand where one argument's meaning depends on another).
- `cite`: a list of citations that cover the whole group, each a leaf as `[[ID]] name` or a spec anchor as `[[spec#Section]]`.
- `cases`: the group's cases, a nested Frame with one row per case.

Each case row has these keys:

- `formula`: the formula as Solenoid writes it, without a leading `=`. It is the case's input of record, since an empty slot (`TEXTJOIN(",",,"a")`) exists only in formula text.
- `env`: the names the formula reads, each `name=value` with the value written in Solenoid's answer form below, such as `b=blank:` or `xs=list:num:[1, 2, 3]`. Blank when the formula reads no name.
- `excel`: Excel's answer, written as Excel's constant notation below. Blank until the importer writes it.
- `ours`: Solenoid's answer, written in Solenoid's answer form below. Blank until the run writes it.
- `expect`: the answer a `rule` or `reference` case demands, written in Solenoid's answer form: the answer the cited leaf states, or the reference's answer. Blank for every other case, since an `excel` case's expectation is Excel's column.
- `truth`: which kind of truth settles the case (below). Blank on a case still waiting for Excel's answer.
- `verdict`: how the two answers relate (below). Blank until both answers are in.
- `cite`: the leaf or spec anchor that explains a difference, or the backlog line of a known bug. Blank when the verdict is `same`.

A case's formula is written in the syntax Excel and Solenoid share, since the same text becomes the workbook's live formula. Solenoid's formulas have no array literals, no error literals and no escaped quote ([[formula-language#Lexical grammar]]), so a list, a matrix and a text holding a `"` reach a formula through a name in `env`, and an error through a function that answers one (`NA()`, `1/0`). A name in `env` is never one of Solenoid's constants (`e`, `pi`, `tau`, `phi`). In the workbook, an `env` name is a defined name: a value is the constant it holds (`xs` refers to `={1,2,3}`), and a blank refers to a cell left empty.

What a record does not store: the function's own facts that already have a declaration (its argument roles and empty-slot readings in the core's `data/call_traits.json`, its date class in `date_values.rs`, its unit class in [[unit-flow]], the family lists that name it, such as the aggregates that refuse text). The Function Reference renders those beside the record by reading the declarations, each under the leaf its declaration cites, so no fact is written twice ([[engineering#One declaration per fact]]).

## The kinds of truth

Every case is settled by exactly one kind of truth, written in `truth`:

- `excel`: Excel's answer, as the importer read it from a workbook Excel saved. Only the importer writes this kind, and it writes `excel` for no other source.
- `rule`: a Solenoid decision settles the case, because Solenoid answers otherwise than Excel on purpose or Excel has no answer to give (a function Excel doesn't have, a value with a unit). The case's `cite` names the leaf.
- `reference`: another reference settles the case where Excel has no such function, such as SciPy's answer for a statistic Excel lacks. The case's `cite` names the reference and the call.
- `past`: only Solenoid's own past answer is known. A case harvested from a frozen fixture starts here, and it never counts as evidence that the answer is right.

An answer from a Microsoft documentation page, a value remembered from an Excel session or another program's copy of Excel is not Excel's answer. A case that held such a value moves into its record with the formula and inputs only, and Excel's answer comes from the round trip.

## Writing Excel's answers

Excel's column holds Excel's answer in Excel's own constant notation, the way the answer would be typed as a constant in an Excel formula, with no kind tags, because Excel has only its own four kinds (number, text, logical, error) and no date kind:

| Excel's answer | Written as |
|---|---|
| a number | its digits as the saved workbook stores them, `0.32992582866978502` |
| text | in double quotes with an inner quote doubled, `"a""b"` |
| a logical | `TRUE` or `FALSE` |
| an error | its code, `#N/A` |
| a spilled array | an array constant, columns split by `,` and rows by `;`: `{1,"a";TRUE,#N/A}` |

A date in Excel is a number, so Excel's answer for a date is its serial in Excel's column. A formula in Excel never answers a blank: one that returns nothing shows 0, so Excel's column has no blank form. A complex number in Excel is text, so `IMSUM` answers `"3+4i"`.

## Writing Solenoid's answers

Solenoid's column holds what a user of the app gets, as `kind:value`, in the kinds of Solenoid's value model ([[socket-lattice]]):

| Solenoid's answer | Written as |
|---|---|
| a number | `num:` and the shortest digits that read back to the same number, `num:0.1`; the four non-finite forms `num:-0`, `num:inf`, `num:-inf`, `num:nan` |
| a date | `date:` and the calendar day, `date:2024-03-05`; with a time of day, to the millisecond, `date:2024-03-05T12:00:00.000` |
| text | `text:` and the text quoted as Excel quotes it, `text:"a""b"` |
| a logical | `bool:TRUE` or `bool:FALSE` |
| an error | `err:`, the code, and the message the app shows, quoted: `err:#DIV/0! "Divide by zero"` |
| a blank | `blank:` |
| a list | `list:`, its family's kind, and its items untagged: `list:num:[1, 2.5]`, `list:text:["a", "b,c"]`, `list:date:[2024-03-05, 2024-03-06]` |
| a matrix | `table:`, its family's kind, and its rows, which may differ in length: `table:num:[[1, 2], [3]]` |
| a complex number | `cx:`, the real part, the imaginary part's sign and digits, and `i`, both parts written as a number is, never rounded the way the app shows a complex number (`format_cx` keeps four digits): `cx:1.5-2.25i`, `cx:0+1i`, `cx:3+0i` |
| a value with a unit | `unit:`, the value in base SI, its dimension's symbol, and the unit it shows in when it has one: `unit:5000 m as km`; a pure ratio is `unit:5 ratio` |
| a LAMBDA | `lambda:` and its formula, `lambda:LAMBDA(x, x+1)` |

Rules that keep the form exact:

- **A list has one family.** Its items are untagged because the family says what they are. A blank or an error may stand among the items of any family, as `blank` and as `#N/A "message"`, and those are the only other item forms. A date list holds only dates beside blanks and errors, since a date beside another kind is refused ([[C137]] datesNeverSerials).
- **A mixed list is a finding, never an answer.** If an answer holds items of more than one family, it is written `list:MIXED:[num:2, text:"a"]`, the one place items carry their own tags, and a case with that answer has the verdict `unexplained` until it is fixed or ruled on.
- **A date is written as its day, never its serial.** Solenoid's calendar has no 29 February 1900 ([[C44]] dateSerials), so a Solenoid serial and an Excel serial name different days before 1 March 1900, and writing the day keeps that difference visible.
- **An error is written as the app shows it.** A Formula.js-style error inside the core is written as the Solenoid error the app turns it into, and an error's origin and file reference (graph bookkeeping, [[E9]] errorsKeepOrigin) are left out.
- **The left-out marker is a finding.** The core's left-out value (`Undef`) should never be an answer; if one is, it is written `undef:` and the case is `unexplained`.
- **Text is quoted the same way everywhere**, so a comma, a bracket or a quote inside text can't break a list.

## Comparing the two answers

The comparison reads Solenoid's kind first, then applies that kind's rule. A pair that passes is `same`; a pair that passes only through a rule named here is `same` with that rule in `cite`. Every other pair is a difference.

- **Numbers** are the same when they agree to 15 significant digits, the precision Excel shows and the one Solenoid's comparisons use ([[formula-language#Scalar operators]]). A case that needs a looser tolerance (an iterative solver's answer) is a difference unless its `cite` names the rule that allows it.
- **A date** is the same as Excel's number when the day, turned into a serial through Excel's calendar, equals it, to the millisecond for a time of day. A day before 1 January 1900 has no Excel serial, so Excel's error there is a difference settled by [[D119]] datesBefore1900. A function whose date class says it answers a date (`class_of`, [[date-values#Functions]]) answering `num:` is a difference, whatever the number.
- **Text and logicals** are the same only when exactly equal.
- **Errors** are the same when the codes are equal, or when Solenoid's code is one Excel's splits into: #DOMAIN!, #CONV! and #OVERFLOW! for Excel's #NUM!, #SYNTAX! for Excel's #VALUE!, as the table in [[error-values]] gives them. That table is the one declaration of each code's Excel twin, and the comparison reads it. Messages are never compared, since Excel has none.
- **A blank** is never the same as Excel's 0. It is a difference, accepted only with a `cite`.
- **A list** is the same as an Excel array of one row or one column holding the same items in order; a matrix is the same as an array of the same rows. Excel's column keeps which orientation Excel spilled.
- **A complex number** is the same as Excel's text when the text, read by the complex grammar, agrees to 15 significant digits in both parts.
- **A value with a unit** and **a LAMBDA** have no Excel twin, so their cases are `rule` and compare against the cited rule's stated answer.

## Verdicts

Each case's `verdict` is one of:

- `same`: the comparison passed, directly or through a named rule.
- `deliberate`: Solenoid differs on purpose, and `cite` names the leaf that decided it.
- `bug`: Solenoid is wrong, and `cite` names the backlog line.
- `gap`: one of the two answers is missing where it could exist.
- `unexplained`: the answers differ and nothing explains it yet.

## The edge grid

Every function is asked the same questions, generated, never chosen case by case. A record's `argument` groups come from a baseline call and a fixed list of probes:

- **The baseline** is one call the function answers normally, taken from the record's first `examples` case. A function without one gets its baseline authored by hand before its grid is generated.
- **One argument at a time.** Each group takes the baseline and replaces one argument with every probe, so each case differs from a normal call in exactly one place. A function that takes any number of arguments is probed at each fixed position, then at the first repeated position and at one further.
- **Every probe at every position**, whatever the argument is for, because asking a number argument for text is one of the edges the records exist to cover.

The probes, each written as both Excel and Solenoid can read it:

| Kind | Probes |
|---|---|
| number | `0`, `-1`, `0.5`, `1E+307`, `1E-307` |
| text | `""`, `"abc"`, `"5"`, `" 5 "`, `"TRUE"`, `"😀"` |
| logical | `TRUE`, `FALSE` |
| date | `DATE(2024,3,5)`, `DATE(1900,1,1)`, `DATE(2024,3,5)+TIME(12,0,0)` |
| blank value | a name bound to a blank, `b` with `b=blank:` |
| empty slot | nothing between the commas |
| error | `NA()`, `1/0` |
| list | `{1,2,3}`, `{"a","b"}`, `{TRUE,FALSE}`, `{1,2;3,4}` |
| complex | `COMPLEX(1,2)` |
| a value with a unit | a name bound to one, `u` with `u=unit:5000 m as km`, which Excel can't express, so these cases are `rule` |

`mode` groups take each value a setting argument declares, and `pair` groups are written by hand where the grid can't reach a question. A grid case nobody has answered on a side that could answer it is a `gap`.

## Getting Excel's answers

Excel's answers come only from a workbook the author opens in Excel:

- **Generating.** The cases of one function family are written into one workbook, one sheet per function and one row per case. Each row holds the case's formula as a live formula, so Excel answers it when it recalculates. A case's `env` becomes defined names on that sheet, a blank bound to a cell left empty.
- **Names Excel won't take.** A name that reads as a cell address (`p1`, `irr5`, since IRR is a column) or is `R` or `C` gets a leading underscore in the workbook only, and the record keeps the name as written.
- **Spills.** A case whose answer may be an array is written so its spill can't run into the next row's case. The exact wrapper is set and checked by the workbook's calibration sheet before any answer is trusted.
- **The calibration sheet.** Every generated workbook carries a first sheet of known cases (a number, a text, a logical, an error, a 1×3 array, a 2×2 array, a date). The importer checks them first, and refuses the workbook when one reads otherwise than expected, since then the wrapper, not the function, is what changed.
- **The importer** is the only code that writes an `excel` answer. It refuses a workbook whose saved-by record (`docProps/app.xml`'s `Application`) is not Microsoft Excel, reads each answer cell's stored value and its whole spill, writes Excel's column, and sets `truth` to `excel` on every case whose `truth` is blank. A `rule` or `reference` case keeps its truth: Excel's answer is written beside it for the reader, and its `expect` still settles it. A saved workbook is kept beside the records (`fixtures/functions/excel/<family>.xlsx`) so the import can be repeated.
- **Volatile functions** (TODAY, NOW, RAND, RANDARRAY, RANDBETWEEN) answer differently on every recalculation, so their cases record a property (the kind, the range) under `rule`, never Excel's value.

Cases harvested from IronCalc's workbooks and from the existing tests bring their formulas and inputs only, plus `expect`, `truth` and `cite` where the source states a Solenoid rule. An IronCalc case's cell references become `env` names holding the referenced cells' values; a referenced cell whose number format is a date format holds a date, every other number a number. A case outside the shared syntax (a cross-sheet reference, a structured reference, a defined name the workbook keeps elsewhere) is not harvested, and the harvest ledger says why.

## The harvest ledger

The harvest writes `fixtures/functions/harvest.json`, the proof that nothing was left behind. For every source it read (a test file, a spec, a workbook) it lists the cases it moved, by function, and every mention of a function it did not move, with the reason: a check with no single answer (a property, a card answering as its formula), a case outside the shared syntax, a statement that is not an answer. A mention neither moved nor given a reason fails the harvest. The ledger names its sources so the migration can be reviewed; the records themselves don't. Excel's answers for them come from the same round trip, so every Excel answer in every record came from one saved workbook through one importer.

## Readiness

The records are filled in this order, and no step starts before the one above it is finished for every function:

1. **Organize.** Every case from every existing source has moved into its function's record with its formula, inputs, `truth` and any `cite`; every function has its edge grid; every contradiction between the old sources has become a case. Excel's and Solenoid's columns are blank.
2. **Excel's answers.** Every family's workbook has made its round trip, and Excel's column is filled.
3. **Solenoid's answers.** One run writes Solenoid's column for every case of every record.
4. **Verdicts.** Every case gets its verdict.

A record is ready when it has no `unexplained` and no `gap`. The check that gates a change compares a run's answers against the records' `ours` column and fails on any case whose verdict would change, so a change in an answer is made in the record in the same commit, with its verdict and citation.

## What stays outside the records

- **The frozen fixtures** (`fixtures/core/`) stay as they are, as the check that tells whether any answer changed ([[rust-core]]). Their cases enter a record only as `past`.
- **Checks with no single answer** stay as tests: a property (an inverse round trip, a total conserved), a card answering as its formula ([[C17]] shareImpl), a time limit ([[C120]] linearWork), a fuzz run that must not panic.
- **Plumbing** (parsing, the socket lattice, CSV, the boundary) has no function to belong to.
- A leaf that a test must cite (`rules.test.ts`) keeps a test that cites it, which reads the cases of the records that leaf settles.

## Where the old content goes

- The hand-written Excel cases (`excel_doc_sweep.rs`, `excel_examples.rs`, `excelChecked.test.ts`, the Excel-checked parts of the finance, rounding, date and distribution tests) move into the records as cases, and their files keep only what is not a case.
- The per-function statements in [[formula-language#Function notes]] and [[excel-divergences]] become cases with a `cite`, and the specs keep the family rules and the mechanisms.
- Where two old sources disagree about a function's answer, the disagreement becomes a case, settled by Excel's answer or by a ruling, and the losing statement is deleted.

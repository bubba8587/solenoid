---
title: Close the remaining node-vs-formula reach gaps, or name a third exception
proposed_ring: E
ask: human
date: 2026-09-24
parents:
  - "[[D73]]"
---
## Decision

Build the cheap gaps:

- **WORKDAY / NETWORKDAYS weekend string.** The `.INTL` formulas take a 7-character mask such as "0000011", but the card's weekend input is number-only and its description says the string isn't supported. The input should take either.
- **CONCAT rows take a list.** The formula flattens a range, but a card row is a scalar text socket.
- **TEXTJOIN takes more than one text row.** The formula is variadic; the card has one Strings list.

For the rest, add a third exception to [[D73]] nodeCoversFormula: another card in the same menu already does it.

- RANDARRAY rows × cols: the card is 1-D only.
- FILTER's parallel `include` mask and `if_empty`: List Filter filters on the list's own values ([[C49]] filterOneJob), and Frame Filter covers masks.
- XLOOKUP over two plain lists: the card needs a Frame, and Frame from Lists builds one.

## Why

[[D73]] allows only two reasons for a missing argument: the argument is a cell-grid concept, or the formula lacks it too. None of these six fits either one. RANK's order, UNIQUE on text and dates, and QUARTILE's out-of-range answer were fixed in the same sweep.

**Owner's call:** build the first three, and accept "another card covers it" as a D73 exception for the last three, or build those as well?

## What ratifying means

- **Ratify:** three cards grow: the WORKDAY / NETWORKDAYS weekend input takes a mask string like "0000011", CONCAT rows take lists, and TEXTJOIN gets more than one text row. [[D73]] gains a third reason a card may lack a formula argument: another card in the same menu does it.
- **Build all six instead:** also a 2-D RANDARRAY, FILTER's include mask and if_empty on List Filter, and XLOOKUP over plain lists. Those cut against [[C49]] filterOneJob and duplicate Frame Filter and Frame from Lists.
- **Lean:** ratify as written.

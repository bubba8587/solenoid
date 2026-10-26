---
title: "The IM* functions refuse text, or are listed as text-form readers"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[C131]]"
---
## Decision

IMSUM, IMABS and the rest of the IM* family stop reading `"2"` as 2, or are named as functions whose argument is a text form (Excel's `"3+4i"`).

## Why

C131 says formulas never guess a type from text, but a complex number's text form is how Excel writes one.

## What ratifying means

- **Ratify:** the IM* family is listed as text-form readers in formula-language and keeps reading text.
- **Reject:** IM* refuses text like any other function, and complex numbers come only from COMPLEX or a typed input.
- **Lean:** ratify listing them as text-form readers: that is Excel's habit (B19).

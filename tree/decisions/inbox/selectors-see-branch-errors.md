---
title: "IF, IFS, SWITCH and CHOOSE pass only a test error up; a branch error that isn't chosen never surfaces"
proposed_ring: D
ask: human
made_by: ai
by: Claude Opus 5.5
date: 2026-09-24
parents: ["[[D35]]"]
---
## Decision

IF, IFS, SWITCH and CHOOSE (formula and card) see errors in their branch arguments: only an error in the test or index passes up, and an error in a branch that isn't chosen never reaches the answer. `IF(x=0, 0, 1/x)` with x = 0 answers 0, as in Excel.

## Why

Today all four are eager and pass every error up ([[D35]] errorInErrorOut), so the most common Excel guard pattern answers #DIV/0!. The change is an exception under D35 for selectors, on both surfaces (formula: skip the pre-call error check for these names; cards: add IfNode and ChooseNode to `SEES_ERRORS`). Found by the compute review. **Owner's call:** take the exception, or keep error-in-error-out strict?

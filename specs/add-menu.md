<!-- [[D5]] searchWiderThanLabel -->

# Spec: Add menu

Serves [[D5]] searchWiderThanLabel. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

**The pipeline.** `NODE_CATALOG` is a TREE of categories, pairs and leaves — that tree is
what the menu renders when the search box is empty. `flattenLeaves` flattens it for
SEARCH and appends one synthetic row per hidden op (`opEntry`, type
`` `${host}__op-${op}` ``), so folding a family onto one card never makes an op
unfindable. Those op rows are generated at search time and never inserted into the tree,
so catalog walkers don't count them as extra nodes. `scoreLeaf` then scores per QUERY
WORD against a haystack that is deliberately WIDER than what renders — label,
description, Excel names (`CATALOG_TO_EXCEL`), category path, kebab type, and
`keywords`. Each query word must land independently: as a subsequence of the haystack,
or within one Damerau-Levenshtein edit of a word the leaf answers to (`fuzzy.ts`
`withinOneEdit` / `tokenWordScore`, tokens of 4+ letters only). Word order is therefore
free ("input frame" finds Frame Input) and a one-letter typo ("frane input") still
ranks its target first instead of drowning under scattered-subsequence description
noise — pinned in `catalogSearch.test.ts` + `fuzzy.test.ts`.

**Two search surfaces, different weights.** `keywords` scores as a full-weight FIELD
alongside the label; Excel names from `CATALOG_TO_EXCEL` score at `-10` so an exact label
still wins a tie. An op row deliberately does NOT inherit its host's `keywords` (the
family's words would make every sibling match identically and the ops would stop
discriminating) — but it DOES carry its own, which is where a family declares per-op
alternate spellings.

**Why a long label is a whole-menu defect, not a cosmetic one.** `.solenoid-add-menu__scroll`
is a two-column grid (`auto auto`) so paired rows share column tracks. Every non-`--half`
child spans `1 / -1`, and a spanning item's max-content contribution is split across both
auto tracks — so the panel's width is the widest SINGLE row, and rows are
`white-space: nowrap`. There is no `max-width`. The tree view hides this because it only
ever renders one category at a time; search renders the whole catalog, so the global
widest row sets the width the moment anything is typed.

**Invariants.**
- A rendered LABEL carries only what a reader needs to pick the row. Alternate spellings
  — Excel function names above all — go in `keywords`, which scores at full weight and
  never renders ([[D5]] searchWiderThanLabel).
- An op row's label is `` `${hostLabel}: ${opLabel}` `` (`opSearchLabel`) and nothing else,
  so renaming a card renames its ops.
- `fx` (the formula name) is independent of the label and stays declared where despacing
  the label would not yield it ([[D3]] overrideInPlace, `uniqueNameMap`).
- Reachability: every op either has a row of its own or IS the family's primary op
  (`primaryOpOf`, derived by constructing the leaf — never declared).

*Origin:* the Distribution family put all four dotted Excel spellings in each op's visible
label ("Distribution: Chi-squared (CHISQ.DIST / CHISQ.DIST.RT / CHISQ.INV / CHISQ.INV.RT)").
That row measured 630px against a 94px median and, through the grid sizing above,
stretched the whole panel from 174px to 525px on the first keystroke — reported by the
author as "typing anything into the search box makes it get real wide" (2026-08-22).

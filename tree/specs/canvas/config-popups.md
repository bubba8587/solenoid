---
aliases: ["Configuration popups"]
tags: [spec, canvas]
---
<!-- [[A6]] divergeByDesign, [[B19]] spreadsheetHabits -->

# Spec: Configuration popups

Serves [[A6]] divergeByDesign (a visible graph: a card shows its work) and [[B19]] spreadsheetHabits (Excel edits a
PivotTable's fields and a Solver model in a pane and a dialog). It says when a card edits its configuration in a popup,
what its face must still show, and how the popup is built, so the next card that needs one looks and behaves like the
ones that have it. Code: `RulesPopup.tsx` and `RulesPopup.css` (the kit), `PivotEditorPopup.tsx` (the first, its own
layout), `SolverLimitsPopup.tsx`, `QueueRulesPopup.tsx`; stores `pivotEditorStore.ts`, `solverLimitsStore.ts`,
`queueRulesStore.ts`.

## When a card gets one

Everything a card does fits on the card where it can (the author, 2026-11-18: "where possible, we want to fit everything
on to cards"). A card edits its configuration in a popup only when the configuration is one of these:

- **many settings linked to one operation**: a solver's or a system's rules, where the settings only mean something
  together (Greedy Queue's order, cost, groups, steps and fit; a Solver's limits);
- **set apart from what is wired in**: settings a person picks, not values that flow in on cables;
- **arranged by drag and drop rather than by cables**: PIVOTBY's fields moved between Rows, Columns and Values.

A card with a few settings, or with settings a person wires, keeps them on its face, folded into a section where they
are secondary (`CardSection`, DESIGN.md § Card sections). Moving settings into a popup is not a way to shorten a card that
is long for other reasons.

## What stays on the card

The card stays readable without opening anything. From top to bottom:

1. **What is wired in**: its tables, the formulas (LAMBDA sockets) and the numbers a person wires as named value cards
   (a Budget, a capacity). Secondary ones fold into sections (Greedy Queue's Formulas, Numbers and Columns), each open
   once one of its inputs is wired or set; a folded section keeps a wired socket live on its caption.
2. **A column-name socket** that a cable could set, even when its value is picked in the popup: a folded section keeps the
   socket (Greedy Queue's Columns). The popup shows such a setting as "wired" while a cable sets it.
3. **The accent open button** (`CardOpenButton`: Configure fields…, Edit Limits, Edit Rules), named for what it edits.
4. **A summary of what is set**, in the step list (the Pipeline card's `solenoid-pipeline__step`, as Edit Frame lists its
   edits): a number, a name and its value per line, the value never cut (the name gives way first), the whole line on
   hover. A list the popup builds (Solver's limits) is listed item by item, each with a remove ×; rules (Greedy Queue's)
   are a line per question in plain words ("Next: cheapest first", "Cost: Hours + transitions", "Per step: within Budget, skip
   what won't fit"), and a rule with nothing set either says its default ("Steps: all at once") or is left out when it
   has none to say. PIVOTBY's summary is its one-line field list.
5. **The outputs.**

The summary is the card's account of its configuration, so it changes with every popup edit: the card redraws on the
popup store's version.

## The popup

Built on the kit (`RulesPopup`), except PIVOTBY's, whose drag zones are its own:

- **Chrome:** `PopupShell` with the card's accent (`popupCardVars`), titled "Card name: what it edits" ("Nearest next:
  Rules"), resizable, centered, Escape and the × close it.
- **Body:** Settings' grammar. A section per question under a 10px uppercase caption in the muted ink (Next item, Cost of
  an item, Groups, Steps, Budget per step; The plan must keep), a hairline between sections. A row is a label (13px) with
  an optional help line (11.5px, muted) on the left and its control on the right.
- **Controls:** a segmented choice for two to four options (Settings' segment; the selected segment filled in the
  card's accent and its ink, per DESIGN.md's Nearest-Accent Rule), a select for a column or a longer list (recessed,
  28px, a saved name the input lacks stays listed so another never shows in its place), number and text fields that
  commit on Enter or blur ([[B19]] spreadsheetHabits), percentages typed and shown as percents.
- **Settings of one thing, or that need the row above** sit indented on the guide line a limit's clauses hang on (`RulesGroup`), under a small caption when they share a subject: Transitions' four settings under "Transitions"; Who picks next and Items may under Group column. The hierarchy shows on the page rather than in the help text.
- **A setting the other rules leave without effect** stays, its label dimmed and its help saying what it needs ("Needs a
  Budget on the card", "Not used by Cheapest first"). Nothing hides because a cable arrived or a choice changed (the
  author, 2026-11-18).
- **A list** (limits) is numbered items, each a sentence of fields with a remove ×; its clauses and its Add condition
  button hang under the sentence, indented on a guide line, so they read as belonging to it (the author, 2026-11-18:
  "indentation could be a lot better"), every × on the item's right edge; with no clause yet the button stands alone, no guide line beside it. An optional clause is a line of its
  own with its own ×, opened from the item's one **+ Add condition** button: a plain secondary button with no caret,
  since it isn't a dropdown (the author, 2026-11-18), that opens the app's popup menu (`sol-popup-menu`) of the clauses
  not yet on the item, even when one is left, so the button always does the same thing; it goes once none are left.
  The menu sits in the popup's overlay, placed from the button, so the body's scroll never clips it, and opens upward
  without room below (loose text links weren't acceptable button design, the author, 2026-11-18); the section's action ("+ Add limit") sits on its
  caption row, where the Pivot editor puts "add field". An empty list says what having none means.
- **Footer:** a muted note on the left when the card holds something the popup doesn't ("Formulas and numbers are wired
  on the card."), then the accent **Done**.
- **Editing:** every change saves and recalculates at once, as a card's own edit does (`processEdited`, with the type
  reconcile), and is undoable the same way; there is no Apply. The popup reads the input's columns from its shape
  (`useFeedShape`), so it lists them before the first compute.
- **Phone and touch:** under 640px the popup takes the screen's width less 20px, every row puts its control under its label (the same in every row; wrapping wherever the width ran out left some beside and some below, the author, 2026-11-18: "it looks bad how much it's wrapping"), and a sentence of fields breaks at its one marked break (`RulesBreak`: what is measured, then its rule), never wherever the width runs out. The number and a line's × sit level with the first row of fields. On a coarse pointer the controls take the sizes the other popups take, never new ones (the author, 2026-11-18): segments, selects, fields and the Add condition button the table popup's pill height (30px) with their desktop type, a remove × a Pivot chip's (24px), Done the Pivot editor's (13px, 9px by 16px).

## A new one

Give the card a store (`createValueStore`, sanctioned in `sourceInvariants.test.ts` as one transient open popup), mount
the popup in `App.tsx` and `NodeShowcase.tsx`, build it from the kit, write the card's summary lines and redraw them on
the store's version, and list the card above. The card's spec says what each setting means; this one says where it sits.

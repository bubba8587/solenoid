---
aliases: ["Categorize"]
tags: [spec, computation]
---
<!-- [[B19]] spreadsheetHabits, [[D96]] emptySlotShowsItsValue, [[B7]] preAlphaBreakFreely -->

# Spec: Categorize

Serves [[B19]] spreadsheetHabits. It covers what the Categorize card answers, how its sort is saved, and how its sorter works.

Categorize maps a scattered list of values onto a few hand-picked categories: twenty vendor spellings onto five vendors, forty expense memos onto eight budget lines. In a spreadsheet that mapping is a two-column lookup table typed out by hand and joined back with XLOOKUP. Here the card is that table, built by dragging. The class is `CategorizeNode` (`nodes/frame.ts`), its body `categorize` (`crates/solenoid-core/src/nodes/frames.rs`), its card `components/CategorizeNode.tsx`, its sorter `components/CategorizePopup.tsx` with `categorizeEditorStore.ts`, and the sort's edits `categorizeConfig.ts`.

## What it answers

**Items** takes any list (a table is read cell by cell, row by row). Each distinct value is one item, kept in first-seen order; a repeat counts once and a blank or an error is skipped, so a raw column with repeats wires straight in. **Categories** is a text list. Wired, its distinct non-blank texts are the categories, in order; typed, the field's items are; left blank, the categories are `Category 1`, `Category 2` and `Category 3` (`DEFAULT_CATEGORIES`; the empty field reads `[3 categories]`, its Behavior).

The answer, **Lookup**, is a Frame of two columns, `Item` and `Category`: every item sorted into a category on the categories' order and, within one, the order the items were dropped there; then every unsorted item in first-seen order with a blank Category. Unsorted items stay in the table so what is left shows downstream and a Join reads the same blank either way. The Item column keeps the items' kind: Date when every item is a date, Number when every item is a number, Logical when every one is a logical, Text otherwise (each item as its text). A list mixing dates with another kind is refused as Frame from Lists refuses it. No items gives a blank answer.

The columns are always named `Item` and `Category`, since a list carries no column name; Join names its key on each side, so `Item` joins onto any column.

## The sort

The card saves its sort as `assigned`: `[category, [item key, …]]`, each category's items in drop order. An item's key is its text, a number by its digits and a date by its serial (`item_key`), so the sort reads the same however the item is formatted. Nothing is saved by position, the lesson of the Pivot's sorts ([[frame-verbs#pivot]]): a list that gains, loses or reorders items, or categories that move, leaves every sorted item where it was put.

- An item no longer in the list keeps its place in `assigned` and is sorted again when it returns.
- A category no longer among the categories (a wired list that changed, a typed name edited on the card) keeps its items in `assigned`, out of the answer: they read as unsorted, blank in the table, and the sorter marks them with the category they were in, until they are sorted again or the category returns. They are never moved into another category.
- An item two saved categories both name belongs to the first (`readAssigned` merges a repeated category; the body's walk takes the first claim).

`assigned` is copied into a save (`extractInit`) like the Pivot's places. The body shows `sortItems` (each item's `[key, text]`, a date as `DD-MMM-YYYY`) and `sortCategories` (the categories in effect) for the card and the sorter, which never compute either themselves ([[components#The rules]]).

## The sorter

**Sort items…** on the card opens it; the card's summary under the button counts the sorted items. It reuses the Pivot's Configure Fields pieces (`components/FieldChips.tsx`: `FieldsPanel` and `FieldChip`, with `PivotEditorPopup.css`): the unsorted items are the Fields list on top, and each category is a column below, up to four across and wrapping after, with `+ Category` in the footer.

- **Long items.** Items are often long (a bank memo, a free-text answer), so a chip wraps rather than clipping: up to three lines in a column, and up to two at a width capped at 300 pixels in the items list, so long items pack side by side. How many columns sit in a row follows the category count alone (`perRow`: at most five, the rows balanced, so seven categories are four and three), never the popup's width, so resizing the popup (880 pixels to start) stretches the columns and never moves a category to another row; below 130 pixels a column the grid scrolls sideways instead. A chip breaks between words, and inside a word only when the word alone is wider than the chip.
- **Placing.** Dragging a chip into a column sorts it there, onto a chip it lands before that chip, and dragging it back onto the items unsorts it, as the chip's × does. A click picks a chip, Ctrl or Cmd adds or drops one, and Shift picks the run from the last pick in the same list; a drag that starts on a picked chip carries every picked one, and with chips picked, a click on a column's empty space sorts them there. Each move commits at once and runs the card.
- **Naming.** With Categories not wired, a column's name is edited in place (it commits on Enter or blur; a name another column has is refused), its items going with it; × removes a column, its items going back to the list (the last column stays); `+ Category` adds `Category N`, the first number no column has. Every one of these writes the Categories field, so the field and the sorter are one list. The three default names are written out by the first such edit. With Categories wired, the names are the cable's and the columns only take items.

## Testing

`tests/graph/nodes/categorize.test.ts`: the answer's order and kinds, repeats and blanks, the default and wired categories, a sort holding when the list and the categories change, and the `categorizeConfig.ts` edits.

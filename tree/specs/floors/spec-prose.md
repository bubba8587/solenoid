---
aliases: ["Spec prose"]
tags: [spec, floor]
---

# Spec: Spec prose

How sentences in the specs are written. These are the author's decisions, collected one sentence at a time while reviewing sentences picked at random from the specs. This stands apart from the other style rules for now and may merge into them later.

## What a spec is for

A person should be able to read a spec, or a set of specs, first and understand what's going on, without opening the code. An agent should be able to read the same specs and roughly build the code from them. Every rule below serves that. When a sentence only makes sense to someone who already knows the code, it fails, however accurate it is. For example, "With `by`, one series per distinct value" leaves out that `by` is a key in the options string and what it does, so it doesn't tell a reader how to split a chart's series. "The `by` option names a column to split the series on, as in `by=Region`" does.

## State the rule, not who ruled

A spec says what the system does. It doesn't quote the author, credit a call to someone ("the author's call", "(author 2026-10-05)") or keep a section of rulings. When a ruling matters, write the rule it made as plain spec content. If it's a choice a person could weigh, it goes in a decision leaf, and the spec cites the leaf. Who decided what, and when, belongs in git and in the leaf's History.

## One paragraph, one line

A paragraph or a list item is written on one line, however long, and never hard-wrapped. Obsidian shows a single line break as a break, so a wrapped paragraph reads as ragged short lines. A code fence always starts on its own line.

## No second person

A spec describes the system. It doesn't talk to the reader, so there's no "you": "When the Distribution node switches to another distribution", not "When you switch the Distribution node". UI text quoted in a spec, like a "Save your changes?" prompt, stays as the UI says it.

## Every sentence reads on its own

A reader who lands on any one sentence should be able to follow it without reading the ones around it. If that means a sentence repeats something its neighbors already say, that's fine.

## "Object" for the data the app passes around

Frames, Cubes, Tables, Scalars, Charts, Documents and the rest are "objects". They're the things that show up in chips. Say "object" when you mean one of them, because "input" alone is ambiguous: it can also mean a value typed straight into a node. So it's "even when the input object is a Frame", not "even when the input is a Frame" or "even when a Frame came in".

## "Frame" for a table with headers, "table" for a matrix

A Frame is Solenoid's version of an Excel table: in plain terms, a table with headers, plus everything else a Frame carries (column types, units, formats). A spec says "Frame" whenever it means that, so a bare "table" can always mean a matrix: rows of plain values with no headers, which the `table` sockets carry. A CSV view with a header row belongs to a Frame. Explaining a Frame as "a table with headers" in passing is fine; using "table" alone for one is not.

## Proper names for well-defined things

When a piece of the app has a proper name, use it. Say "the Header", not "the app bar", so a reader knows exactly which thing is meant and can look it up. The names are in `docs/glossary.md` § The author's UI vocabulary.

## Name the node

When a sentence is about a node, it names the node: "The Nest Join node relates two Frames on a shared key column", not "The card's body relates two Frames". A section headed with a node's name still names the node in its text, because a reader can land on any sentence without the heading in view. "The card" is fine when it means what's drawn on the canvas ("the card draws one dot per spot"), but not when it means what the node computes, because the card itself is just the rectangle.


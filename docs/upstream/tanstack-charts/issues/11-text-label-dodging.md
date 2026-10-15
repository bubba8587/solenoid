# Keep annotation labels from overprinting each other

## What we needed

Reference lines in Solenoid carry labels ("GPT-3", "ChatGPT", "CHIPS Act", "GPT-4"). Events close in time put their labels on top of each other.

## Today

`text` places each label at its anchor; nothing moves it when it collides. `dodge` lays out dots, not text, and tick-label thinning only applies to axes. We place the labels ourselves (`vlinePlaces` in `src/graph/components/charts/refs.ts`): right of the line, or left where the right would run past the plot or across another line, stepping down a row where it would still overlap a label already placed. Pie outside labels get the same treatment along their leader column.

## Suggestion

A collision layout for `text`, in the spirit of `dodge`: given an anchor and a preferred side, flip or step each label to the first free slot, measured with the same text metrics the axes use. Even a `layout: stackY()` for labels sharing a baseline would cover both of our cases.

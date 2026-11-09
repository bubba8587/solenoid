---
name: build-graph
description: Build a Solenoid graph from a request ("make me a loan model", "chart these sales by region") as a text-form file, then check it, run it and screenshot it without opening the app by hand. Use when asked to author, extend or debug a graph, a seed or an example, or to answer a question by computing it in Solenoid.
---

# Build a graph

A graph is a text file, one card per line. Four commands take it from an idea to checked answers and a picture; none
needs the app open, and a whole round is a few seconds.

1. **Find the cards you need.** `npm run -s ai-grounding -- --list` prints all of them, one line each (class, name, what
   it does): grep it. `npm run -s ai-grounding -- --card join sortframe` prints those cards' entries in full: sockets,
   settings and each setting's choices, ops. The whole document (`npm run -s ai-grounding`, 130 KB) adds the socket
   types and the text form's grammar; read its first 110 lines once, not the rest.
2. **Write the file** (`<scratch>/model.txt`):

   ```
   Price: ValueInputNode label="Price" value="25"
   Qty: ValueInputNode label="Qty" value="4"
   Total: ArithmeticNode op="mul" a<-Price.value b<-Qty.value
   ---
   { "v": 2 }
   ```

   `Name: Type setting=<JSON> str:input="typed text" lit:input=<number> input<-Other.output`, then `---` and the
   sidecar. A table is a `FrameInputNode` whose `frameText` is a JSON string of columns
   (`[{"name","type","values":[…]}]`, dates as `"YYYY-MM-DD"`). Positions are optional.
3. **Validate:** `npm run -s validate-graph -- model.txt`. It refuses what the app would silently drop or ignore: an
   unknown card, setting, setting value or socket, and a cable the sockets don't allow, each with the line and the
   nearest right name. Fix until it prints `OK`.
4. **Run:** `npm run -s run-graph -- model.txt --out Total` prints that card's outputs as plain JSON (a table as its
   rows, dates as ISO text). `--set Qty=10` types into an input card first, so one file answers what-ifs;
   `-- --formula 'PMT(rate / 12, 60, 10000)' --set rate=0.05` answers one formula with no file.
   `--vault <path>` gives the Obsidian cards a vault (`demo-vault/` is one), so `VaultFolderNode folder="Tasks"` reads
   a folder of notes as a table, a row per note with its properties.
   `--data <folder>` gives Local File its data folder: `LocalFileNode fileName="monthly/*.csv"` reads every matching
   file as one table with a `File` column.
5. **Look:** `node scripts/shot-graph.mjs model.txt --out model.png` lays it out in the real app and prints every
   card's text (the `shot-graph` skill has the steps for clicking, typing and popups).

## What trips people up

- **A whole table never enters a formula or a value input.** Pull a column out (`GetColumnNode`, out `values`) or
  aggregate first; for a per-row calculation use `ComputedColumnNode` with `expr="@Qty * @Price"`.
- **A setting is not always `op`.** GROUPBY, Rollup and Group Lists take their aggregator as `agg`; the grounding's
  line for the card names the field (`- agg: …`, `- how: …`).
- **Extensible rows are keyed** `v0`, `v1` (lists), `column0`/`value0` (filters, SUMIFS), with the per-row test in
  `condConfig={"0":{"op":"gt"}}`.
- **Cards are named three ways.** The text form's `Name:` is what cables, `--set` and `--out` use; `label` is the
  title on the card; the class name is the type.
- **A name a formula doesn't know is an input.** `expr="@Amt * @Price"` on a table with no Price column makes `Price`
  an input socket that reads 0 until something is wired or typed into it (`lit:Price=3`): a column name spelled wrong
  computes quietly, so check the answer.
- **An error is an answer.** A card that can't compute prints `{"error": "#REF!", "message": …}` with the reason, and
  everything downstream of it prints the same error: read the first one.

To hand the result to the author, save the JSON the app opens: `npm run -s validate-graph -- model.txt --json > model.json`.

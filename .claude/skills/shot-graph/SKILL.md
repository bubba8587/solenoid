---
name: shot-graph
description: Load a small example graph into the live Solenoid app and screenshot it (canvas or a Frame's table popup), printing every node's text. Use to reproduce a bug on a real canvas, to verify a fix visually, or when the author asks for a screenshot of a graph.
---

# Screenshot a graph

`node scripts/shot-graph.mjs <graph.json> [--out file.png] [steps…] [--wait ms] [--palette name] [--light] [--full]`

It starts the dev server if it is down (`scripts/dev-up.mjs`), opens the graph as the only document
of a fresh browser profile, fits the view, prints each node's visible text (one line per node,
title first) and saves a PNG cropped to the nodes. One run takes about 6 seconds.

- **Write the graph in the short form.** Copy `scripts/shot-graphs/quartile-band.json`. Nodes need
  only `id`, `type` (the class name, e.g. `LambdaNode`, `FrameInputNode`) and `init`; leave out
  `x`/`y` and nodes are laid out by cable depth. Cables are strings: `"l1.result -> f1.fn1"`.
- **Frame Input:** give `frame: [{ name, cells, type?, expr? }]` instead of hand-writing `frameText`,
  and `lambdaKeys: ["fn1", …]` for its LAMBDA sockets (`fn1` is the socket the formula calls `λ1`).
- **Other nodes:** a node's `init` is what its constructor takes. When unsure, read the class, or copy
  a node from a seed or `tests/fixtures/*.json`. `literals` / `stringLiterals` go beside `init`.
- **A saved graph works as is,** including the author's live canvas, `.dev/current-graph.json`.
- **Steps run in the order given**, and every node's text prints again after them:
  `--popup [N]` opens the Nth frame chip's table and shoots only the popup (all rows, not the
  3-row preview); `--click <css>` clicks; `--type <css> <text>` replaces a field's text;
  `--press <key>` presses Enter, Escape, Tab and so on. `--full` keeps the whole viewport.
- **Editing a card's formula:** `--click .solenoid-expr__rendered --type .fx-editor__ta '<formula>' --press Escape`
  (the popup commits on close). An Fx column: `--popup --type .table-popup__exprinput '<formula>' --press Enter`.
- **`--palette <name>`** opens under a built-in palette (`Neon`, `Orchard`…) and **`--light`** in light mode.
- Read the printed text before the PNG: it often answers the question without an image.
- Save a graph worth reusing into `scripts/shot-graphs/`; keep scratch graphs and PNGs in the
  scratchpad.

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
  `x`/`y` and nodes are laid out by cable depth. Cables go under `cables` as strings: `"l1.result -> f1.fn1"`
  (`connections` takes the same strings or full connection objects); a cable naming no node stops the run.
- **It checks it loaded your graph.** The app swaps a document it can't load for a seed, and a cold dev server
  reloads the page once, so the script counts the cards: on a mismatch it reseeds and reloads once, then exits 1
  saying how many cards it found and the page's errors. An unknown `type` loads as a placeholder card and prints a
  warning. If the printed titles aren't your nodes, the shot is not your graph: fix the file, don't trust the PNG.
- **Frame Input:** give `frame: [{ name, cells, type?, expr? }]` instead of hand-writing `frameText`,
  and `lambdaKeys: ["fn1", …]` for its LAMBDA sockets (`fn1` is the socket the formula calls `λ1`).
- **Other nodes:** a node's `init` is what its constructor takes. When unsure, read the class, or copy
  a node from a seed or `tests/fixtures/*.json`. `literals` / `stringLiterals` go beside `init`.
- **A saved graph works as is,** including the author's live canvas, `.dev/current-graph.json`.
- **A text-form file works too** (`Name: Type key=… input<-Other.output`, the `build-graph` skill's format): it is validated
  first, and an issue stops the run with its line.
- **Steps run in the order given**, and every node's text prints again after them:
  `--popup [N]` opens the Nth frame chip's table and shoots only the popup (all rows, not the
  3-row preview); `--click <css>` clicks; `--type <css> <text>` replaces a field's text;
  `--press <key>` presses Enter, Escape, Tab and so on, or a combo such as `Control+Shift+Equal`. `--size 390x844` runs as a phone (mobile UA, coarse pointer, touch: `--click` taps and `--drag` uses a finger), so a grip or tap can be checked under the mobile selection gating. `--drag <css> <dx> <dy>` presses the first match's center, moves by that many screen px and releases, printing every card's box before and after (a grip test: the card should grow, not move). `--drag-hold` does the same but never lets go, so the shot shows the gesture mid-way. `--full` keeps the whole viewport. `--scale 2` shoots at twice the pixel density, for an image to share.
- **Editing a card's formula:** `--click .solenoid-expr__rendered --type .fx-editor__input '<formula>' --press Escape`
  (the popup commits on close). An Fx column: `--popup --type .table-popup__exprinput '<formula>' --press Enter`.
- **`--palette <name>`** opens under a built-in palette (`Neon`, `Orchard`…) and **`--light`** in light mode.
- **`--local key=value`** sets a raw `localStorage` entry before load, for a preference kept outside the settings store (`--local solenoid.cableShape=spline`).
- **`--setting key=value`** opens with an app setting (its `settingsStore` key, a JSON value), e.g. `--setting wasmEngine=false`
  for the JavaScript engine. A button by its text: `--click "button::-p-text(Refresh)"`.
- Read the printed text before the PNG: it often answers the question without an image.
- **Only need the values?** `npm run -s run-graph -- <graph.json> --out <card name>` runs the same short graph with no
  browser and prints that card's outputs as plain JSON, whole lists and tables included (`--raw` for the engine's own values) (`--set <input card>=<value>` types
  into an input first; `-- --formula '<formula>' --set x=3` answers one formula).
- `scripts/shot-graphs/folder-each.json` (with `--setting useDemoVault=true`) is a folder of files, each through a live
  By-Row Composite, then stacked: the model for a Composite written by hand.
- Save a graph worth reusing into `scripts/shot-graphs/`; keep scratch graphs and PNGs in the
  scratchpad.

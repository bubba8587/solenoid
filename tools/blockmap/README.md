# Blockmap

A live map of a repository's **blocks of work**, for watching several coding agents (and yourself) work in one
codebase without reading their chats. Each block is a piece of the repository one agent can own: a subsystem, a
card family, the site. An agent **reserves** a block and the block's tile lifts off the map into that agent's window,
leaving a hatched socket behind; when the work lands the tile flies home. Every tile carries its open bugs, tasks and
decisions, whether its tests last passed, and who has been editing in it.

It's isolated on purpose: zero dependencies, nothing imported from the host project, one folder (`tools/blockmap/`)
plus the host's board (`.blockmap/board.json`). Moving it to its own repository means moving this folder.

```
tools/blockmap/bm serve --open          # the board in a browser (http://127.0.0.1:4477)
tools/blockmap/bm serve --demo --open   # the same board with a simulated crew, on a throwaway log
tools/blockmap/bm hooks install         # Claude Code sessions here join the board on their own
tools/blockmap/bm help                  # everything else
```

A standalone copy that needs no server (it runs the simulated crew): `node tools/blockmap/scripts/bundle.js --out <dir>`.

## What you see

- **The map.** Districts of tiles on a dot-grid canvas, each tile sized by how much code its block covers, scaled to
  fit the window. A tile shows its open bugs, tasks and items waiting on you, the last test run, a lock when frozen, a
  warning when someone edited inside it without holding it, small dots for agents who passed through, and a cap in the
  color of whoever edited it last. A held block leaves a hatched socket in the holder's color with their initial and
  how long they've held it.
- **The windows.** One per agent, built like a Solenoid node card: a header in the agent's color with its state and a
  live timer (a stopwatch while it works, an age once it goes quiet, needs you or goes stale), then its task, what it's
  doing this second, the tray of blocks it holds, an hour of edits as a sparkline, its last three actions, its open
  question with an answer box, and a message box. **Up next** is your queue; **your own window** holds the blocks you
  keep for yourself.
- **Tethers** run from each socket to the tile in its holder's window.
- **The timeline** has a lane per agent: which blocks it held when, edits as ticks, tests, bugs and questions, and
  your own actions on the bottom lane. Drag across it, or press play (quiet stretches are skipped), to replay the board.
  It folds away; short screens start with it folded.
- **Lenses:** Work, Heat (recent edits), Issues (open items), History (who held each block last).
- **Search** finds blocks by name; a file path finds the block that owns it.
- **Alerts:** an agent editing inside a block someone else holds (or a frozen one), a holder that has gone quiet,
  failing tests, and questions waiting for you.

**Color says who; neutral says where.** The look is Solenoid's palette system, lifted whole (`ui/palette.js`, the
tables copied as data): the nine palettes, the neutral ramp per theme and the chrome derived from it, the accent-mix
rungs, the Tinted-Box Rule. Agents are colored by palette slot, so a palette change recolors them. The only other hues
are the status slots: vermilion for bugs, failing tests and conflicts, gold for what needs you, green for working and
passing. Timers read in compact units (`47s`, `12m`, `1h 05m`) and turn gold, then vermilion, at named thresholds: a
question waiting 5 and 15 minutes, an agent quiet for 10.

## What you can do

Drag a tile into an agent's window to give it the block (the agent is messaged), onto **Up next** to queue it, into
your own window to keep agents out, or back onto the map to release it. On a phone, long-press to drag, or tap a
block and use **Give to…** in its details. The details drawer also files bugs and tasks, changes an item's status,
freezes a block, and lists the specs to read before touching it. Answer an agent's question in its window; the answer
lands in its inbox.

## The agent side

Agents use the `bm` command line (`tools/blockmap/bm <command>`), or, in Claude Code, nothing at all once the hooks
are installed:

| Hook | What it does |
|---|---|
| SessionStart | joins the board and briefs the agent: who holds what, the queue, frozen blocks, the commands |
| UserPromptSubmit | marks the agent working, delivers your messages |
| PreToolUse (edits) | **refuses** an edit inside a block another agent or you hold, or a frozen one, and says why and what to do instead; an edit in a free block **reserves** it |
| PostToolUse | records the edit or the command; reads a test runner's output for pass or fail; tells the agent which specs govern a block it just reserved; delivers messages |
| Stop / SessionEnd | idle until the next prompt / leave the board, releasing every block |

The guard is per board (`"guard"` in `board.json`): `held` and `frozen` take `deny`, `ask` (prompt the person),
`warn` (allow, alert on the board) or `allow`; `free` takes `reserve`, `allow` or `deny` (reserve first). The hooks fail
open: an error in Blockmap never blocks a tool call. `BLOCKMAP=off` turns them off for one session.

The commands an agent uses most:

```
bm reserve frame-verbs --for "pivot date grouping"   # refused, with the reason, if someone else holds it
bm doing "porting the quarter grouping to Rust"
bm test fail "tests/graph/pivotDates.test.ts"
bm bug "Quarter grouping drops the year on Q1"
bm ask "Q1 2026 or 2026 Q1?"                          # the answer arrives in `bm inbox` (and through the hooks)
bm release --landed
bm check                                              # changed files outside your blocks, exit 1
```

Identity: `--as <id>`, else `BLOCKMAP_AGENT`, else the Claude Code session (`cc-` + the session id's first 8
characters), else the person at the shell, who is the human. Any command joins an agent that hasn't joined.

## The model

The truth is an append-only log, `.blockmap/live/events.jsonl` (ignored by git), one JSON event per line:
`agent.join`, `agent.status`, `agent.leave`, `block.reserve`, `block.release`, `block.queue`, `block.freeze`,
`item.add`, `item.update`, `touch`, `test`, `note`, `msg`, `msg.read`. State is never stored: it is the fold of the log
over the board (`core/model.js`, the same code in Node and the browser), which is what lets the timeline replay any
moment, and lets a renamed block or moved path re-map old activity.

Every write goes through one lock (`core/store.js`): fold the log fresh, check each event against that state
(`checkEvent`), append. Two agents racing for a block can't both win. Worktrees of one repository share the main
checkout's log. A holder unseen for `staleAfterMin` (30) can be taken over; the human can always take a block back.

**The board** (`.blockmap/board.json`, committed) names the districts and blocks. A block has an `id`, a `name`, a
`district`, `about`, `paths` (globs: `**`, `*`, `{a,b}`, a trailing `/` for a folder, a bare name matches anywhere;
the most specific pattern wins a contested file), `docs` to read before touching it, and `keywords` for routing.
`sources` import items from a markdown checklist (`- [ ] **Title** detail` under `## Heading`s): each heading routes to
a block or to `auto` (the block whose keywords the item names most), and `kinds` set an item's kind from its heading.
This board imports `docs/backlog.md`; the "needs the author's call" headings become decisions waiting on you.
`bm init` drafts a board for any repository from its folders.

**Remote agents:** `bm serve --host 0.0.0.0` with `BLOCKMAP_TOKEN` set, and agents elsewhere set `BLOCKMAP_URL` (and
the token). The CLI then talks HTTP; the hooks still need the board on disk.

## Files

| | |
|---|---|
| `core/` | the model and fold, glob matching (both run in the browser too), the store and its lock, identity, file listing |
| `adapters/markdown-checklist.js` | the backlog importer |
| `cli.js`, `bm` | the command line |
| `server.js` | the HTTP server: the page, the board, the log, a server-sent event stream tailing the log |
| `hooks/` | the Claude Code hook script and its installer |
| `ui/` | the page: map, windows, timeline, inspector, drag and drop, tethers, the simulated crew (`sim.js`) |
| `scripts/` | `bm init`'s drafter, the standalone bundle |
| `test/` | `node --test tools/blockmap/test/*.test.js` |

The page uses two Google fonts (Archivo, JetBrains Mono) and falls back to system fonts offline.

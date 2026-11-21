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

## Why use it, next to the orchestrators

Most multi-agent tools (Conductor, Claude Squad, Vibe Kanban, Crystal, Cursor's agents window) give each agent its own
worktree or branch and show you a list of sessions. Agents never see each other while they work, so overlap shows up
later as a merge conflict, and the list tells you which agent is busy but not where in the code. Blockmap is a
different layer, and it runs next to any of them:

- **Coordination before the edit, not at the merge.** A block is reserved, and the hooks refuse an edit inside a block
  someone else holds, with the reason and what to do instead. The nearest relative, MCP Agent Mail's file
  reservations, reports a conflict but doesn't stop it, and has no map.
- **The repository, not the session list.** You see where agents are and where nobody is, the backlog pinned to the
  part of the code it concerns, and what waits on you there. Code maps like CodeScene and CodeCharta show history,
  not live work.
- **What happened while you were away.** One log for every agent, replayable across the whole board, and a one-line
  digest when you come back to the tab. Session tools replay one session at a time, if at all.
- **What needs you, from every agent at once.** Questions, permission prompts and finished turns sort to the top, the
  tab title counts them, and desktop notifications can carry them.
- **No lock-in.** A CLI, Claude Code hooks and a small HTTP API over an append-only JSON log; any agent that can run a
  command can join, and it works in one checkout or across worktrees.

What it doesn't do, on purpose: start, stop or steer agents beyond messages, show terminals or transcripts, or manage
worktrees and pull requests. That's the orchestrator's job.

What it doesn't do yet, and would be worth it:
- **Hooks for other harnesses.** Any agent shows up through git and can use the CLI, but only Claude Code reports
  questions, permission prompts and turn ends without being told to.
- **Hooks against a remote board.** A cloud session can use the CLI over `BLOCKMAP_URL`, but the hooks still need the
  board on disk.
- **A board that keeps itself current.** `bm init` drafts one from the folders, and unclaimed files show up on the map,
  but the blocks are kept by hand.
- **Cost.** No token or spend tracking.

## What you see

- **The map.** Districts of tiles on a dot-grid canvas, wide tiles for the blocks with the most code, scaled to fit
  the window (down to 85%; past that it scrolls). In the Work lens a tile shows only what matters now: a conflict (someone
  edited inside it without holding it), a failing test, what waits on you (a gold chip), open bugs and a lock when
  frozen. A held block leaves a hatched socket in the holder's color with their initial and how long they've held it.
  The top bar's "need you" and "bugs" counts filter the map to the blocks they count.
- **The windows.** One per agent: a disc in the agent's color (the same disc its sockets carry on the map), the lines
  it has added and removed, and its state with a live timer (a stopwatch while it works; an age once it needs you, its
  turn ends, it goes quiet or it goes stale), then its task, what it's doing this second, its open question with an
  answer box, and the tray of blocks it holds. The chevron opens its recent actions and a message box. **Up next** is
  your queue; **your own window** holds the blocks you keep for yourself. Windows that need you sort to the top.
- **Tethers** run faintly from each socket to its holder's window; hovering a window or a socket brings that agent's out.
- **The timeline** has a lane per agent: which blocks it held when (overlapping holds stack), failing tests and
  questions. Drag across it, or press play (quiet stretches are skipped), to replay the board. It folds away; short
  screens start with it folded.
- **Attention:** the tab title counts the agents waiting on you, the bell turns on desktop notifications for them and
  for conflicts, and coming back to the tab after a few minutes shows one line of what changed, with a replay from
  when you left.
- **Lenses:** Work; Heat (recent edits, with a cap in the color of whoever edited last and dots for who passed through); Issues (open items, tasks included); Branches (which worktrees changed each block).
- **Search** finds blocks by name; a file path finds the block that owns it.
- **Alerts:** an agent editing inside a block someone else holds (or a frozen one), a holder that has gone quiet,
  failing tests, and questions waiting for you.

**Color says who; neutral says where.** The look is Solenoid's palette system, lifted whole (`ui/palette.js`, the
tables copied as data): the nine palettes, the neutral ramp per theme and the chrome derived from it, the accent-mix
rungs, the rule that a strong colored edge always has a tinted inside. Agents are colored by palette slot, so a palette change recolors them. The only other hues
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
| Notification | a permission prompt or a long wait: the agent needs you |
| Stop / SessionEnd | the turn ended, so it's your turn / leave the board, releasing every block |

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

## Worktrees and the merge queue

Blockmap reads every worktree of the repository from git every few seconds (`core/worktrees.js`): its branch, how
far it is ahead of and behind the base branch (`"base"` in `board.json`, else the remote's default, else main),
the files and lines it changed since it branched with uncommitted work included, and the files that would conflict
if it merged now, from a dry-run `git merge-tree` that touches nothing.

- **Quick swap.** The strip over the map lists every worktree with its agent, commits ahead and behind, uncommitted
  work, conflicts and queue position. A tab focuses the map on the blocks that worktree changed and gives its path,
  a copied `cd`, and an Open link for VS Code, Cursor or Zed. In a terminal, `cd "$(tools/blockmap/bm wt path agent-2)"`;
  `bm wt` lists them all.
- **The merge queue.** `bm ready` in a worktree (or Queue merge on its tab) puts its branch in line at its current
  commit. Each entry shows the worst of: conflicts with the base, failing tests, nothing to merge, uncommitted work,
  new commits since it was marked ready, commits behind the base, files it shares with a branch ahead of it in the
  queue, and no test run. The arrow moves an entry up; the first one copies its merge command. Blockmap never merges:
  the lead does, and the board marks the entry merged when the commit shows up in the base. `bm merge` prints the
  same queue.
- **What is being changed where.** A tile changed in two or more worktrees carries a branch chip (red when one of
  them already conflicts with the base in that block): those branches will meet at the merge. The Branches lens tints
  each block by the worktree that changed it, gold where several did.

## Any agent, any model

Nothing in Blockmap depends on which agent or model does the work. There are three levels of taking part:

1. **Nothing at all.** An agent that only edits files in its own worktree still shows up: the server sees the edits in
   git and records them for a stand-in agent named after the worktree.
2. **The CLI.** Any agent that can run a command can reserve, report, ask and queue. Inside a worktree it is known
   by that worktree without configuration; `BLOCKMAP_KIND` names its harness on the board. Paste this into the
   instructions file your agents read (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursorrules`, and so on):

   ```
   This repository has a Blockmap board (tools/blockmap/bm). Before editing in an area, reserve its block:
   `tools/blockmap/bm which <file>` names the block, `tools/blockmap/bm reserve <block> --for "<what>"` takes it, and a
   refusal says who holds it. Say what you're doing with `bm doing "<what>"`, record test runs with
   `bm test pass|fail "<what ran>"`, ask the human with `bm ask "<question>"` and read answers with `bm inbox`. When
   your branch is ready, commit and run `bm ready`; release your blocks with `bm release --landed`.
   ```
3. **Hooks.** A harness with lifecycle hooks can do all of that without the agent's attention.
   `hooks/claude-code.js` is the one written so far; another harness needs the same mapping: session start to
   `agent.join`, a prompt to `agent.status working`, an edit about to happen to a reservation check, an edit done to
   `touch`, a permission prompt to `agent.status waiting`, a turn's end to `agent.status review`, and the session's end
   to `agent.leave`.

## The model

The truth is an append-only log, `.blockmap/live/events.jsonl` (ignored by git), one JSON event per line:
`agent.join`, `agent.status`, `agent.leave`, `block.reserve`, `block.release`, `block.queue`, `block.freeze`,
`item.add`, `item.update`, `touch`, `test`, `note`, `msg`, `msg.read`, `merge.ready`, `merge.unready`, `merge.order`,
`merge.landed`. Worktree state is not in the log: it is read from git, live. State is never stored: it is the fold of the log
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

# Blockmap

A live map of a repository's **blocks of work**, for watching several coding agents (and yourself) work in one
codebase without reading their chats. Each block is a piece of the repository one agent can own: a subsystem, a
card family, the site. An agent **reserves** a block and the block's tile lifts off the map into that agent's window,
leaving a hatched socket behind; when the work lands the tile flies home. Every tile carries its open bugs, tasks and
decisions, whether its tests last passed, and who has been editing in it.

It's isolated on purpose: zero dependencies, nothing imported from the host project, one folder (`tools/blockmap/`)
plus the host's board (`.blockmap/board.json`). Moving it to its own repository means moving this folder. Its look is
the theme kit (`tools/solenoid-theme`), vendored into `ui/theme/` by the kit's own sync, so the folder stays whole.

```
tools/blockmap/bm serve --open          # the board in a browser (http://127.0.0.1:4477)
tools/blockmap/bm serve --demo --open   # the same board with a simulated crew, on a throwaway log
tools/blockmap/bm hooks install         # Claude Code sessions here join the board on their own
tools/blockmap/bm help                  # everything else
```

A standalone copy that needs no server (it runs the simulated crew): `node tools/blockmap/scripts/bundle.js --out <dir>`.

## What's new in 2

- **The inbox.** One window of rows that wait on you, each with its act, instead of questions and states scattered
  across the agent windows. The "need you" count is its length.
- **A map that fits.** Uniform tiles packed into shelves by a small search, so 53 blocks read at full size on a
  1280x760 laptop with room to spare. **Active** hides the quiet ones.
- **Red means a real conflict.** A pairwise merge forecast (`git merge-tree` on each pair of branch heads) separates
  branches that will conflict from branches that only touch the same files.
- **A merge queue you can drive:** reorder by drag or keyboard; Merge, Rebase or Ask to fix on each row.
- **Solenoid's palette system, whole.** The theme kit is generated from Solenoid's own palette code and stylesheets:
  the nine palettes and Custom, the accent picker (the paintbrush pill), Settings' palette select and the Custom
  editor, and the chrome rules (round tool buttons and pills, the accent on focus and selection, ramps that follow
  the accent).
- **Calmer chrome.** Flat counts, status as a neutral word with a colored dot, agents in non-status colors, tethers
  only for the agent you point at, a framed map and a clock while replaying.
- **A core an audit couldn't break:** hook calls fold once and cache path lookups (0.3 s at 50,000 events, from
  about 3), a lock that only its live owner holds or removes, a torn last line that can't swallow the next event, the
  loser of a reservation race refused, strict event checks (types, ids, colors, a server-stamped time), `--force`
  and acting for another agent kept to the person, git read without taking its index lock, linked worktrees on the
  main checkout's board, and the page applying only what the log streams.

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

- **The map.** Districts of tiles on a dot-grid canvas, every tile one size. The districts are packed into shelves (which
  districts share a row, and how many tiles tall each row is, chosen together for the least height), so the whole
  repository fits a laptop screen at full size; past that it scales to 92% and then scrolls. In the Work lens a tile
  shows only what is live: a conflict (an edit inside a block someone else holds, or a merge git says will conflict),
  a failing test, open bugs, branches that changed it, a lock when frozen. A held block leaves a hatched socket with
  its holder's name and how long they've held it. **Active** hides every block with nothing going on.
- **Needs you.** The top of the side column is an inbox, one row per thing that waits on you, each with its act: an
  agent's question (answer it there), a permission prompt or a finished turn (Go focuses its worktree and window),
  the merge queue's head when it's clean (Merge copies the command) or broken (Ask to fix messages its agent). The
  top bar's count is this list's.
- **Your window** holds your queue (**Next**) and the blocks you keep for yourself (**Yours**). While you drag a tile
  it opens both as drop zones.
- **Agent windows.** One per agent: a disc in its color (the disc its sockets carry), the lines its worktree changed
  against the base, its state as a word with a colored dot and a live timer (a stopwatch while it works), its task,
  what it's doing this second, and the tray of blocks it holds. The chevron opens its recent actions and a message
  box. Five agents or more turn the column into a roster of one-line windows. A session silent for six hours holding
  nothing drops off.
- **A tether** runs from a socket to its holder's window when you point at the agent (its window, a socket or a tile).
- **The timeline** has a lane per agent: the blocks it held (hatched while still held), a cross for a failing test and
  a diamond for a question. Drag across it, or press play (quiet stretches are skipped), to replay the board; the map
  is framed and the top bar says the time while you do. It folds away.
- **Attention:** the tab title carries the inbox count, Settings turns on desktop notifications, and coming back to
  the tab after a few minutes shows one line of what changed, with a replay from when you left.
- **Lenses:** Work; Heat (recent edits, a cap in the color of whoever edited last, discs for who passed through);
  Issues (open bugs, tasks and your calls); Branches (each block tinted by the worktree that changed it, with its
  agents' discs).
- **Search** finds blocks by name; a file path finds the block that owns it.
- **Alerts** sit in one strip: edits inside someone else's (or a frozen) block, a holder gone quiet, failing tests.

**Color says who; neutral says where.** The look is Solenoid's palette system, from the theme kit (`ui/theme/`, see
`tools/solenoid-theme/README.md`): the nine palettes and Custom, the neutral ramp per theme and the chrome derived from
it, the accent you pick with the paintbrush, the accent-mix rungs, the rule that a strong colored edge always has a
tinted inside. The gear opens Settings: the palette, Edit custom…, the accent, and the board's switches (desktop
notifications, active blocks only). Agents are colored by palette slot (sky, violet, pink, blue, purple first, so no
agent looks like a status), and a palette change recolors them. The only other hues
are the status slots: vermilion for bugs, failing tests and conflicts, gold for what needs you, green for working and
passing. Status text stays neutral beside a colored dot, so nothing depends on reading a colored word. Timers read in
compact units (`47s`, `12m`, `1h 05m`) and grow a gold, then vermilion, dot at named thresholds.

## What you can do

Drag a tile into an agent's window to give it the block (the agent is messaged), into **Next** to queue it, into
**Yours** to keep agents out, or back onto the map to release it. On a phone, long-press to drag, or tap a block and
use **Give to** in its details. The details drawer also files bugs and tasks, changes an item's status, freezes a
block, and lists the specs to read before touching it. Answer an agent's question in the inbox; the answer lands in
its inbox on the board.

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

- **Quick swap.** The strip over the map lists every worktree by its agent's name, with commits ahead and behind,
  uncommitted work, a red mark when it conflicts with the base or with another branch, and its queue position. A tab
  focuses the map on the blocks that worktree changed and gives its path, a copied `cd`, and an Open link for VS Code,
  Cursor or Zed. In a terminal, `cd "$(tools/blockmap/bm wt path agent-2)"`; `bm wt` lists them all.
- **The merge forecast.** For every pair of branches that changed a file in common, a dry-run merge of the two heads
  says whether they will really conflict once one lands (cached per pair of commits). Only those, and conflicts with
  the base, are red; branches that merely share a file are noted and stay neutral.
- **The merge queue.** `bm ready` in a worktree (or Queue merge on its tab) puts its branch in line at its current
  commit, once it has a commit to merge. Each entry shows the worst of: conflicts with the base or with a branch ahead
  of it, failing tests, commits behind the base, new commits since it was readied; then what is only worth knowing
  (shared files, uncommitted work, no test run). Each row has the one act that moves it along: **Merge** at a clean
  head (copies the command), **Rebase** or **Ask to fix** (a message to its agent). Drag the grip, or use the arrow
  keys on it, to reorder. Blockmap never merges: the lead does, and the board marks the entry merged when the commit
  shows up in the base. `bm merge` prints the same queue.
- **What is being changed where.** A tile changed in two or more worktrees carries a branch count, red only when the
  forecast or the base says it will conflict there. The Branches lens tints each block by the worktree that changed
  it and puts its agents' discs on it.

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

Every write goes through one lock (`core/store.js`): bring the fold up to date with what was appended since, check
each event against that state (`checkEvent`), append. Two agents racing for a block can't both win, and the hook
refuses the loser's edit. The lock is a file naming its owner (pid, host, a nonce): it is broken only when that
process is gone or it is a minute old, and a writer removes only its own. Worktrees of one repository share the main
checkout's board and log. `--force` (taking a held or frozen block) and acting for another agent are the person's
alone. A holder unseen for `staleAfterMin` (30) can be taken over; the human can always take a block back.

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
| `ui/theme/` | the theme kit, vendored; generated by `node tools/solenoid-theme/sync.mjs`, never edited here |
| `scripts/` | `bm init`'s drafter, the standalone bundle, the browser smoke test (`smoke.js`) |
| `test/` | `node --test tools/blockmap/test/*.test.js` |

The page uses Solenoid's fonts from Google (Atkinson Hyperlegible Next and Mono) and falls back to system fonts offline.

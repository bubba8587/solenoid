<!-- vendored from DTE 3050da4 on 2026-09-18. Do not edit; refresh with: python tools/dte.py vendor --from <your DTE checkout> -->

# DTE decisions

Every in-effect decision of DTE itself, rendered. These are DTE's, not this
project's: read them, cite nothing here, and never re-create them as nodes.

## Ring A

### A1 blastRadius: Blast radius is knowable and precedence follows position in the hierarchy (human-held)

**Decision.** If a decision is changed or reverted in a project, it is possible to know exactly what layers that decision applies to and its blast radius. A decision can be moved up and down the hierarchy, which means that a superseding or contradictory goal always takes preference over the one that was moved down (or vice versa).

**Why.** Every other decision in this repository exists to make this true.

Two clauses, both load-bearing:

1. **Knowable blast radius.** Changing a decision must not silently leave behind code, config, or other decisions that only made sense under the old decision. The tree has to be complete enough, and cited enough, that the radius can be computed rather than guessed.
2. **Position is precedence.** The hierarchy is not just a record of descent; it is an ordering. Moving a decision toward the core gives it authority over what is further out. Moving it outward subordinates it. Contradictions are resolved by position, never by recency or by who argued harder.

**Consequences.** - Every non-core decision must have parents, and every artifact must cite a decision, or the radius cannot be computed.
- Superseded and reverted decisions cannot simply vanish; their descendants have to be surfaced and dealt with.
- IDs, or something attached to them, must expose the ring so precedence is legible without a lookup.
- Tooling must exist to compute the radius; a convention nobody can query does not satisfy this goal.

### A2 nothingUndecided: Nothing in a project can exist without a recorded decision (joint) (human-held)

**Decision.** Nothing in a project can exist without a decision having been made, and DTE aims for that decision to be recorded and cited. The tree is meant to be total: ring by ring, from the abstract core out to the last line of config.

**Why.** Every thing in a project exists because a decision was made, like the rings of a tree. This is a distinct commitment from A1: A1 says the radius must be *computable*; A2 says the tree must be *complete* enough for that computation to mean anything. A partial tree gives a partial radius and false confidence.

**Consequences.** - Coverage (artifacts with at least one citation) is a first-class metric.
- Orphan artifacts and orphan decisions are always reported.
- Adoption in an existing project is a process of growing coverage toward 100%, not a switch.

### A3 provenance: Every decision records who made it, human or AI (joint) (human-held)

**Decision.** Every decision node records its provenance: whether a human, an AI, or both made it, and specifically who. AI-made decisions are visible as such until a human ratifies them.

**Why.** Some decisions are now made by AI. In an AI-built project a large share of the tree will be authored by agents, often without a human noticing the choice was made at all. If provenance is not recorded at the moment of decision it is unrecoverable later, and the owner cannot tell which parts of the tree they actually chose.

This is a core goal rather than a format detail because it changes what the tree is *for*: not only "why does this exist" but "who is accountable for it".

**Consequences.** - `made_by` and `by` are required fields on every node.
- Tooling surfaces unratified AI decisions on every validation run.
- Agents working in a DTE repo are obliged to record decisions as they make them (see B8).

### A4 dteIsPackage: DTE is a package other repos and agents adopt, never a standalone project (joint) (human-held)

**Decision.** DTE is a package. It exists to be adopted by other repositories and the agents working in them: dropped into an existing, live project without a rewrite, and run alongside structural methods such as graph engineering rather than in place of them. This repository holds the package and its reference tool. It is not the product and it is not a standalone project.

**Why.** DTE works alongside, rather than supersedes, structural methods such as graph engineering, and it exists to be applied to other projects. The meta work in this repo is meant to finish and stay finished, after which DTE is something other repos and agents add to themselves. Any format or tool choice that only works here, or only in a greenfield repo, or that tries to absorb dependency tracking, violates this. Particular target projects are test beds and are not named in the package.

**Consequences.** - Plain-text files and a single-file, dependency-free tool, so DTE can be dropped into any stack.
- Incremental coverage rather than all-or-nothing validation.
- DTE models decisions and precedence only. Structural relationships stay in the structural tool, and the two cross-reference (see B9).
- There is a finish line: a stable package (tool, SPEC, adoption guide, agent protocol) that an agent can install into another repo in one step.
- Nothing in this repo refers to a specific adopting project.

### A5 idPlusName: A decision is always referred to by ID plus its camelCase name, never by bare ID (human-held)

**Decision.** Whenever a model refers to a decision in chat or in any output meant for a person, it gives the ID together with the node's camelCase `name`, for example A5 idPlusName. A bare "A4" is never sufficient, unless the user has configured summaries off. The tool prints `ID name: title` so both are easy to copy; the name is the chat form, the title is the description a reader opens when the name is not enough.

**Why.** DTE is an AI-workflow tool: most of the time a person reads a model's message, the decision file is not open. An ID alone forces a lookup or, more likely, is skimmed past. A short handle keeps the decision legible where it is discussed and is short enough to survive in a code comment (B32); a full sentence was too long to repeat in every line of chat.

**Consequences.** - Every node carries a `name` (the handle) and a `title` (the one-sentence description). B32 fixes the shape; B16 the lengths.
- Every tool output that names a node prints `ID name: title`.
- Agent instructions forbid bare IDs in chat and use `ID name`; the title is quoted when the reader needs the sentence.
- A configuration switch may turn summaries off; the default is on.

### A6 authorityByRing: Authority follows ring; an agent decides within its ring and asks upward to place anything shallower (joint, unratified)

**Decision.** Every agent operates at a ring. It may make decisions at its ring or deeper. Any decision that belongs shallower than its ring, and any decision whose ring is unclear, is not made by the agent: it is escalated to the agent that spawned it, or to the human, with the question "where does this belong?". The tool is built so that asking is the path of least resistance.

**Why.** A new goal can arrive at any time, and without a rule the agent has no structure that makes it ask where the goal belongs.

This is also the interface between DTE and an agent hierarchy of the kind graph engineering describes: a high-level model at a shallow ring directs subagents to decide only within their deeper rings and to hand anything above that back up. Precedence (A1) makes the ring order meaningful; provenance (A3) makes it visible who decided; A6 makes the ring order the allocation of decision rights.

Authority is fluid on the human side. The owner may decide at any ring, all the way down. The structure constrains agents, not people (see B13).

**Consequences.** - An unplaced decision has somewhere to live and a visible prompt to ask (B14, the inbox).
- Agents can declare their ring to the tool and have their changes checked against it (B15).
- An advisory authority map says who holds each ring, so an agent knows whom to ask (B13, B12).
- Overriding a human-held decision is a special case of acting above your authority and is protected separately (B11).

### A7 autonomy: DTE exists so agents work autonomously and indefinitely, never re-questioning what a node justifies (human-held)

**Decision.** The tool exists to enable autonomous work, so that agents can continue indefinitely without questioning themselves. An action that an in-effect node justifies is taken and reported by naming that node, ID plus title. That report is all that needs to be said. Doubt is reserved for actions no node covers, and those go to the inbox.

**Why.** An agent that keeps flagging an action a node already justifies asks a question the tree has answered.

The tree is the standing answer to "may I?". Every ring below A exists to make that answer computable, and A6 already routes the genuinely open questions upward. An agent that re-asks what the tree has answered spends the owner's attention on nothing and stalls work that was meant to run unattended. The failure DTE guards against is the unrecorded decision, not the recorded one acted on.

**Consequences.** - Reports cite the justifying node and stop. No hedging, no "if you'd rather", no re-confirmation of a permission a node grants (B25).
- The inbox (B14) is the only place an agent expresses doubt about authority, and only for actions no node covers.
- Ratification (B7) remains the owner's channel for disagreeing after the fact; it is not a gate the agent waits on.

### A8 threeLayers: DTE holds why, specs hold what, code holds how; layers cite upward and store nothing from below (ai, unratified)

**Decision.** DTE organizes a project into three layers: decisions, specs and implementation. The decision tree holds why: goals, rules, choices and their provenance. Specs hold what: what to build, generated from the tree and citing the nodes they serve; a choice a spec forces (a dependency, a format) is recorded as a deeper node first. Code and tests hold how, and cite the nodes the spec told them to. A layer cites upward and never stores anything from below: a node never lists its tests, specs or files; those lists are derived from citations at read time.

**Why.** Writing "Enforced by: test" lines into nodes is a breach of scope: authored pointers downward go stale, and they pull test data into a document a human must keep readable. A test that cites the node is the same fact, kept where it can be checked. The same boundary answers the spec-tooling question: Spec Kit, Kiro and OpenSpec live in the middle layer, and DTE is the rationale layer under them, never a fourth spec format.

**Consequences.** - dte.cfg gains `specs` and `tests` globs beside `docs`; `show` prints "specified by", "implemented by" and "enforced by" as derived lists; `coverage` reports in-effect nodes with no citing test. No `enforced_by` field.
- `dte spec <ID>` emits a spec skeleton from a node and its subtree for a tree agent to fill.
- Reverting a node's blast radius includes its specs and everything built to them.

### A9 treeStructure: DTE provides a structure for a decision tree in other projects and also follows all its own rules (joint, unratified)

**Decision.** A project's decisions form a branching tree. Ring A holds the core goals. Each ring outward holds decisions made because of the ring inside it, and every node has parents in a shallower ring. Position gives a decision its authority and its reach: the shallower ring wins a contradiction, and a change reaches everything below. DTE provides this structure to other projects, and this repository follows every rule it provides: its own decisions are a DTE tree kept with the same tool.

**Why.** The rules on parents, precedence, IDs and refinement all describe one shape. Stated nowhere, they read as unrelated conventions. Blast radius (A1) can only be computed because position is the structure, and authority by ring (A6) only means something if rings are ordered. A package that did not follow its own rules would have no evidence that they work.

**Consequences.** - B4, B10, B32 and B35 are refinements of this node.
- Every change to DTE is made through DTE: a node first, then the tool, then the docs.

## Ring B

### B1 oneNodePerFile: One decision per markdown file with frontmatter, under decisions/<ring>/ (ai, unratified)

**Decision.** Each decision node is a markdown file with YAML frontmatter, stored at `decisions/<ring letter>/<ID>.md`. Frontmatter holds the machine-readable fields; the body holds Decision, Why, Consequences, and History.

**Why.** - A4 requires adoption in an existing project: plain markdown needs no runtime, diffs cleanly, and reads in any editor or in Obsidian.
- A2 requires the tree to be total and queryable: frontmatter gives tooling a stable schema without giving up prose for rationale.
- One file per node keeps git history per decision, which is itself part of the ring record.
- Ring directories make the tree legible in a file browser, ring by ring.

**Consequences.** - Tooling parses frontmatter; the body is for humans (see C1).
- File name equals ID; a move writes a new file and supersedes the old (C9).

### B3 citationToken: Artifacts cite decisions with a dte:ID token (ai, unratified)

**Decision.** Any artifact declares the decisions it exists to serve with the token `dte:ID` (or `dte:ID,ID`) in a comment or in prose. Citing a node implicitly cites its ancestry; cite the most specific node.

Examples in prose use the placeholder ring `ZZ` (`dte:ZZ1`, `[[ZZ1]]`); two letters is not an ID shape, so the scanner never counts it.

**Why.** A1 needs the radius to reach artifacts, not just other decisions, and A2 needs every artifact to have a lineage. The token has to work in every language and file type with no parser support, which rules out anything structured. A short grep-able prefix that sits inside any comment syntax is the lowest-friction option that still parses reliably.

`dte:` was chosen over `@dte` or `DTE(...)` because it has no meaning in any common comment or annotation system and cannot collide with decorators or doc tags.

**Consequences.** - The scanner is a regex over text files (C3).
- Coverage is measured as "files containing at least one token" (B22).
- Nodes themselves use `parents`, not tokens.

### B4 shallowerWins: Contradictions resolve to the shallower ring; same-ring contradictions are errors (ai, unratified)

**Decision.** When two in-effect nodes are declared as contradicting (`conflicts_with`), the node in the shallower ring takes precedence. Two contradicting nodes in the same ring are a validation error, resolved only by superseding one or moving one.

**Why.** Direct implementation of A1's second clause. The rule has to be mechanical so that a move has a predictable effect on every contradiction the node is party to. Same-ring contradictions are not tolerated because there is no position to appeal to; the tree would be silently inconsistent, which is exactly what A1 forbids.

Recency and authorship are deliberately not tie-breakers: precedence is position, nothing else.

**Consequences.** - `dte conflicts` prints every declared contradiction and its winner.
- Promotion or demotion is the way to change a winner.

### B6 singleScript: Tooling is a single dependency-free Python 3 script (ai, unratified)

**Decision.** The reference tool is one file, `tools/dte.py`, requiring only Python 3.8+ and the standard library. It can be copied into any project unchanged.

**Why.** A4 demands adoption into an existing project, so the tool must not bring a dependency tree, a build step, or a package manager with it. Python 3 is present on most developer machines; the standard library covers file walking, regex, and argument parsing, which is everything the tool needs.

`confidence: medium` because the language is a guess at the owner's preference. If an adopting project is a Node or other stack, a port is cheap because the tool is small and the spec, not the implementation, is normative.

**Consequences.** - No PyYAML: frontmatter parsing is a restricted subset (C1).
- No JSON output or plugins in v0; keep the file small.

### B7 provenanceFields: Provenance fields made_by, by, date, ratified_by; unratified AI nodes are surfaced, not blocked (ai, unratified)

**Decision.** Every node carries `made_by` (`human`, `ai`, `joint`), `by` (free text naming the person or model), and `date`. AI and joint nodes may be `active` without a human's `ratified_by`, but validation lists every unratified one on every run until a human fills the field.

**Why.** A3 requires provenance to be captured at the moment of decision. Requiring ratification before a node can be active would block agents mid-task and push them toward not recording decisions at all, which is worse. Surfacing instead of blocking keeps the record honest and keeps the owner's review queue visible.

**Consequences.** - `dte validate` always ends with the unratified list.
- Ratification is a one-field edit by a human (SPEC section 7).

### B8 recordWhenDecided: AI agents record each non-trivial decision as a node at the time they make it (ai, unratified)

**Decision.** An AI agent working in a DTE repo must, for every non-trivial choice it makes, create a node with `made_by: ai`, set its parents, and cite it from the artifacts it produces, in the same change. It must run `dte validate` before declaring work done, and `dte blast` before altering any existing node.

A choice is non-trivial if a reviewer could reasonably ask "why?" and no existing node answers.

**Why.** A3 is unenforceable after the fact: an agent that makes a choice and moves on leaves no trace of the choice having existed. The only moment the decision is capturable is when it is made. A2 needs the same thing from the other direction: the tree only stays total if the entities creating artifacts are the ones citing them.

This protocol lives in `CLAUDE.md` so it is loaded into every agent session.

**Consequences.** - `CLAUDE.md` is an artifact of this decision and cites it.
- Agents allocate IDs with `dte next` and never hand-pick numbers.

### B9 orthogonalToGraphs: DTE cross-references structural graphs and does not model structural edges (ai, unratified)

**Decision.** DTE records decisions, lineage, precedence, and provenance. It does not record imports, calls, data flow, or ownership. Those belong to a structural method (graph engineering). The two share artifacts as their common vocabulary: an artifact carries citations for DTE and edges for the graph, and either side may name elements of the other in prose.

**Why.** A4 says DTE works alongside graph engineering rather than superseding it. The cleanest way to guarantee that is a hard boundary on what DTE models. A dependency edge and a decision citation answer different questions ("what does this touch?" versus "why is this here?") and conflating them would make both tools worse.

`confidence: medium` because the owner's exact meaning of "graph engineering" has not been discussed; this node is the AI's reading and should be checked.

**Consequences.** - No `depends_on` field on nodes.
- A future integration is a join on file path, nothing more.

### B10 parentsShallower: Every non-core node has parents, all strictly shallower; core nodes have none (ai, unratified)

**Decision.** A node in ring A has no parents. A node in any other ring has at least one parent, and every parent is in a strictly shallower ring than the node. A parent may be any number of rings up; it need not be the ring immediately inside.

**Why.** A2 needs every node to trace to the core, which forces at least one parent. A1 needs precedence to be a strict order, which forces parents to be strictly shallower: a node cannot outrank something it descends from. Allowing a parent several rings up keeps the tree honest when a detail descends straight from a core goal with nothing in between.

**Consequences.** - `dte validate` errors on parentless non-core nodes and on parents at the same or deeper ring.
- A move that would violate this must re-parent or move children first (SPEC section 7).

### B11 humanHeldProtected: Human-held nodes need authorized_by from a human to be superseded, reverted, or moved; configurable (ai, unratified)

**Decision.** A node is **human-held** if `made_by: human` or if `ratified_by` is set. A human-held node that has been superseded or reverted (a move supersedes) must carry `authorized_by:` naming a human, or validation fails. The check is on by default and can be turned off with `protect_human = off` in `dte.cfg`.

**Why.** AI must not override a human decision without express authorization. DTE's part is to supply the flags, since actual compliance depends on model behaviour and alignment; the switch exists because a project may not want the guard.

The rule is on the *retired* node rather than the superseding one because that is the single place every override path passes through: supersede, revert, and move all change the old node's status. A human doing the override themselves simply writes their own name. The tool cannot tell who edited a file; it can only make an unauthorised override fail loudly.

Ratification counts as holding because a human who confirmed an AI decision has adopted it; a later AI reversal is still an override of a human choice.

`confidence: medium` on the default-on choice and on treating ratified nodes as human-held.

**Consequences.** - `authorized_by` is a recognised frontmatter field.
- `dte validate --as <ring>` additionally flags *any* change to a human-held node file that lacks `authorized_by` (B15).
- In-place edits to a human-held node's text are not detectable without git; with git they are (C6).

### B12 dteCfg: Configuration is one dte.cfg file of key = value lines at the project root (ai, unratified)

**Decision.** All configuration lives in `dte.cfg` at the project root: one `key = value` per line, `#` comments. Recognised keys: `summaries` (A5), `protect_human` (B11), `authority` (B13), `retire` (B24), `links` (B30), `docs`, `specs`, `tests`, `agents` and `scan_self` (B37, C24), `broad_fraction` and `broad_min` (C8). Missing file or key means the default.

**Why.** Three decisions now need a switch or a table, and A4 forbids anything that needs a parser dependency. A flat key-value file is the simplest format that a person can edit without documentation and a hand-written parser cannot get wrong. One file rather than several keeps "what is configured" answerable at a glance.

**Consequences.** - `dte.cfg` is an artifact and cites the decisions whose switches it holds.
- New switches are added here, never as flags that must be remembered.

### B13 authorityMapAdvisory: The authority map is advisory; it tells agents whom to ask and never restricts a human (ai, unratified)

**Decision.** `dte.cfg` may hold `authority = A:human, B:orchestrator, C+:subagent` (any labels). The map answers "who holds this ring, so whom do I ask?". It binds agents: an agent must not place or alter nodes shallower than its own ring. It never binds humans, who may decide at any ring. If a ring is unmapped, the answer is "ask the human".

**Why.** A strict authority map is not crucial, and a human may make calls all the way down; authority on the human side is fluid. So the map is a flag, not a gate. It exists so that A6's "ask upward" has a concrete addressee, and so a spawning agent can hand a subagent its ring in one line.

**Consequences.** - `dte authority` prints the map and the holder of each ring.
- Escalation messages name the holder.
- A human-made node at any ring is always valid with respect to authority.

### B14 inbox: Unplaced decisions wait in decisions/inbox without an ID until someone with authority places them (ai, unratified)

**Decision.** A decision whose ring is unclear, or which belongs shallower than the agent's authority, is written to `decisions/inbox/<slug>.md` with a title, body, `made_by`, `by`, a `proposed_ring`, and `ask` (who should place it). It has no ID and cannot be cited. Every `validate` and `tree` run lists the inbox as PENDING PLACEMENT with the question to ask. `dte place <slug> <ring> --by <name>` allocates the ID, writes the node into the ring, and removes the inbox file.

**Why.** A6 says agents ask rather than decide above their ring. Asking needs a place to put the half-made decision so it is not lost in chat, and a prompt that keeps nagging until it is answered. Withholding the ID (B32) is what makes the inbox safe: nothing can cite or descend from a decision that has not been placed, so an unplaced decision has no blast radius.

**Consequences.** - Inbox files are the one kind of decision file that may be deleted, because placement moves them into the tree with full history.
- The slug becomes a History line, so the origin is traceable.

### B15 declareRing: Agents declare their ring with --as; validate checks changed nodes against ring and human-held rules (ai, unratified)

**Decision.** `dte validate --as <ring>` treats the caller as an agent holding that ring. Any changed node file shallower than the ring is an error naming the holder to escalate to. Any changed human-held node lacking `authorized_by` is an error. Without `--as`, neither check runs. Spawning agents put the ring in the subagent's instructions, and the subagent passes it to the tool.

**Why.** A6 needs a hook where the tool can actually see an agent step outside its ring. The set of changed files is that hook (C6). Making the flag opt-in keeps the tool usable by humans and by unmanaged sessions, consistent with B13's "advisory, not a gate" for people.

`confidence: medium`: an environment variable may prove more practical than a flag for spawned agents; both could be supported.

**Consequences.** - A changed node carrying `authorized_by` passes both checks: the human authorised the agent to act as scribe above its ring.
- CLAUDE.md tells agents to run validate with `--as` when they have been given a ring, and to assume ring B in this repo otherwise.

### B16 nameAndTitle: name is the handle and title the one-sentence description; validate warns past 100 characters (ai, unratified)

**Decision.** `name` is the camelCase handle A5 puts beside the ID in chat; `title` is the one-sentence description. Every tool output that names a node prints `ID name: title`. Validate warns when a title exceeds 100 characters or a name is not a camelCase identifier. With `summaries = off` in `dte.cfg` the tool prints bare IDs.

**Why.** A5 needs a handle per node and a description behind it, and a switch. Two fields, each measured on its own, stop the handle from swelling into a sentence and the description from shrinking into a label. 100 characters is roughly one sentence, long enough to carry a decision and short enough to sit beside the ID in a tool line.

**Consequences.** - Node authors write titles as statements of the decision, not topic labels, and names as the two-or-three-word noun a reviewer would say aloud.
- The `off` switch exists for users who have the tree open beside the chat.

### B17 reportNamesDecision: Reports of built work name the governing decision by ID and title in the same message (ai, unratified)

**Decision.** Whenever an agent tells a person that an artifact or feature now exists, the same message names the decision node that governs it, as ID plus title. A node created during the work is announced at the point the work is reported, not deferred to a closing list.

**Why.** An agent that reports "the inbox is built" without saying that B14 was created to govern it leaves the owner to ask which decision governs the inbox: the build is announced, its decision is not. A3 makes AI decisions visible in the tree; A5 makes them legible in chat. Neither is served if the person hears about the artifact and not the decision behind it, because the decision is exactly the part they may want to overrule. Announcing at the moment of reporting, rather than in a summary, keeps the two attached in the reader's mind.

**Consequences.** - CLAUDE.md protocol: every "I built X" is accompanied by "governed by ID title".
- The tool lists uncommitted node changes so the agent has the exact ID-plus-title lines to report (C7).

### B18 agentsEditClaudeMd: Agents may edit CLAUDE.md within their ring; the permission is a node so the owner can revoke it (ai, unratified)

**Decision.** An agent may edit CLAUDE.md, or any file that instructs agents, to add, change, or remove protocol, provided the change cites a node at the agent's ring or deeper. Changes that reflect a shallower node are made only after that node exists. This permission exists as a node precisely so that it can be switched off: the owner reverts or supersedes it, and from then on protocol edits are escalated.

**Why.** An agent that edits its own instructions needs a rule it has declared itself allowed by, so that switching the permission off is an edit to that rule and nothing else.

A6 gives agents authority within their ring; A3 makes AI-made rules visible. A permission that is never written down cannot be revoked cleanly. Writing it down as a node makes revocation a one-field edit with a computable blast radius (A1), which is the whole point of DTE.

**Consequences.** - CLAUDE.md cites this node in its "Permissions you hold" section.
- Reverting this node makes every future CLAUDE.md edit an inbox item.

### B19 privateMemory: Agents may keep private memory; any rule that governs project work is also a node (ai, unratified)

**Decision.** An agent may keep private memory (Claude Code memory files or equivalent) and update it freely. Memory is outside the tree and is not scanned. But a rule about how work in this project is done must also exist as a node; the memory entry then points to the node rather than being its only home. This permission is a node so that it can be revoked by editing it.

**Why.** Same principle as the CLAUDE.md permission: agent permissions are declared as nodes so they can be switched off in one place. The additional clause comes from A2: a project rule that lives only in an agent's memory ("ask in chat, not the dialog" was one) is invisible to the tree and to any other agent. Mirroring such rules into the tree keeps A2 honest without making per-agent, per-machine memory a project artifact, which would make coverage lie.

**Consequences.** - The owner's ask-in-chat instruction becomes a human-made node (B20).
- Memory entries that state project rules are rewritten as pointers.
- CLAUDE.md gains: memory is not a substitute for a node.

### B20 askInChat: Questions for the owner are asked in plain chat text, never through the question dialog (human-held)

**Decision.** When an agent needs the owner to decide something, it asks in ordinary chat text: the options, a recommendation, and then it stops. It does not use the structured question dialog.

**Why.** The owner does not want the structured question dialog. A6 makes asking upward a routine act, so the form of asking matters; A5 wants decisions legible in the chat itself, and the dialog takes them out of it.

### B21 scopeAdvisory: Scope checks are advisory: no reach, too much reach, skipped rings, and core-only code (ai, unratified)

**Decision.** `dte scope` reports four kinds of finding, all advisory and never errors: a non-core node nothing exists because of; a non-core node whose reach rivals a core node's; a node whose parent is more than one ring shallower; and code that cites the core directly. Thresholds and the list of describing-only documents live in `dte.cfg`. The hint attached to each finding is always one of DTE's own operations: split, promote, add the missing intermediate node, or cite something more specific.

**Why.** A decision that affects nothing may be dead weight, and a decision that affects everything may be badly worded or scoped; a C-level decision should mostly cite Bs, not As. A1 makes reach computable and makes moves the remedy for a node at the wrong ring; A2 makes "nothing exists because of it" a meaningful statement. None of this is certain to hold in practice, which is why every finding is a warning with a configurable threshold and never a gate.

There is no ring-balance check: not everything needs the same depth to be useful.

**Consequences.** - Describing documents (README, SPEC) do not count as reach; only implementing artifacts and descendants do (C8).

### B22 coverageIsReport: Coverage is a report, not a gate (ai, unratified)

**Decision.** `dte coverage` lists every scanned artifact with no citation and prints the percentage covered. Missing coverage never fails validation.

**Why.** A4 requires adoption into a live project. On day one in a large live project coverage will be near zero; failing validation on that would make the tool unusable there. Coverage as a visible number that only goes up is the adoption strategy: pick a subsystem, write its ring, cite it, watch the number move.

**Consequences.** - Structural errors (unknown IDs, orphans, bad parents) still fail validation; only *absence* of citations is tolerated.
- Teams may choose to gate on a coverage floor in CI; DTE does not.

### B24 retiredLedger: Retired nodes may be deleted; a ledger burns their numbers and git keeps their text; configurable (human-held)

**Decision.** A superseded or reverted node's file may be deleted. Every retirement is recorded in an append-only ledger, `decisions/RETIRED`, with the ID, date, what happened, the successor if any, who did it, and who authorized it. A retired number is never reissued. Git holds the retired text. The tool does the deletion, and `retire = keep` in `dte.cfg` turns deletion off so retired files stay with a status instead. Descendants of a retired node are orphans until re-parented, superseded, or reverted themselves.

**Why.** With tooling that can mechanically replace, re-cite, move and delete, there is no reason to keep old files around; keeping every retired file duplicates git and turns `decisions/` into an archive at the scale of a large adopting project. Deletion is configurable because a project may prefer the archive. Two things still have to survive a deletion. Numbers: IDs escape into chat, commits, and transcripts that no tool can rewrite, so a reissued number would make an old reference silently mean a different decision. Provenance: a deletion must remain a recorded act with a `by` and an `authorized_by`, or B11's protection of human-held nodes evaporates. The ledger carries both in one line per node. The orphan rule from B5 is kept unchanged: it is how A1 forces the blast radius to be walked.

**Consequences.** - `dte retire` and `dte move` write the ledger and delete the file in delete mode, or set `status` in keep mode (C11).
- A deleted node file with no ledger line is a validation error.
- `dte blast` lists a node's retired predecessors from the ledger with the git command that shows their text.
- Delete mode requires git; without it the tool behaves as keep and says so, because deletion without history is loss.

### B25 neverReask: An action a node justifies is done and reported with that node's ID and title, never re-asked (ai, unratified)

**Decision.** When an agent takes an action that an in-effect node justifies, its report states the action and the node as `ID "title"`, and nothing more. The agent does not ask whether the owner would prefer otherwise, does not offer to stop doing it, and does not re-explain the node. If no node justifies the action, the agent does not take it: it goes to the inbox.

**Why.** A7 makes autonomy the purpose of the tool, and A5 makes the ID-plus-title form the unit of communication. Together they say what a sufficient report looks like. The concrete case: writing `authorized_by: project owner` on a ring-A file when an owner decision forces a mechanical edit there is justified by B11 "human-held nodes need authorized_by from a human to be superseded, reverted, or moved; configurable", so the report says "B11" and moves on.

**Consequences.** - CLAUDE.md drops every "say the word and I'll change it" pattern from the agent's reports.
- The unratified list (B7) is where the owner's disagreement lands; the agent does not solicit it per action.

### B27 subagentBrief: A spawning agent briefs each subagent with a generated block: its ring, whom to ask, what binds it (ai, unratified)

**Decision.** `dte brief <ring> [--under ID]` prints the block a spawning agent puts at the top of a subagent's instructions: the ring it operates at, the environment variable to set, whom to ask for anything shallower, the in-effect decisions above its ring that bind it (all of them, or only those relevant to the subtree under `--under`), and the four rules it must follow. Spawning agents use it rather than writing the briefing by hand.

**Why.** A6 says agents decide within their ring and ask upward; that only works if each subagent is told its ring and shown the decisions it must not contradict. A7 says this must run unattended: a hand-written briefing drifts, omits a node, or names the wrong holder. Generating it from the tree makes the hierarchy of agents a projection of the hierarchy of decisions, which is the interface to graph engineering's agent structure that A4 asks for.

`confidence: medium` on the content of the block; a real multi-agent run on the first adopting project will show what a subagent actually needs.

**Consequences.** - CLAUDE.md tells orchestrators to hand every subagent `dte brief`.
- `--under` keeps the block short in a large tree by restricting binding nodes to the ancestors and shallower relatives of one subtree.

### B28 oneContest: A tree agent contests an unratified node once, before the first new work under it; then it stands (joint, unratified)

**Decision.** An unratified node is not a block, but before a tree agent first builds new work under it (a child node, a spec, an artifact) the agent runs one contest: it constructs the alternatives (keep, opposite, deletion, optionally a variant), builds each far enough to scope its cost, judges them against the node's parents alone, records the verdict on the node, and moves on. Parents are read as the rubric and never reopened; siblings are not touched; children and citing artifacts count for nothing, not even as cost. A contested node is settled: it is acted on without re-asking until a human ratifies it or an agent supersedes it. An import (B33) is not new work: a re-homed node owes its contest when something is first built under it, and a builder that works from a spec never contests, because it never sees the tree (B42).

**Why.** B7 surfaces unratified nodes instead of blocking on them, and asks agents not to treat them as truth. A model cannot ignore what is in its context, so the only way to stop an unratified node from acting as truth is to put its competitors beside it. Building and costing the alternatives does that, and it leaves the owner a comparison to ratify against rather than a bare proposal: at ratification time the choices and their estimated costs already exist. A7 forbids re-questioning, so the contest runs exactly once per node and its result is recorded; a second pass needs an explicit flag. Children are excluded because a better node may be simpler and need none of them; counting them would be sunk cost defending the incumbent. Known limitation, accepted: the judge is the model that wrote the node. The rubric being written down first makes the bias inspectable, not absent.

### B29 toolWritesFrontmatter: Frontmatter is written only by dte: invariant-bearing operations get commands, other fields use set (ai, unratified)

**Decision.** Frontmatter is written and changed only by the tool; agents never hand-edit it. Every operation that carries an invariant (allocating an ID, rewriting references, writing both sides of a contradiction, checking parent rings, flipping status, writing the ledger) and every question the paradigm poses is its own dte command. A frontmatter field that carries no invariant is changed through one guarded generic command, dte set, whitelisted to title and confidence. Provenance fields (made_by, by, date) are never edited after creation.

**Why.** B26, which this supersedes, satisfied A7 and A4, but read literally it produced one command and one C node per single-field edit; the first, retitle, cost sixty lines for a one-field write. The variant satisfies the same rubric with strictly less machinery: the invariants that justify a dedicated command are named, and everything else shares one guarded write that already carries the B11 human-held check and a History line. A7 is served the same way B26 served it: no hand edit, no typo, no stall. A4 is served slightly better, since the owner's ad hoc edits never wait for a new command. The whitelist keeps set from becoming a bypass of retire, ratify, or move.

### B30 obsidianVault: decisions/ is an Obsidian vault: wikilink link fields, quoted titles, tolerant of vault edits (ai, unratified)

**Decision.** The decisions directory opens directly as an Obsidian vault. A project may set links = wikilink so the tool writes link fields as quoted wikilinks (parents: ["[[A1]]"]) and citations as [[ID]]; the dte:ID token stays the default and both forms are always read. Titles and other free-text fields are written as double-quoted YAML. Frontmatter keys Obsidian owns (tags, cssclasses) are known; null and ~ read as empty; dot-directories under decisions/ are skipped. `aliases` is written by the tool as the node's name and nothing else (B32).

**Why.** A4 makes DTE something other repos adopt, and an adopter needs the tree browsable by its owner in Obsidian: lineage as graph-view edges and backlinks, properties as columns. Obsidian follows only [[ID]] links, rejects unquoted YAML titles holding a colon, and re-serialises frontmatter on any property edit (null for emptied fields, block lists). A1 needs precedence and blast radius unchanged by the syntax, so an ID is still the only identity and resolve() accepts nothing else. A5 asks for readable summaries; a vault view of ID plus title gives the human one without the CLI. Medium confidence: the shipped vault configuration (.obsidian, DTE.base) may not be the owner's final layout.

**Consequences.** - dte.cfg gains links = token | wikilink (C19). This repo sets wikilink.
- A .obsidian/ configuration and a DTE.base (Bases views: Outbox, Unratified, Contested, Inbox, All nodes) ship beside the tree; workspace.json is git-ignored as per-user state.
- Artifact citations in this repo's code and docs stay dte:ID tokens; Obsidian does not index them anyway and the tool reads both.
- [[ID]] in a node body is prose, not lineage; lineage is still the parents field.

### B31 outbox: The outbox is the human-to-agent channel: outbox notes, action tags, hand-typed ratified_by (ai, unratified)

**Decision.** A human tells agents what to do from inside the vault, without the CLI: a note dropped in decisions/outbox/, an action tag (ratify, retire, contest, ask) on a node in its tags property or inline, or a name typed into ratified_by. dte outbox lists every such item with the exact command; --done clears one; validate prints the count. A bare edit with no tag is not an outbox item.

**Why.** B14 gives agents a channel upward (the inbox) but a human had none downward except chat or the CLI. A6 puts the owner at ring A and A3 makes ratification a human act, so the one person who must ratify should be able to do it where they read, in Obsidian's Properties pane. A7 wants agents to work indefinitely without re-asking; a work list the tool prints at every validate means a human's ruling is never missed. Bare diffs are excluded because an anonymous edit cannot be told from an agent's own unfinished work, and validate already lists changed nodes (B17). Medium confidence: the owner has not ruled on the tag vocabulary.

**Consequences.** - A ratified_by typed by hand is accepted: validate no longer errors when the change that makes a node human-held is the ratification itself.
- A ratified_by with no matching History line is an outbox item until dte ratify records it.
- The tag vocabulary is fixed and flat: ratify, retire, contest, ask.
- The Outbox view in DTE.base shows the same list to the human.

### B32 nameHandle: Every node carries a camelCase name beside its title; the ID stays the only identity (ai, unratified)

**Decision.** Every node carries `name`, a camelCase identifier unique among in-effect nodes, beside `title`. The tool writes `aliases: [name]` so `[[name]]` resolves in Obsidian, and validate rejects any `aliases` that is not exactly the name. The ID stays the only identity: `resolve()` accepts nothing else, a citation the tool counts is always by ID, and a move still supersedes the old node with a new ID and rewrites every reference at once.

**Why.** A bare ID in a one-line comment or a chat line says nothing to a reader without the tree open, and the full title is too long to repeat. A handle bound to one node is not a second identity, which is what B23 forbade: aliases there kept an old ID resolving after a move, so the ID lied about precedence (A1). A name never resolves in the tool and never carries a ring, so it cannot lie about either; the uniqueness check keeps it total and injective while the node is in effect.

**Consequences.** - `dte new --name`, `dte set <ID> name`, `find` searches names, `tree` and every label print `ID name: title` (B16).
- A citation may read `dte:C17 shareImpl` or `[[C17]] shareImpl`; the name is for the reader and the tool ignores it.
- B23's move rule is carried over unchanged (C9, C11, C15).

### B33 importedNodes: An import re-homes an existing corpus with its properties unchanged; no contest is owed at import (ai, unratified)

**Decision.** `dte import` lifts an existing rule corpus into the tree, one markdown file per node. Every property the source carries (made_by, by, date, ratified_by, confidence, contested_by, authorized_by, tags) is written unchanged; nothing is added to the frontmatter. The import writes one History line, `imported from <source>`, and that line is the mark: an imported node owes its one contest (B28) before the first new work under it, not at import. Parents are resolved by id, by name, or by another file in the batch, and ids are allocated parent-first.

**Why.** Existing node properties are respected on import so adoption creates no chaos, and properties stay conservative so nodes remain human-manageable. A2 wants every decision recorded; a corpus that exists in prose is already decided and only needs a home. A3 wants provenance kept, so a source that says the owner ruled arrives human-held. A7 wants no re-questioning: lifting 150 rules is not acting under them, so demanding 60 contests whose alternatives were never on the table would be theatre. A History line rather than a field keeps the frontmatter as it was.

**Consequences.** - The unratified summary counts imported nodes separately and brief tells subagents what the mark means.
- An unknown property in a source file is an error, never silently dropped or carried.
- A carried ratified_by gets its History line so the outbox does not read it as a vault edit.

### B34 reconstructedIsAi: A reconstructed decision nobody remembers is made_by ai, low confidence, unratified (ai, unratified)

**Decision.** When an adopter writes a node for a decision nobody remembers making, it is `made_by: ai` with the inferring agent in `by`, `confidence: low`, and a History line naming the evidence. It becomes human-held only when a human ratifies it, like any AI node.

**Why.** Writing such a node as `made_by: human` locks, under B11, an agent's own guess against the agent that must keep refining it, and claims a human decided what nobody remembers. A3 asks that provenance say who actually made the node; the agent did. B7 already surfaces unratified AI nodes, which is exactly the review such a guess needs.

**Consequences.** - ADOPTING's Growing the tree section is corrected.
- A reconstruction the owner confirms is ratified, not re-authored.

### B35 refinementsAreChildren: A node that narrows or excepts another is its child; a same-ring contradiction means one is a child (ai, unratified)

**Decision.** Children refine, clarify, carve out and support their parents by construction: a child exists because of its parent. A designed exception to a rule is therefore a child of that rule, one ring down, not a sibling and not a sentence added to the rule. The same-ring contradiction error (B4) stands; it usually means a refinement was filed as a sibling, and the fix is to move it down.

**Why.** The shape of an A is built by looking at B, not by documenting every exception in A or even writing in A that exceptions exist. A `refines` link would be a new field whose only job is to suppress an error that position already answers, and B10 already makes the parent link carry the meaning. A1 needs precedence to follow position; an exception below its rule is exactly that.

**Consequences.** - No `refines` or `carves_out` field.
- SPEC section 6 says so beside R2.
- A carve-out of two same-ring rules is a child of both.

### B36 bodyEditsLogged: A hand edit to a node body carries a History line; validate flags body changes that lack one (ai, unratified)

**Decision.** Bodies are edited by hand, never by a command. Every such edit adds one History line. `validate` compares each changed node's body to HEAD, marks it `body changed` in the changed-nodes block, and warns when no new History line accompanies it.

**Why.** `set` logs title changes, but a reworded Decision leaves no trace, so a ratifier cannot see that a node changed after drafting. Detection is the right shape and the best way to catch stray accidental edits by human or agent. A3 wants who changed what to be visible; B29 keeps the tool out of prose; B17 already makes the changed-nodes block the thing an agent reports, so the mark lands where it is read.

**Consequences.** - No `reword` command.
- CLAUDE.md tells agents to add the line; the warning catches the ones who forget.

### B37 derivedLinks: A node stores nothing from below; specs, tests, agent files and docs are classified by glob (ai, unratified)

**Decision.** A node never lists the specs, files, tests or instructions that serve it. dte.cfg globs (`specs`, `tests`, `agents`, `docs`) classify citing artifacts, and `show` prints specified by, implemented by, enforced by, instructs and described by as derived lists. `coverage` reports in-effect nodes with no citing test. Docs do not count as reach; specs, tests, agent instructions and code do.

**Why.** Enforced-by lines written into nodes breach scope; the tree, specs and code stay cleanly separate; tests may cite DTE, but if a node shows test data it is autogenerated from citations and never relied on. Globs keep the real decision text clean. A2 wants everything to trace to a decision; A1 wants blast radius knowable, and a derived list cannot go stale. Process rules reach through the agent files that implement them, so they leave the no-reach list.

**Consequences.** - No `enforced_by` field and no MUST convention.
- A cited test is that node's enforcement; delete the test and the node is unenforced at the next run.

### B38 commentsMigrate: A WHY comment migrates to a node, a HOW comment to a spec; a WHAT comment stays in code (ai, unratified)

**Decision.** A comment that explains why a block exists is a decision's rationale in the wrong home: it moves into a node's Why and the comment collapses to a citation. A comment that explains how a block works beyond what the block literally does (design, mechanics, non-obvious flow) belongs to a spec, when the project keeps one, and the code cites the node the spec serves. A comment that says what the block is and is doing stays in the code. Citations are not additive decoration; migrating the prose is the point.

**Why.** HOW migrates, in some cases, to a spec; WHAT stays in code, saying what the block literally is and is doing; WHY goes to the tree. A2 wants every reason recorded in one place that can be found and reopened; a why-comment is a second copy that drifts and can silently contradict the node. A1 wants blast radius knowable, and a rationale that lives only in a comment is invisible to blast. A project that runs a comments-are-last-resort rule needs a third home for the WHY, and a citation is that home. Deciding which lines are rationale is judgment, so there is no --replace flag; scope --comments only points at candidates.

**Consequences.** - ADOPTING and CLAUDE.md state the three-way split.
- `dte scope --comments` lists comment-heavy files with no citation as migration candidates; a heuristic, never a validate error.

### B39 vendoredRules: An adopter vendors DTE's rule text verbatim and ignored; DTE's decisions are never nodes there (ai, unratified)

**Decision.** DTE's protocol reaches an adopting repo as a verbatim copy of DTE's own files (CLAUDE.md, SPEC.md, ADOPTING.md, README.md) plus one rendered file of DTE's in-effect decisions, all in a directory the adopter's scanner ignores. Each copy names the DTE commit it came from. The adopter's harness loads the copies; its agents never re-author the protocol in their own words, and its tree never holds a node for a DTE rule. The adopter's tree holds only the adopter's decisions.

**Why.** An agent told to put the protocol into its agent instructions rewrites it as prose and makes a node of its own for a DTE-usage rule; the intent is a copy of the real text, referenced, never duplicated. A4 makes DTE a package: a package's rules are the package's, with one home. A2 wants every decision recorded once; a second copy in another tree is a decision recorded twice and free to drift. Ignoring the directory matters because the copies cite DTE's IDs, which are not the adopter's. The commit stamp is how an adopter sees the copy is stale.

**Consequences.** - `dte vendor --from <DTE checkout>` does the copy, the render, the stamp and the ignore entry (C25).
- The decisions render is one file, so the adopter's vault does not fill with DTE's nodes.
- ADOPTING step 1 and init's next-steps say vendor, not copy.

### B40 originInWhy: A forcing incident is stated in the Why, never a field; a Why with none is thinner ice in a contest (ai, unratified)

**Decision.** When a concrete incident forced a decision, the Why says so in its first sentence. There is no origin or incident field. In a contest, a Why that names no incident is preventive judgment, and the judge weighs it as the thinner claim; the `contest` prompt says so.

**Why.** The Why is the right home. With AI-built code an incident is rarely fully understood unless it has been mapped through the tree, spec and code layers, so a field would assert a certainty the writer seldom has. A3 wants provenance honest, which a sentence in the Why is and a checkbox is not. A7 wants the contest to settle nodes, and telling the judge what thin ice looks like sharpens that without a new property. Properties stay conservative so nodes remain human-manageable (B33).

**Consequences.** - SPEC section 4 describes the Why this way.
- `dte contest` tells the judge to weigh an incident-free Why as preventive.
- Confidence low or medium remains the writer's own signal of taste.

### B41 presentGovernance: A node is present governance: History is one line per event; ratify drops the Contest section (ai, unratified)

**Decision.** A node body holds what stands, why, and what it makes true. The Why is reasoning only: no dates, no account of who said what when, no adoption story; history that muddles the logic is not in the Why, and history worth keeping is a History line. `## History` is one line per event (created, ratified, moved, reworded, contested) and nothing else. `## Contest` holds a contest's rubric, cases, costs and verdict; it exists to inform ratification, `dte ratify` deletes it once a human rules, and git keeps the text. `## Alternatives considered` is a terse list of the other ways it could have gone and stays. `contested_by` stays, since it is provenance. `validate` warns when a ratified node still carries a Contest section.

**Why.** Decision trees can have history but they cannot become a dev log; that is cluttered context. A2 wants the decision findable, which a body full of settled argument works against, and every agent that reads the node pays for the clutter in context. A3 wants provenance kept, which the History line and contested_by do; the alternatives themselves are argument, not provenance, and the commit that ratified holds them.

**Consequences.** - ratify writes one History line naming the drop.
- A contest record on an unratified node stays until ratification.
- SPEC section 4 describes History, Alternatives considered and Contest this way.

### B42 builderAutonomy: A builder works from the spec alone: no ring, no tree, no decisions (ai, unratified)

**Decision.** The layers exist so that building can be autonomous. An agent handed a spec builds to it precisely, cites the nodes the spec names, decides nothing and contests nothing; when the spec does not cover something it stops and reports the gap rather than improvising. Such a builder holds no ring and is not given the tree. Deciding belongs to humans and to agents that hold a ring and work on the tree or on a spec. These are modes of work, not fixed kinds of agent: the same agent may hold a ring in one session and build in another, and a project may run with no builder at all. What makes a builder is the absence of the tree.

**Why.** Spec separation exists to unlock agent autonomy. A builder that reads only the spec has no reason to question anything in it, because every decision the spec embodies was settled before the spec was written. Withholding the tree is what makes that autonomy safe: the builder cannot be tempted by an unratified node it happened to read, and there is nothing for it to re-ask (A7). Framing this as a permanent split into two kinds of agent would over-constrain a small project where one agent does both; the invariant is about what an agent has in front of it while building, not about roles.

**Consequences.** - `dte brief` gains a builder form: the spec, the citation rule, and how to report a gap; no binding nodes, no DTE_RING.
- B28 oneContest binds agents that hold a ring; a builder owes no contest because it never acts under a node, only under a spec.
- A spec gap is an inbox kind addressed to whoever holds the spec, distinct from a decision awaiting placement.
- CLAUDE.md is the protocol for an agent with the tree; a builder gets its own instruction block.

## Ring C

### C1 yamlSubset: Frontmatter is a restricted YAML subset parsed by hand (ai, unratified)

**Decision.** Node frontmatter supports exactly: `key: scalar`, `key: [a, b]`, `key:` with following `- item` lines, empty values, quoted strings, and trailing `#` comments. Nothing else. The tool parses this itself.

**Why.** B6 forbids dependencies, so PyYAML is out. B1 chose frontmatter for its readability. The intersection is a small subset that covers every field in the schema and is trivial to parse correctly. Supporting full YAML by hand would be a bug farm.

**Consequences.** - Nested maps and multi-line strings in frontmatter are rejected; put prose in the body.
- Any conforming port in another language has the same small job.

### C2 blastDefinition: Blast radius is descendants, citing artifacts, and formerly superseded nodes (ai, unratified)

**Decision.** `dte blast X` reports three sets: every node descending from X transitively, grouped by ring; every artifact line citing X or any descendant; and every node X supersedes, from the tree or from the ledger with the git command that shows its text.

**Why.** Descendants and citing artifacts are the direct reading of A1 through B3 (citations) and B10 (parents). The third set comes from B24: if X is reverted, the nodes it displaced are the obvious candidates to return, and a blast report that omitted them would understate the radius of a revert.

Grouping by ring makes the report readable as "which layers this touches", which is A1's own wording.

**Consequences.** - The report is the required pre-read before editing any node (B8).

### C3 scannerWalk: The scanner walks all text files, skipping .git, the decisions dir, binaries, and .dteignore globs (ai, unratified)

**Decision.** The scanner walks the project root and reads every file except: anything under `.git`, the decisions directory, files that look binary (a NUL byte in the first 8 KB), and paths matching a glob in `.dteignore`. A citation to an unknown ID is an error; a citation to a retired node is an error carrying the ledger's hint (C11).

**Why.** B3 made the token universal, so the scanner must be universal too: no file type allowlist, or a new language in an adopting project would silently drop out of coverage. Binary sniffing and an ignore file are the minimum needed to keep the walk fast and the coverage number honest. Unknown IDs are errors because a typo in a citation is a broken link in the tree.

**Consequences.** - `.dteignore` uses simple globs; no negation, no ordering.
- Generated or vendored directories should be listed there so coverage measures what the team actually authors.

### C5 proposedInEffect: Proposed nodes are provisionally in effect; their children get a warning (ai, unratified)

**Decision.** A node with `status: proposed` counts as in effect for precedence, blast radius, and parenting. Any in-effect node whose parent is proposed produces a validation warning, not an error.

**Why.** B7 lets AI nodes exist before ratification; the same reasoning applies to core goals the AI drafts from the owner's words (A2 to A4). Work has to be able to descend from a proposed goal or nothing could be built until every core node was ratified. The warning keeps the unratified foundation visible so it does not become permanent by neglect.

`confidence: medium`: the owner may prefer that nothing descends from a proposed core node at all.

### C6 changedFromGit: Changed files come from git status; without git, every node counts as changed and a warning says so (ai, unratified)

**Decision.** For `--as` checks the tool asks `git status --porcelain` for modified, staged, renamed, and untracked paths under the root. If git is unavailable or the root is not a repository, every node is treated as changed and a warning explains why the check is coarse.

**Why.** B15 needs "what did this agent touch". Git already knows, and B6 allows shelling out to a tool that is present on effectively every development machine without adding a dependency. Degrading to "everything changed" keeps the check conservative rather than silently absent.

**Consequences.** - The tool imports `subprocess` only for this path.
- Agents should commit or stash before starting so the changed set is theirs.

### C7 printChangedNodes: validate prints the uncommitted node changes as ID plus title so the agent can report them verbatim (ai, unratified)

**Decision.** When git is available, every `validate` run ends with a "Nodes changed in this working tree" block listing each added or modified node as `ID title`, plus any inbox items. The block is meant to be copied into the agent's report.

**Why.** B17 asks agents to name decisions when they report work. The failure mode is forgetting, not refusing, so the tool should put the exact lines in front of the agent at the moment it is about to say it is done. The changed-file set already exists for B15's authority check, so the cost is one more loop.

**Consequences.** - Without git the block is omitted; B15's coarse-mode warning already explains why.

### C8 reachDefinition: Reach is descendants plus implementing artifacts; broad means either share exceeds a threshold (ai, unratified)

**Decision.** For a node, reach is its transitive descendants plus the artifacts citing it or any descendant, excluding artifacts that match the `docs` globs in `dte.cfg`. Checks:

- **no reach**: non-core, in effect, zero descendants, zero implementing citations.
- **broad**: non-core, and either descendants divided by non-core nodes or implementing files divided by all artifacts is at least `broad_fraction` (default 0.3), with a count of at least `broad_min` (default 5).
- **skipped ring**: a parent more than one ring shallower.
- **core-only code**: an implementing artifact line citing a ring A node.

**Why.** B21 needs numbers. Descendants and citations are what the tool already tracks (B3). Excluding describing documents is what makes "no reach" honest: SPEC.md cites almost every node without anything existing because of it. Two separate shares, nodes and artifacts, because a decision can be broad in either dimension alone: B6 has few descendants but is cited by most files. The defaults are guesses to be calibrated on a real tree.

**Consequences.** - `docs` in this repo lists README, SPEC, and ADOPTING. CLAUDE.md is in the `agents` glob (C24): it is the implementation of the protocol nodes.
- `dte validate` ends with a one-line count when there are findings.

### C9 moveCommand: dte move writes the new node, supersedes the old, and rewrites citations and child parents (ai, unratified)

**Decision.** `dte move <ID> <ring> --by NAME [--parents A1,B2] [--authorized-by NAME]`:

1. Refuses if the node is not in effect, is already at that ring, or is human-held and `--authorized-by` is missing while protection is on.
2. Parents are `--parents` if given, else the old parents that are still strictly shallower than the new ring. Dropped parents are named in the output, because their blast radius just shrank.
3. Allocates the new ID, writes the new node with the old body, `supersedes: [OLD]`, no `ratified_by`, and a History line.
4. Retires the old node through the ledger (C11): the file is deleted in delete mode, or set to `superseded` in keep mode.
5. Rewrites `dte:OLD` to `dte:NEW` in every artifact, and `OLD` to `NEW` in every child's `parents`.

**Why.** B32 requires all of this to happen in one change, and by hand it will not: a promotion done by hand needs three files edited and a separate check that nothing was missed. The dropped-parents output answers the review finding that re-parenting silently changed B3's blast radius. `ratified_by` is cleared because moving changes precedence, which is a new decision even when the text is unchanged.

**Consequences.** - The tool imports nothing new; frontmatter lines are rewritten by key.
- Citations in files the scanner skips (binaries, `.dteignore`) are not rewritten and will show up as citations to a superseded node.

### C11 ledgerFormat: The ledger is decisions/RETIRED, tab-separated, append-only; deletion needs a ledger line (ai, unratified)

**Decision.** `decisions/RETIRED` holds one tab-separated line per retired node: `id, date, action (moved|superseded|reverted), successor or -, by, authorized_by or -, title`. Lines starting with `#` are comments. The tool reads it on every run: `next` skips ledger numbers; a citation, parent, or conflict naming a ledger ID is an error carrying the ledger's hint; `supersedes` may name a ledger ID.

With git: a node file that git reports deleted is an error unless the ledger has its line (in keep mode it is an error regardless, since keep mode retires by status); a renamed node file is always an error. For an uncommitted deletion, the tool reads the file at HEAD to apply the human-held and ring checks to the deleted node.

`dte retire <ID> --by NAME [--superseded-by NEW] [--authorized-by NAME]` refuses a human-held node without authorization, adds the ID to NEW's `supersedes`, rewrites citations and child parents to NEW and prints them for review, or without NEW prints the references that will now fail, then writes the ledger line and deletes the file (delete mode) or sets the status (keep mode). Delete mode without git degrades to keep with a warning.

**Why.** B24 needs the burned numbers and the provenance of each retirement to live somewhere small and diffable. One tab-separated line per node is the least that carries an ID, a date, an action, a successor, and two names. Reading HEAD for a deleted file is what lets B11 and B15 keep working when the file they would check is gone.

**Consequences.** - The tool has one more optional git call, `git show HEAD:<path>`.
- C10's "deleted is always an error" is superseded by this node.

### C12 exportJson: dte export emits one JSON document of nodes, citations, ledger, and inbox for a file-path join (ai, unratified)

**Decision.** `dte export [--out FILE]` writes one JSON object: `nodes` (every frontmatter field plus `ring` and `path`), `citations` (`file`, `line`, `id`), `retired` (the ledger rows), `inbox` (slug, title, proposed ring, ask, provenance), and the current `errors` and `warnings`. Keys are sorted; the document is stable across runs with no changes.

**Why.** B9 says DTE and a structural graph cross-reference on the artifact path and nothing else. This is that surface: a graph tool joins `citations.file` to its own file nodes and gets, per file, the decisions it serves, and per decision, the files it reaches. Nothing structural is modelled here (B9); the consumer does the join. JSON because every graph tool reads it and the standard library writes it (B6).

`confidence: medium`: the shape will change once a real consumer exists.

**Consequences.** - No JSON input; the tree's source of truth stays the markdown files.

### C13 initScaffold: dte init scaffolds decisions/ with inbox/, a commented dte.cfg, and .dteignore, never overwriting (ai, unratified)

**Decision.** `dte init` creates the decisions directory with its inbox, a `dte.cfg` whose every key is present and commented with its default, and a `.dteignore` with common vendored and generated paths. It refuses to overwrite anything that exists and prints the next steps: write the core with `dte new A`, and run `dte vendor` so the agent protocol is loaded from DTE's own text (B39).

**Why.** B29 wants day one to be commands, not file-writing; A4 wants it to take an hour in a live project. A fully commented config is the documentation a new adopter reads first (B12). Never overwriting is what makes `init` safe to run in a project that already has some of the files.

**Consequences.** - The scaffold has no ring A nodes; the core is the owner's to write.
- ADOPTING.md's day-one list starts with `dte init`.

### C14 citeAndHook: dte cite inserts a citation in the file's comment syntax; dte hook installs a pre-commit validate (ai, unratified)

**Decision.** `dte cite <file> <ID[,ID]>` inserts `dte:ID` at the top of the file in that file type's comment syntax: `#` for Python, shell, YAML, TOML and files without an extension; `//` for the C family, JavaScript, Go, Rust, Java and friends; `<!-- -->` for Markdown, HTML and XML; `/* */` for CSS; `--` for SQL and Lua. It goes after a shebang or after Markdown frontmatter. If the top comment already carries a `dte:` token, the new IDs are appended to it. Unknown IDs are refused with the ledger hint. JSON is refused because it has no comments.

`dte hook` writes `.git/hooks/pre-commit` running `dte validate`, and refuses if a hook already exists that does not mention dte.

**Why.** B22 makes coverage the adoption gauge; the way to raise it in a live project is one file at a time, and a mechanical citation is one an agent cannot get wrong (B29). The hook is the cheapest way to make validate a gate for teams that want one, without DTE itself gating anything.

**Consequences.** - Line-level citations are still written by hand; `cite` is file-level.
- `ratify` accepts several IDs, and `tree --under ID` prints a subtree, both for trees too large to read whole.
- `reparent <ID> --parents ... --by NAME` is how an orphan is fixed without hand-editing; it appends a History line.

### C15 nextAcrossBranches: next reserves every ID that exists on any branch git knows about, so parallel branches never collide (ai, unratified)

**Decision.** `next`, and therefore `new`, `place`, and `move`, take the maximum over node files and ledger lines in the working tree and on every local and remote-tracking branch git reports. A number minted on `develop` is not minted again on `main`, and vice versa, without anyone merging first.

**Why.** B24 says numbers are never reused and B32 that the ID is the only identity, so an ID collision at merge time has no cheap repair: one side must retire and recreate. Parallel branches make parallel minting the normal case. Asking git for the other branches costs one call per branch and closes the case for one repository. It does not cover two clones minting offline; that would need reserved ranges or a server, and is deferred until it happens.

**Consequences.** - Without git, behaviour is unchanged.
- Fetching before minting is what makes remote-tracking branches current.

### C17 contestCommand: dte contest prints the node, its parents as rubric and the alternative slots; --record writes it (ai, unratified)

**Decision.** `dte contest <ID>` refuses human-held or already-contested nodes (unless --again), then prints the node body, its parents labelled as the read-only rubric, the counts of children and citations that count for nothing, and the four slots keep, opposite, deletion, variant. `dte contest <ID> --record --chosen X --by NAME --note ... [--file F]` appends a dated block under Contest (B41), sets contested_by, writes a History line, and prints the next command when keep did not win. The tree, validate, and brief show contested state.

**Why.** B28 needs a command or agents would hand-edit frontmatter (B29). The brief form puts the rubric and the exclusions in front of the model at the moment it matters, which is the whole mechanism. The verdict lives in its own Contest section, which the ratifying human reads and ratify then drops (B41). contested_by is a frontmatter field so validate and tree can show it without parsing prose.

**Consequences.** - When a contested node loses and is superseded, `retire --superseded-by` carries its Contest section onto the successor, so the comparison survives delete-mode retirement and sits on the node the owner will ratify.

### C18 setCommand: dte set writes one whitelisted field (title, confidence), guards human-held nodes, logs History (ai, unratified)

**Decision.** `dte set <ID> <field> <value> --by NAME [--authorized-by HUMAN]` changes one of title or confidence. It normalises whitespace, warns when a title passes 100 characters (B16), rejects a confidence outside low, medium, high, refuses a human-held node without a human's name (B11), and appends the old value to History. Any other field is refused with the command that owns it. Supersedes C16, whose retitle was the title-only case.

**Why.** B29 names set as the one generic write and whitelists it. The refusal message for non-whitelisted fields points at the owning command so an agent that reaches for set to change status or parents is redirected rather than blocked silently, which is what A7 needs. The old value goes in History for the same reason C16 gave: the title is the citable summary (A5), and anyone who quoted the old wording needs a trail.

### C19 bothLinkForms: The tool reads dte:ID and [[ID]] everywhere; links in dte.cfg picks the written form; outbox command (ai, unratified)

**Decision.** CITE_RE (the token) and LINK_RE ([[ID]], [[ID|alias]]) are joined by cited_ids() wherever citations are read; _scalar unwraps a quoted wikilink in a link field to its ID. fm_id, fm_ids and cite_text write the form the links key selects; sub_citations rewrites either form on retire and move; cite appends to an existing wikilink line. fm_str double-quotes titles in new, place and set. dte outbox lists and clears outbox items; the scanner skips dot-directories and the outbox folder.

**Why.** B30 needs both forms read so a tree can switch without a migration, and the written form chosen per project; B3 keeps the token as the citation and B1 keeps one file per node, so the wikilink is only a spelling of the same ID. B12 puts the switch in dte.cfg. B31 needs a command that turns vault edits into a work list.

**Consequences.** - Tests pin quoted titles.

### C20 bodyFileAndImport: new --body-file takes the body verbatim; dte import lifts a folder of node files parent-first (ai, unratified)

**Decision.** `new --body-file FILE` uses the file's sections as the body (frontmatter stripped, Decision and Why required), beating the section flags. `dte import DIR --by WHO` reads every .md in DIR: frontmatter `ring`, `title`, optional `name` and `parents` (ids, names, or other files by name), any known node property; allocates ids in dependency order; writes the History line B33 requires; rolls back on the first error.

**Why.** B33 demands properties carried unchanged and a parent-first allocation; B29 demands the tool write every frontmatter. Shell quoting on Windows mangles multi-paragraph bodies passed as arguments.

**Consequences.** - Source files are left in place; the tool says to remove the folder when done.

### C21 authorizeCommand: dte authorize <ID> --by <human> records a go-ahead on an existing node with a History line (ai) (human-held)

**Decision.** `dte authorize` writes `authorized_by` on nodes that already exist and appends a History line with an optional note. It is the command that owns B11's field; `set` still refuses it.

**Why.** An owner who says go ahead after a node exists needs a way to be recorded, or `validate --as` fails on every ring-A draft the owner asked for. B29 puts each invariant-bearing field behind its own command.

**Consequences.** - ADOPTING's bootstrap: the agent drafts ring A as ai unratified, runs authorize with the owner's name, the owner ratifies later.

### C22 contestWritesWinner: retire carries contested_by to a contest winner; contest --record can write it and retire the loser (ai, unratified)

**Decision.** When `retire --superseded-by` carries a contest record into the successor, it also sets the successor's `contested_by` and logs it, so the node that was the contest's answer is settled. `contest --record` with a non-keep verdict and `--title` (plus a body) writes the winner at the same ring with the same parents, `contested_by` set, and retires the loser superseded by it; `--chosen deletion --retire` reverts in the same run.

**Why.** Without this, the winner of a contest is listed as uncontested and asked for a second contest. B28 says a contested node is settled; the settlement must travel with the text. The three-command gap between verdict, new and retire is where the bug lived.

### C23 validateSummary: validate prints counts by default; --full or dte unratified lists every unratified node (ai, unratified)

**Decision.** `validate` prints errors and warnings in full, then one line of counts for unratified (with contested and imported), the pending, outbox and scope counts, and the changed-nodes block. `validate --full` and `dte unratified` print the whole unratified list. The per-leaf no-children-no-citations warning is gone from validate; `scope` reports it as no reach.

**Why.** At 150 nodes a full list makes validate print 300 lines per run and the OK scrolls away; on day one every A node warns. B7 surfaces unratified nodes; a count surfaces them without filling an agent's context. B17 needs the changed-nodes block kept.

### C24 layerGlobs: specs, tests and agents globs classify citing artifacts; show groups them; scan_self for dogfooding (ai, unratified)

**Decision.** `layer_of(path)` checks the `tests`, `specs`, `agents` and `docs` globs in that order and falls back to code. `show` prints citing artifacts grouped by layer label; `coverage` lists in-effect non-core nodes with no citing test; `scope` counts every layer but docs as reach. The scanner skips the running tool file unless `scan_self = on`, which DTE's own repo sets, and `init` writes the tool's file name into .dteignore.

**Why.** B37 wants the layers derived; B12 puts the globs in dte.cfg. A vendored tool's own citations point at DTE's tree and fail validate right after init; skipping the running file fixes every adopter at once.

### C25 vendorCommand: dte vendor --from <DTE> copies the rule files and a DECISIONS.md render, stamped and ignored (ai, unratified)

**Decision.** `dte vendor --from <path to a DTE checkout> [--dir vendor/dte]` copies CLAUDE.md, SPEC.md, ADOPTING.md and README.md from the source into the directory, renders the source tree's in-effect nodes by ring into DECISIONS.md (ID name: title, Decision, Why, Consequences), prefixes each file with one comment naming the source commit and date and the refresh command, refreshes the running tool from the source's tools/dte.py when it is a different file, and adds the directory to .dteignore. Running it again refreshes everything.

**Why.** B39 wants the copy verbatim, stamped and ignored; four hand steps went wrong once and the ignore entry is the one people forget. B6 keeps it inside the single script. The render is one file so the adopter reads DTE's decisions without hosting them as nodes.

**Consequences.** - The source must be a checkout with decisions/ and the four files; anything else is an error.
- The tool copy overwrites the running file; Python has already loaded it, so the run completes.

### C26 specCommand: dte spec <ID> renders a spec skeleton from a node and its subtree for a tree agent to fill (ai, unratified)

**Decision.** `dte spec <ID> [--out FILE]` writes a spec skeleton: the citation of the node at the top, its Decision as the purpose, its parents' Decisions and its Consequences as constraints, every descendant's Decision as a covered decision, and empty Requirements, Out of scope and Gaps sections. A tree agent fills it; a builder reads it and nothing else.

**Why.** A8 puts the what in specs and demands each spec cite the node above it; a skeleton generated from the tree cannot forget the citation or the constraints, and the parts a tree agent must think about are the empty ones. B29 keeps generated structure in the tool. The skeleton is a start, never a spec: requirements are decisions about what to build and stay a tree agent's work.

**Consequences.** - The output lands in the `specs` glob so `show` lists it as specified by.
- A spec cites the node; the node never lists its specs (B37).

### C27 builderBrief: dte brief --builder <spec> briefs an agent that holds no ring; dte gap files a spec gap in the inbox (ai, unratified)

**Decision.** `dte brief --builder <spec>` prints the builder rules and the spec text: build exactly what the spec says, cite the IDs the spec names, decide nothing, never read decisions/, and when the spec is silent stop and file a gap. No binding nodes and no DTE_RING. `dte gap <spec> --title ... --by <who> [--note ...]` writes `decisions/inbox/gap-<slug>.md` with `kind: gap` and the spec path; `inbox` lists gaps apart from decisions awaiting placement, `place` refuses them, and validate errors when the spec is missing. A gap is resolved by whoever holds the spec, in the spec, and the file is then removed.

**Why.** B42 makes a builder an agent with no tree in front of it; B27 already makes brief the block an orchestrator hands a subagent, so the builder form belongs beside it. B14 gives agents one channel upward and a gap is that channel used for a spec instead of a decision: a builder that improvises has decided, which B42 forbids, so the only correct move is to report and stop.

**Consequences.** - A gap names the spec, not a ring, so the holder of the spec answers it.
- CLAUDE.md is the protocol for an agent with the tree; the builder block is the whole protocol for one without.

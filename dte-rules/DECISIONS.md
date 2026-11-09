<!-- vendored from DTE 0.2 (855a723) on 2026-10-31. Do not edit; refresh with: python tools/dte.py vendor --from <a DTE checkout> --dir dte-rules -->

# DTE decisions

Every in-effect decision of DTE itself, rendered. These are DTE's, not this
project's: read them, cite nothing here, and never re-create them as leaves.

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

**Decision.** Every decision leaf records its provenance: whether a human, an AI, or both made it, and specifically who. AI-made decisions are visible as such until a human ratifies them.

**Why.** Some decisions are now made by AI. In an AI-built project a large share of the tree will be authored by agents, often without a human noticing the choice was made at all. If provenance is not recorded at the moment of decision it is unrecoverable later, and the owner cannot tell which parts of the tree they actually chose.

This is a core goal rather than a format detail because it changes what the tree is *for*: not only "why does this exist" but "who is accountable for it".

**Consequences.** - Every leaf records its `date` and whether a human settled it; `made_by` says when a human made it, and its absence means an agent did. Who wrote it, specifically, is git's record.
- Tooling surfaces unratified AI decisions on every validation run.
- Agents working in a DTE repo are obliged to record decisions as they make them.

### A4 dteIsPackage: DTE is a package other repos and agents adopt, never a standalone project (joint) (human-held)

**Decision.** DTE is a package. It exists to be adopted by other repositories and the agents working in them: dropped into an existing, live project without a rewrite, and run alongside structural methods such as graph engineering rather than in place of them. This repository holds the package and its reference tool. It is not the product and it is not a standalone project.

**Why.** DTE works alongside, rather than supersedes, structural methods such as graph engineering, and it exists to be applied to other projects. The meta work in this repo is meant to finish and stay finished, after which DTE is something other repos and agents add to themselves. Any format or tool choice that only works here, or only in a greenfield repo, or that tries to absorb dependency tracking, violates this. Particular target projects are test beds and are not named in the package.

**Consequences.** - Plain-text files and a single-file, dependency-free tool, so DTE can be dropped into any stack.
- Incremental coverage rather than all-or-nothing validation.
- DTE models decisions and precedence only. Structural relationships stay in the structural tool, and the two cross-reference.
- There is a finish line: a stable package (tool, SPEC, adoption guide, agent protocol) that an agent can install into another repo in one step.
- Nothing in this repo refers to a specific adopting project.

### A5 idPlusName: A decision is always referred to by ID plus its camelCase name, never by bare ID (human-held)

**Decision.** Whenever a model refers to a decision in chat or in any output meant for a person, it gives the ID together with the leaf's camelCase `name`, for example A5 idPlusName. A bare "A4" is never sufficient, unless the user has configured summaries off. The tool prints `ID name: title` so both are easy to copy; the name is the chat form, the title is the description a reader opens when the name is not enough.

**Why.** DTE is an AI-workflow tool: most of the time a person reads a model's message, the decision file is not open. An ID alone forces a lookup or, more likely, is skimmed past. A short handle keeps the decision legible where it is discussed and is short enough to survive in a code comment; a full sentence was too long to repeat in every line of chat.

**Consequences.** - Every leaf carries a `name` (the handle) and a `title` (the one-sentence description).
- Every tool output that names a leaf prints `ID name: title`.
- Agent instructions forbid bare IDs in chat and use `ID name`; the title is quoted when the reader needs the sentence.
- A configuration switch may turn summaries off; the default is on.

### A6 authorityByRing: Authority follows ring; an agent decides within its ring and asks upward to place anything shallower (joint, unratified, contested)

**Decision.** Every agent operates at a ring. It may make decisions at its ring or deeper. Any decision that belongs shallower than its ring, and any decision whose ring is unclear, is not made by the agent: it is escalated to the agent that spawned it, or to the human, with the question "where does this belong?". The tool is built so that asking is the path of least resistance.

**Why.** A new goal can arrive at any time, and without a rule the agent has no structure that makes it ask where the goal belongs.

This is also the interface between DTE and an agent hierarchy of the kind graph engineering describes: a high-level model at a shallow ring directs subagents to decide only within their deeper rings and to hand anything above that back up. Precedence (A1) makes the ring order meaningful; provenance (A3) makes it visible who decided; A6 makes the ring order the allocation of decision rights.

Authority is fluid on the human side. The owner may decide at any ring, all the way down. The structure constrains agents, not people.

**Consequences.** - An unplaced decision has somewhere to live and a visible prompt to ask, the inbox.
- Agents can declare their ring to the tool and have their changes checked against it.
- An advisory authority map says who holds each ring, so an agent knows whom to ask.
- Overriding a human-held decision is a special case of acting above your authority and is protected separately.

### A7 autonomy: DTE exists so agents work autonomously and indefinitely, never re-questioning what a leaf justifies (human-held)

**Decision.** The tool exists to enable autonomous work, so that agents can continue indefinitely without questioning themselves. An action that an in-effect leaf justifies is taken and reported by naming that leaf, ID plus title. That report is all that needs to be said. Doubt is reserved for actions no leaf covers, and those go to the inbox.

**Why.** An agent that keeps flagging an action a leaf already justifies asks a question the tree has answered.

The tree is the standing answer to "may I?". Every ring below A exists to make that answer computable, and A6 already routes the genuinely open questions upward. An agent that re-asks what the tree has answered spends the owner's attention on nothing and stalls work that was meant to run unattended. The failure DTE guards against is the unrecorded decision, not the recorded one acted on.

**Consequences.** - Reports cite the justifying leaf and stop. No hedging, no "if you'd rather", no re-confirmation of a permission a leaf grants.
- The inbox is the only place an agent expresses doubt about authority, and only for actions no leaf covers.
- Ratification remains the owner's channel for disagreeing after the fact; it is not a gate the agent waits on.

### A8 threeLayers: DTE holds why, specs hold what, code holds how; layers cite upward and store nothing from below (ai, unratified, contested)

**Decision.** DTE organizes a project into three layers: decisions, specs and implementation. The decision tree holds why: goals, rules, choices and their provenance. Specs hold what: what to build, generated from the tree and citing the leaves they serve; a choice a spec forces (a dependency, a format) is recorded as a deeper leaf first. Code and tests hold how, and cite the leaves the spec told them to. A layer cites upward and never stores anything from below: a leaf never lists its tests, specs or files; those lists are derived from citations at read time.

**Why.** Writing "Enforced by: test" lines into leaves is a breach of scope: authored pointers downward go stale, and they pull test data into a document a human must keep readable. A test that cites the leaf is the same fact, kept where it can be checked. The same boundary answers the spec-tooling question: Spec Kit, Kiro and OpenSpec live in the middle layer, and DTE is the rationale layer under them, never a fourth spec format.

**Consequences.** - dte.cfg gains `specs` and `tests` globs beside `docs`; `show` prints "specified by", "implemented by" and "enforced by" as derived lists; `coverage` reports in-effect leaves with no citing test. No `enforced_by` field.
- `dte spec <ID>` emits a spec skeleton from a leaf and its subtree for a tree agent to fill.
- Reverting a leaf's blast radius includes its specs and everything built to them.

### A9 treeStructure: DTE provides a structure for a decision tree in other projects and also follows all its own rules (joint, unratified, contested)

**Decision.** A project's decisions form a branching tree. Ring A holds the core goals. Each ring outward holds decisions made because of the ring inside it, and every leaf has parents in a shallower ring. Position gives a decision its authority and its reach: the shallower ring wins a contradiction, and a change reaches everything below. DTE provides this structure to other projects, and this repository follows every rule it provides: its own decisions are a DTE tree kept with the same tool.

**Why.** The rules on parents, precedence, IDs and refinement all describe one shape. Stated nowhere, they read as unrelated conventions. Blast radius (A1) can only be computed because position is the structure, and authority by ring (A6) only means something if rings are ordered. A package that did not follow its own rules would have no evidence that they work.

**Consequences.** - Every change to DTE is made through DTE: a leaf first, then the tool, then the docs.

## Ring B

### B1 oneNodePerFile: One decision per markdown file with frontmatter, under decisions/<ring>/ (ai, unratified)

**Decision.** Each decision leaf is a markdown file with YAML frontmatter, stored at `decisions/<ring letter>/<ID>.md`. Frontmatter holds the machine-readable fields; the body holds Decision, Why, Consequences, and History.

**Why.** - A4 requires adoption in an existing project: plain markdown needs no runtime, diffs cleanly, and reads in any editor or in Obsidian.
- A2 requires the tree to be total and queryable: frontmatter gives tooling a stable schema without giving up prose for rationale.
- One file per leaf keeps git history per decision, which is itself part of the ring record.
- Ring directories make the tree legible in a file browser, ring by ring.

**Consequences.** - Tooling parses frontmatter; the body is for humans (see C1).
- File name equals ID; a move writes a new file and supersedes the old (specs/retiring.md).

### B3 citationToken: Artifacts cite decisions with a dte:ID token (ai, unratified)

**Decision.** Any artifact declares the decisions it exists to serve with the token `dte:ID` (or `dte:ID,ID`) in a comment or in prose. Citing a leaf implicitly cites its ancestry; cite the most specific leaf.

Examples in prose use the placeholder ring `ZZ` (`dte:ZZ1`, `[[ZZ1]]`); two letters is not an ID shape, so the scanner never counts it.

**Why.** A1 needs the radius to reach artifacts, not just other decisions, and A2 needs every artifact to have a lineage. The token has to work in every language and file type with no parser support, which rules out anything structured. A short grep-able prefix that sits inside any comment syntax is the lowest-friction option that still parses reliably.

`dte:` was chosen over `@dte` or `DTE(...)` because it has no meaning in any common comment or annotation system and cannot collide with decorators or doc tags.

**Consequences.** - The scanner is a regex over text files (specs/scanning.md).
- Coverage is measured as "files containing at least one token" (B22).
- Leaves themselves use `parents`, not tokens.

### B4 shallowerWins: Contradictions resolve to the shallower ring; same-ring contradictions are errors (ai, unratified)

**Decision.** When two in-effect leaves are declared as contradicting (`conflicts_with`), the leaf in the shallower ring takes precedence. Two contradicting leaves in the same ring are a validation error, resolved only by superseding one or moving one.

**Why.** Direct implementation of A1's second clause. The rule has to be mechanical so that a move has a predictable effect on every contradiction the leaf is party to. Same-ring contradictions are not tolerated because there is no position to appeal to; the tree would be silently inconsistent, which is exactly what A1 forbids.

Recency and authorship are deliberately not tie-breakers: precedence is position, nothing else.

**Consequences.** - `dte conflicts` prints every declared contradiction and its winner.
- Promotion or demotion is the way to change a winner.

### B6 singleScript: Tooling is a single dependency-free Python 3 script (ai, unratified)

**Decision.** The reference tool is one file, `tools/dte.py`, requiring only Python 3.8+ and the standard library. It can be copied into any project unchanged.

**Why.** A4 demands adoption into an existing project, so the tool must not bring a dependency tree, a build step, or a package manager with it. Python 3 is present on most developer machines; the standard library covers file walking, regex, and argument parsing, which is everything the tool needs.

Held with medium confidence because the language is a guess at the owner's preference. If an adopting project is a Node or other stack, a port is cheap because the tool is small and the spec, not the implementation, is normative.

**Consequences.** - No PyYAML: frontmatter parsing is a restricted subset (C1).
- No JSON output or plugins in v0; keep the file small.

### B8 recordWhenDecided: AI agents record each non-trivial choice as they make it: a leaf if it has stakes, else in its spec (ai, unratified)

**Decision.** An AI agent working in a DTE repo must record every non-trivial choice it makes, in the same change that makes it: as an AI leaf (one with no `made_by`) with its parents set and cited from the artifacts it produces when the choice is a call with stakes, otherwise in the spec the choice changes. It must run `dte validate` before declaring work done, and `dte blast` before altering any existing leaf.

A choice is non-trivial if a reviewer could reasonably ask "why?" and no existing leaf answers.

**Why.** A3 is unenforceable after the fact: an agent that makes a choice and moves on leaves no trace of the choice having existed. The only moment the decision is capturable is when it is made. A2 needs the same thing from the other direction: the tree only stays total if the entities creating artifacts are the ones citing them.

This protocol lives in `PROTOCOL.md`, which an adopter's harness loads into every agent session.

**Consequences.** - `PROTOCOL.md` is an artifact of this decision and cites it.
- Agents allocate IDs with `dte next` and never hand-pick numbers.

### B9 orthogonalToGraphs: DTE cross-references structural graphs and does not model structural edges (ai, unratified)

**Decision.** DTE records decisions, lineage, precedence, and provenance. It does not record imports, calls, data flow, or ownership. Those belong to a structural method (graph engineering). The two share artifacts as their common vocabulary: an artifact carries citations for DTE and edges for the graph, and either side may name elements of the other in prose.

**Why.** A4 says DTE works alongside graph engineering rather than superseding it. The cleanest way to guarantee that is a hard boundary on what DTE models. A dependency edge and a decision citation answer different questions ("what does this touch?" versus "why is this here?") and conflating them would make both tools worse.

Held with medium confidence because the owner's exact meaning of "graph engineering" has not been discussed; this leaf is the AI's reading and should be checked.

**Consequences.** - No `depends_on` field on leaves.
- A future integration is a join on file path, nothing more.

### B10 parentsShallower: Every non-core leaf has parents, all strictly shallower; core leaves have none (ai, unratified)

**Decision.** A leaf in ring A has no parents. A leaf in any other ring has at least one parent, and every parent is in a strictly shallower ring than the leaf. A parent may be any number of rings up; it need not be the ring immediately inside.

**Why.** A2 needs every leaf to trace to the core, which forces at least one parent. A1 needs precedence to be a strict order, which forces parents to be strictly shallower: a leaf cannot outrank something it descends from. Allowing a parent several rings up keeps the tree honest when a detail descends straight from a core goal with nothing in between.

**Consequences.** - `dte validate` errors on parentless non-core leaves and on parents at the same or deeper ring.
- A move that would violate this must re-parent or move children first (SPEC section 7).

### B11 humanHeldProtected: Human-held leaves need authorized_by from a human to be superseded, reverted, or moved; configurable (ai, unratified)

**Decision.** A leaf is **human-held** if `made_by: human` or if `ratified_by` is set. A human-held leaf that has been superseded or reverted (a move supersedes) must carry `authorized_by:` naming a human, or validation fails. The check is on by default and can be turned off with `protect_human = off` in `dte.cfg`.

**Why.** AI must not override a human decision without express authorization. DTE's part is to supply the flags, since actual compliance depends on model behaviour and alignment; the switch exists because a project may not want the guard.

The rule is on the *retired* leaf rather than the superseding one because that is the single place every override path passes through: supersede, revert, and move all change the old leaf's status. A human doing the override themselves simply writes their own name. The tool cannot tell who edited a file; it can only make an unauthorised override fail loudly.

Ratification counts as holding because a human who confirmed an AI decision has adopted it; a later AI reversal is still an override of a human choice.

Held with medium confidence on the default-on choice and on treating ratified leaves as human-held.

**Consequences.** - `authorized_by` is a recognised frontmatter field.
- `dte validate --as <ring>` additionally flags *any* change to a human-held leaf file that lacks `authorized_by` (B15).
- In-place edits to a human-held leaf's text are not detectable without git; with git they are (specs/scanning.md).

### B12 dteCfg: Configuration is one dte.cfg file of key = value lines at the project root (ai, unratified)

**Decision.** All configuration lives in `dte.cfg` at the project root: one `key = value` per line, `#` comments. Recognised keys: `summaries` (A5), `protect_human` (B11), `authority` (B13), `decisions`, `retire` (B24), `links` (B30), `must_test`, `docs`, `specs`, `tests`, `agents` and `scan_self` (B37), `broad_fraction` and `broad_min` (B21). Missing file or key means the default.

**Why.** Three decisions now need a switch or a table, and A4 forbids anything that needs a parser dependency. A flat key-value file is the simplest format that a person can edit without documentation and a hand-written parser cannot get wrong. One file rather than several keeps "what is configured" answerable at a glance.

**Consequences.** - `dte.cfg` is an artifact and cites the decisions whose switches it holds.
- New switches are added here, never as flags that must be remembered.

### B13 authorityMapAdvisory: The authority map is advisory; it tells agents whom to ask and never restricts a human (ai, unratified)

**Decision.** `dte.cfg` may hold `authority = A:human, B:orchestrator, C+:subagent` (any labels). The map answers "who holds this ring, so whom do I ask?". It binds agents: an agent must not place or alter leaves shallower than its own ring. It never binds humans, who may decide at any ring. If a ring is unmapped, the answer is "ask the human".

**Why.** A strict authority map is not crucial, and a human may make calls all the way down; authority on the human side is fluid. So the map is a flag, not a gate. It exists so that A6's "ask upward" has a concrete addressee, and so a spawning agent can hand a subagent its ring in one line.

**Consequences.** - `dte authority` prints the map and the holder of each ring.
- Escalation messages name the holder.
- A human-made leaf at any ring is always valid with respect to authority.

### B14 inbox: Unplaced decisions wait in decisions/inbox without an ID until someone with authority places them (ai, unratified)

**Decision.** A decision whose ring is unclear, or which belongs shallower than the agent's authority, is written to `decisions/inbox/<slug>.md` with a title, body, `made_by`, `by`, a `proposed_ring`, and `ask` (who should place it). It has no ID and cannot be cited. Every `validate` and `tree` run lists the inbox as PENDING PLACEMENT with the question to ask. `dte place <slug> <ring> --by <name>` allocates the ID, writes the leaf into the ring, and removes the inbox file.

**Why.** A6 says agents ask rather than decide above their ring. Asking needs a place to put the half-made decision so it is not lost in chat, and a prompt that keeps nagging until it is answered. Withholding the ID (B32) is what makes the inbox safe: nothing can cite or descend from a decision that has not been placed, so an unplaced decision has no blast radius.

**Consequences.** - Inbox files are the one kind of decision file that may be deleted, because placement moves them into the tree with full history.
- The slug becomes a History line, so the origin is traceable.

### B15 declareRing: Agents declare their ring with --as; validate checks changed leaves against it and human-held rules (ai, unratified)

**Decision.** `dte validate --as <ring>` treats the caller as an agent holding that ring. Any changed leaf file shallower than the ring is an error naming the holder to escalate to. Any changed human-held leaf lacking `authorized_by` is an error. Without `--as`, neither check runs. Spawning agents put the ring in the subagent's instructions, and the subagent passes it to the tool.

**Why.** A6 needs a hook where the tool can actually see an agent step outside its ring. The set of changed files is that hook (specs/scanning.md). Making the flag opt-in keeps the tool usable by humans and by unmanaged sessions, consistent with B13's "advisory, not a gate" for people.

Held with medium confidence: an environment variable may prove more practical than a flag for spawned agents; both could be supported.

**Consequences.** - A changed leaf carrying `authorized_by` passes both checks: the human authorised the agent to act as scribe above its ring.
- The protocol tells agents to run validate with `--as` at the ring they hold, and to ask the owner their ring when nobody said.

### B16 nameAndTitle: name is the handle and title the one-sentence description; validate warns past 100 characters (ai, unratified)

**Decision.** `name` is the camelCase handle A5 puts beside the ID in chat; `title` is the one-sentence description. Every tool output that names a leaf prints `ID name: title`. Validate warns when a title reaches 100 characters and fails a name that is not a camelCase identifier, printing the `dte set` that fixes it. With `summaries = off` in `dte.cfg` the tool prints bare IDs.

**Why.** A5 needs a handle per leaf and a description behind it, and a switch. Two fields, each measured on its own, stop the handle from swelling into a sentence and the description from shrinking into a label. 100 characters is roughly one sentence, long enough to carry a decision and short enough to sit beside the ID in a tool line.

**Consequences.** - Leaf authors write titles as statements of the decision, not topic labels, and names as the two-or-three-word noun a reviewer would say aloud.
- The `off` switch exists for users who have the tree open beside the chat.

### B17 reportNamesDecision: Reports of built work name the governing decision by ID and title in the same message (ai, unratified)

**Decision.** Whenever an agent tells a person that an artifact or feature now exists, the same message names the decision leaf that governs it, as ID plus title. A leaf created during the work is announced at the point the work is reported, not deferred to a closing list.

**Why.** An agent that reports "the inbox is built" without saying that B14 was created to govern it leaves the owner to ask which decision governs the inbox: the build is announced, its decision is not. A3 makes AI decisions visible in the tree; A5 makes them legible in chat. Neither is served if the person hears about the artifact and not the decision behind it, because the decision is exactly the part they may want to overrule. Announcing at the moment of reporting, rather than in a summary, keeps the two attached in the reader's mind.

**Consequences.** - The protocol: every "I built X" is accompanied by "governed by ID title".
- The tool lists uncommitted leaf changes so the agent has the exact ID-plus-title lines to report (specs/commands.md).

### B18 agentsEditClaudeMd: Agents may edit CLAUDE.md within their ring; the permission is a leaf so the owner can revoke it (ai, unratified)

**Decision.** An agent may edit CLAUDE.md, or any file that instructs agents, to add, change, or remove protocol, provided the change cites a leaf at the agent's ring or deeper. Changes that reflect a shallower leaf are made only after that leaf exists. This permission exists as a leaf precisely so that it can be switched off: the owner reverts or supersedes it, and from then on protocol edits are escalated.

**Why.** An agent that edits its own instructions needs a rule it has declared itself allowed by, so that switching the permission off is an edit to that rule and nothing else.

A6 gives agents authority within their ring; A3 makes AI-made rules visible. A permission that is never written down cannot be revoked cleanly. Writing it down as a leaf makes revocation a one-field edit with a computable blast radius (A1), which is the whole point of DTE.

**Consequences.** - PROTOCOL.md cites this leaf in its "Permissions you hold" section.
- Reverting this leaf makes every future CLAUDE.md edit an inbox item.

### B19 privateMemory: Agents may keep private memory; any rule that governs project work is also a leaf (ai, unratified)

**Decision.** An agent may keep private memory (Claude Code memory files or equivalent) and update it freely. Memory is outside the tree and is not scanned. But a rule about how work in this project is done must also exist as a leaf; the memory entry then points to the leaf rather than being its only home. This permission is a leaf so that it can be revoked by editing it.

**Why.** Same principle as the CLAUDE.md permission: agent permissions are declared as leaves so they can be switched off in one place. The additional clause comes from A2: a project rule that lives only in an agent's memory ("ask in chat, not the dialog" was one) is invisible to the tree and to any other agent. Mirroring such rules into the tree keeps A2 honest without making per-agent, per-machine memory a project artifact, which would make coverage lie.

**Consequences.** - The owner's ask-in-chat instruction becomes a human-made leaf (B20).
- Memory entries that state project rules are rewritten as pointers.
- The protocol gains: memory is not a substitute for a leaf.

### B20 askInChat: Questions for the owner are asked in plain chat text, never through the question dialog (human-held)

**Decision.** When an agent needs the owner to decide something, it asks in ordinary chat text: the options, a recommendation, and then it stops. It does not use the structured question dialog.

**Why.** The owner does not want the structured question dialog. A6 makes asking upward a routine act, so the form of asking matters; A5 wants decisions legible in the chat itself, and the dialog takes them out of it.

### B21 scopeAdvisory: Scope checks are advisory: no reach, too much reach, skipped rings, and core-only code (ai, unratified)

**Decision.** `dte scope` reports four kinds of finding, all advisory and never errors: a non-core leaf nothing exists because of; a non-core leaf whose reach rivals a core leaf's; a leaf whose parent is more than one ring shallower; and code that cites the core directly. Thresholds and the list of describing-only documents live in `dte.cfg`. The hint attached to each finding is always one of DTE's own operations: split, promote, add the missing intermediate leaf, or cite something more specific.

**Why.** A decision that affects nothing may be dead weight, and a decision that affects everything may be badly worded or scoped; a C-level decision should mostly cite Bs, not As. A1 makes reach computable and makes moves the remedy for a leaf at the wrong ring; A2 makes "nothing exists because of it" a meaningful statement. None of this is certain to hold in practice, which is why every finding is a warning with a configurable threshold and never a gate.

There is no ring-balance check: not everything needs the same depth to be useful.

**Consequences.** - Describing documents (README, SPEC) do not count as reach; only implementing artifacts and descendants do (specs/scanning.md).

### B22 coverageIsReport: Coverage is a report, not a gate (ai, unratified)

**Decision.** `dte coverage` lists every scanned artifact with no citation and prints the percentage covered. Missing coverage never fails validation.

**Why.** A4 requires adoption into a live project. On day one in a large live project coverage will be near zero; failing validation on that would make the tool unusable there. Coverage as a visible number that only goes up is the adoption strategy: pick a subsystem, write its ring, cite it, watch the number move.

**Consequences.** - Structural errors (unknown IDs, orphans, bad parents) still fail validation; only *absence* of citations is tolerated.
- Teams may choose to gate on a coverage floor in CI; DTE does not.

### B24 retiredLedger: Retired leaves may be deleted; a ledger burns their numbers and git keeps their text; configurable (human-held)

**Decision.** A superseded or reverted leaf's file may be deleted. Every retirement is recorded in an append-only ledger, `decisions/RETIRED`, with the ID, date, what happened, the successor if any, who did it, and who authorized it. A retired number is never reissued. Git holds the retired text. The tool does the deletion, and `retire = keep` in `dte.cfg` turns deletion off so retired files stay with a status instead. Descendants of a retired leaf are orphans until re-parented, superseded, or reverted themselves.

**Why.** With tooling that can mechanically replace, re-cite, move and delete, there is no reason to keep old files around; keeping every retired file duplicates git and turns `decisions/` into an archive at the scale of a large adopting project. Deletion is configurable because a project may prefer the archive. Two things still have to survive a deletion. Numbers: IDs escape into chat, commits, and transcripts that no tool can rewrite, so a reissued number would make an old reference silently mean a different decision. Provenance: a deletion must remain a recorded act with a `by` and an `authorized_by`, or B11's protection of human-held leaves evaporates. The ledger carries both in one line per leaf. The orphan rule from B5 is kept unchanged: it is how A1 forces the blast radius to be walked.

**Consequences.** - `dte retire` and `dte move` write the ledger and delete the file in delete mode, or set `status` in keep mode (specs/retiring.md).
- A deleted leaf file with no ledger line is a validation error.
- `dte blast` lists a leaf's retired predecessors from the ledger with the git command that shows their text.
- Delete mode requires git; without it the tool behaves as keep and says so, because deletion without history is loss.

### B25 neverReask: An action a leaf justifies is done and reported with that leaf's ID and title, never re-asked (ai, unratified)

**Decision.** When an agent takes an action that an in-effect leaf justifies, its report states the action and the leaf as `ID "title"`, and nothing more. The agent does not ask whether the owner would prefer otherwise, does not offer to stop doing it, and does not re-explain the leaf. If no leaf justifies the action, the agent does not take it: it goes to the inbox.

**Why.** A7 makes autonomy the purpose of the tool, and A5 makes the ID-plus-title form the unit of communication. Together they say what a sufficient report looks like. The concrete case: writing `authorized_by: project owner` on a ring-A file when an owner decision forces a mechanical edit there is justified by B11 "human-held leaves need authorized_by from a human to be superseded, reverted, or moved; configurable", so the report says "B11" and moves on.

**Consequences.** - The protocol drops every "say the word and I'll change it" pattern from the agent's reports.
- The unratified list (B7) is where the owner's disagreement lands; the agent does not solicit it per action.

### B27 subagentBrief: A spawning agent briefs each subagent with a generated block: its ring, whom to ask, what binds it (ai, unratified)

**Decision.** `dte brief <ring> [--under ID]` prints the block a spawning agent puts at the top of a subagent's instructions: the ring it operates at, the environment variable to set, whom to ask for anything shallower, the in-effect decisions above its ring that bind it (all of them, or only those relevant to the subtree under `--under`), and the four rules it must follow. Spawning agents use it rather than writing the briefing by hand.

**Why.** A6 says agents decide within their ring and ask upward; that only works if each subagent is told its ring and shown the decisions it must not contradict. A7 says this must run unattended: a hand-written briefing drifts, omits a leaf, or names the wrong holder. Generating it from the tree makes the hierarchy of agents a projection of the hierarchy of decisions, which is the interface to graph engineering's agent structure that A4 asks for.

Held with medium confidence on the content of the block; a real multi-agent run on the first adopting project will show what a subagent actually needs.

**Consequences.** - The protocol tells orchestrators to hand every subagent `dte brief`.
- `--under` keeps the block short in a large tree by restricting binding leaves to the ancestors and shallower relatives of one subtree.

### B29 toolWritesFrontmatter: Frontmatter is written only by dte: invariant-bearing operations get commands, other fields use set (ai, unratified)

**Decision.** Frontmatter is written and changed only by the tool; agents never hand-edit it. Every operation that carries an invariant (allocating an ID, rewriting references, writing both sides of a contradiction, checking parent rings, flipping status, writing the ledger) and every question the paradigm poses is its own dte command. A frontmatter field that carries no invariant is changed through one guarded generic command, dte set, whitelisted to title and confidence. Provenance fields (made_by, by, date) are never edited after creation.

**Why.** B26, which this supersedes, satisfied A7 and A4, but read literally it produced one command and one C leaf per single-field edit; the first, retitle, cost sixty lines for a one-field write. The variant satisfies the same rubric with strictly less machinery: the invariants that justify a dedicated command are named, and everything else shares one guarded write that already carries the B11 human-held check and a History line. A7 is served the same way B26 served it: no hand edit, no typo, no stall. A4 is served slightly better, since the owner's ad hoc edits never wait for a new command. The whitelist keeps set from becoming a bypass of retire, ratify, or move.

### B30 obsidianVault: decisions/ is an Obsidian vault: wikilink link fields, quoted titles, tolerant of vault edits (ai, unratified)

**Decision.** The decisions directory opens directly as an Obsidian vault. A project may set links = wikilink so the tool writes link fields as quoted wikilinks (parents: ["[[A1]]"]) and citations as [[ID]]; the dte:ID token stays the default and both forms are always read. Titles and other free-text fields are written as double-quoted YAML. Frontmatter keys Obsidian owns (tags, cssclasses) are known; null and ~ read as empty; dot-directories under decisions/ are skipped. `aliases` is written by the tool as the leaf's name and nothing else (B32).

**Why.** A4 makes DTE something other repos adopt, and an adopter needs the tree browsable by its owner in Obsidian: lineage as graph-view edges and backlinks, properties as columns. Obsidian follows only [[ID]] links, rejects unquoted YAML titles holding a colon, and re-serialises frontmatter on any property edit (null for emptied fields, block lists). A1 needs precedence and blast radius unchanged by the syntax, so an ID is still the only identity and resolve() accepts nothing else. A5 asks for readable summaries; a vault view of ID plus title gives the human one without the CLI. Medium confidence: the shipped vault configuration (.obsidian, DTE.base) may not be the owner's final layout.

**Consequences.** - dte.cfg gains links = token | wikilink (specs/scanning.md). This repo sets wikilink.
- A .obsidian/ configuration and a DTE.base (Bases views: Outbox, Unratified, Contested, Inbox, All leaves) ship beside the tree; workspace.json is git-ignored as per-user state.
- Artifact citations in this repo's code and docs stay dte:ID tokens; Obsidian does not index them anyway and the tool reads both.
- [[ID]] in a leaf body is prose, not lineage; lineage is still the parents field.

### B31 outbox: The outbox is the human-to-agent channel: outbox notes, action tags, hand-typed ratified_by (ai, unratified)

**Decision.** A human tells agents what to do from inside the vault, without the CLI: a note dropped in decisions/outbox/, an action tag (ratify, retire, contest, ask) on a leaf in its tags property or inline, or a name typed into ratified_by. dte outbox lists every such item with the exact command; --done clears one; validate prints the count. A bare edit with no tag is not an outbox item.

**Why.** B14 gives agents a channel upward (the inbox) but a human had none downward except chat or the CLI. A6 puts the owner at ring A and A3 makes ratification a human act, so the one person who must ratify should be able to do it where they read, in Obsidian's Properties pane. A7 wants agents to work indefinitely without re-asking; a work list the tool prints at every validate means a human's ruling is never missed. Bare diffs are excluded because an anonymous edit cannot be told from an agent's own unfinished work, and validate already lists changed leaves (B17). Medium confidence: the owner has not ruled on the tag vocabulary.

**Consequences.** - A ratified_by typed by hand is accepted: validate no longer errors when the change that makes a leaf human-held is the ratification itself.
- A ratified_by with no matching History line is an outbox item until dte ratify records it.
- The tag vocabulary is fixed and flat: ratify, retire, contest, ask.
- The Outbox view in DTE.base shows the same list to the human.

### B32 nameHandle: Every leaf carries a camelCase name beside its title; the ID stays the only identity (ai, unratified)

**Decision.** Every leaf carries a name, a camelCase identifier unique among in-effect leaves, beside `title`. The name is the leaf's one alias, `aliases: [name]`, so `[[name]]` resolves in Obsidian, and validate rejects a second alias. The ID stays the only identity: `resolve()` accepts nothing else, a citation the tool counts is always by ID, and a move still supersedes the old leaf with a new ID and rewrites every reference at once.

**Why.** A bare ID in a one-line comment or a chat line says nothing to a reader without the tree open, and the full title is too long to repeat. A handle bound to one leaf is not a second identity, which is what B23 forbade: aliases there kept an old ID resolving after a move, so the ID lied about precedence (A1). A name never resolves in the tool and never carries a ring, so it cannot lie about either; the uniqueness check keeps it total and injective while the leaf is in effect.

**Consequences.** - `dte new --name`, `dte set <ID> name`, `find` searches names, `tree` and every label print `ID name: title` (B16).
- A citation may read `dte:ZZ1 shareImpl` or `[[ZZ1]] shareImpl`; the name is for the reader and the tool ignores it.
- B23's move rule is carried over unchanged.

### B33 importedNodes: An import re-homes an existing corpus with its properties unchanged; no contest is owed at import (ai, unratified)

**Decision.** `dte import` lifts an existing rule corpus into the tree, one markdown file per leaf. Every property the source carries (made_by, by, date, ratified_by, contested_by, authorized_by, tags) is written unchanged; nothing is added to the frontmatter. The import writes one History line, `imported from <source>`, and that line is the mark: an imported leaf owes its one contest (B28) before the first new work under it, not at import. Parents are resolved by id, by name, or by another file in the batch, and ids are allocated parent-first.

**Why.** Existing leaf properties are respected on import so adoption creates no chaos, and properties stay conservative so leaves remain human-manageable. A2 wants every decision recorded; a corpus that exists in prose is already decided and only needs a home. A3 wants provenance kept, so a source that says the owner ruled arrives human-held. A7 wants no re-questioning: lifting 150 rules is not acting under them, so demanding 60 contests whose alternatives were never on the table would be theatre. A History line rather than a field keeps the frontmatter as it was.

**Consequences.** - The unratified summary counts imported leaves separately and brief tells subagents what the mark means.
- An unknown property in a source file is an error, never silently dropped or carried.
- A carried ratified_by gets its History line so the outbox does not read it as a vault edit.

### B34 reconstructedIsAi: A reconstructed decision nobody remembers is an unratified AI leaf whose Why says it is inferred (ai, unratified)

**Decision.** When an adopter writes a leaf for a decision nobody remembers making, it is an AI leaf (no `made_by`) with the inferring agent in `by`, a Why that says it is inferred and from what, and a History line naming the evidence. It becomes human-held only when a human ratifies it, like any AI leaf.

**Why.** Writing such a leaf as `made_by: human` locks, under B11, an agent's own guess against the agent that must keep refining it, and claims a human decided what nobody remembers. A3 asks that provenance say who actually made the leaf; the agent did. B7 already surfaces unratified AI leaves, which is exactly the review such a guess needs.

**Consequences.** - ADOPTING's Growing the tree section is corrected.
- A reconstruction the owner confirms is ratified, not re-authored.

### B35 refinementsAreChildren: A leaf that narrows or excepts another is its child; a same-ring contradiction means one is a child (ai, unratified)

**Decision.** Children refine, clarify, carve out and support their parents by construction: a child exists because of its parent. A designed exception to a rule is therefore a child of that rule, one ring down, not a sibling and not a sentence added to the rule. The same-ring contradiction error (B4) stands; it usually means a refinement was filed as a sibling, and the fix is to move it down. Each exception names the condition that would remove it, as a "Removed by:" line; an exception nothing could remove means the rule was written wrong. A settled rule may carry a "Reopen if:" line naming what would put it back in question.

**Why.** The shape of an A is built by looking at B, not by documenting every exception in A or even writing in A that exceptions exist. A `refines` link would be a new field whose only job is to suppress an error that position already answers, and B10 already makes the parent link carry the meaning. A1 needs precedence to follow position; an exception below its rule is exactly that.

**Consequences.** - No `refines` or `carves_out` field.
- SPEC section 6 says so beside R2.
- A carve-out of two same-ring rules is a child of both.

### B37 derivedLinks: A leaf stores nothing from below; specs, tests, agent files and docs are classified by glob (ai, unratified)

**Decision.** A leaf never lists the specs, files, tests or instructions that serve it. dte.cfg globs (`specs`, `tests`, `agents`, `docs`) classify citing artifacts, and `show` prints specified by, implemented by, enforced by, instructs and described by as derived lists. `coverage` reports in-effect leaves with no citing test. Docs do not count as reach; specs, tests, agent instructions and code do.

**Why.** Enforced-by lines written into leaves breach scope; the tree, specs and code stay cleanly separate; tests may cite DTE, but if a leaf shows test data it is autogenerated from citations and never relied on. Globs keep the real decision text clean. A2 wants everything to trace to a decision; A1 wants blast radius knowable, and a derived list cannot go stale. Process rules reach through the agent files that implement them, so they leave the no-reach list.

**Consequences.** - No `enforced_by` field and no MUST convention.
- A cited test is that leaf's enforcement; delete the test and the leaf is unenforced at the next run.

### B38 commentsMigrate: A WHY comment migrates to a leaf, a HOW comment to a spec; a WHAT comment stays in code (ai, unratified)

**Decision.** A comment that explains why a block exists is a decision's rationale in the wrong home: it moves into a leaf's Why and the comment collapses to a citation. A comment that explains how a block works beyond what the block literally does (design, mechanics, non-obvious flow) belongs to a spec, when the project keeps one, and the code cites the leaf the spec serves. A comment that says what the block is and is doing stays in the code. Citations are not additive decoration; migrating the prose is the point.

**Why.** HOW migrates, in some cases, to a spec; WHAT stays in code, saying what the block literally is and is doing; WHY goes to the tree. A2 wants every reason recorded in one place that can be found and reopened; a why-comment is a second copy that drifts and can silently contradict the leaf. A1 wants blast radius knowable, and a rationale that lives only in a comment is invisible to blast. A project that runs a comments-are-last-resort rule needs a third home for the WHY, and a citation is that home. Deciding which lines are rationale is judgment, so there is no --replace flag; scope --comments only points at candidates.

**Consequences.** - ADOPTING and PROTOCOL.md state the three-way split.
- `dte scope --comments` lists comment-heavy files with no citation as migration candidates; a heuristic, never a validate error.

### B39 vendoredRules: An adopter vendors DTE's rule text verbatim and ignored; DTE's decisions are never leaves there (ai, unratified)

**Decision.** DTE's protocol reaches an adopting repo as a verbatim copy of DTE's own files (PROTOCOL.md, SPEC.md, ADOPTING.md, README.md, WALKTHROUGH.md) plus one rendered file of DTE's in-effect decisions, all in a directory the adopter's scanner ignores. Each copy names the DTE commit it came from. The adopter's harness loads the copies; its agents never re-author the protocol in their own words, and its tree never holds a leaf for a DTE rule. The adopter's tree holds only the adopter's decisions.

**Why.** An agent told to put the protocol into its agent instructions rewrites it as prose and makes a leaf of its own for a DTE-usage rule; the intent is a copy of the real text, referenced, never duplicated. A4 makes DTE a package: a package's rules are the package's, with one home. A2 wants every decision recorded once; a second copy in another tree is a decision recorded twice and free to drift. Ignoring the directory matters because the copies cite DTE's IDs, which are not the adopter's. The commit stamp is how an adopter sees the copy is stale.

**Consequences.** - `dte vendor --from <DTE checkout>` does the copy, the render, the stamp and the ignore entry (specs/commands.md).
- The decisions render is one file, so the adopter's vault does not fill with DTE's leaves.
- ADOPTING step 1 and init's next-steps say vendor, not copy.

### B40 originInWhy: A forcing incident is stated in the Why, never a field; a Why with none is thinner ice in a contest (ai, unratified)

**Decision.** When a concrete incident forced a decision, the Why says so in its first sentence. There is no origin or incident field. In a contest, a Why that names no incident is preventive judgment, and the judge weighs it as the thinner claim; the `contest` prompt says so. A Why is the plain reason, one or two sentences a person would say out loud. It may lean on the parent (we want the parent, so we want this), and never runs uphill, piling up specifics to make the parent look right; the parent has its own Why.

**Why.** The Why is the right home. With AI-built code an incident is rarely fully understood unless it has been mapped through the tree, spec and code layers, so a field would assert a certainty the writer seldom has. A3 wants provenance honest, which a sentence in the Why is and a checkbox is not. A7 wants the contest to settle leaves, and telling the judge what thin ice looks like sharpens that without a new property. Properties stay conservative so leaves remain human-manageable (B33).

**Consequences.** - SPEC section 4 describes the Why this way.
- `dte contest` tells the judge to weigh an incident-free Why as preventive.
- Confidence low or medium remains the writer's own signal of taste.

### B42 builderAutonomy: A builder works from the spec alone: no ring, no tree, no decisions (ai, unratified)

**Decision.** The layers exist so that building can be autonomous. An agent handed a spec builds to it precisely, cites the leaves the spec names, decides nothing and contests nothing; when the spec does not cover something it stops and reports the gap rather than improvising. Such a builder holds no ring and is not given the tree. Deciding belongs to humans and to agents that hold a ring and work on the tree or on a spec. These are modes of work, not fixed kinds of agent: the same agent may hold a ring in one session and build in another, and a project may run with no builder at all. What makes a builder is the absence of the tree.

**Why.** Spec separation exists to unlock agent autonomy. A builder that reads only the spec has no reason to question anything in it, because every decision the spec embodies was settled before the spec was written. Withholding the tree is what makes that autonomy safe: the builder cannot be tempted by an unratified leaf it happened to read, and there is nothing for it to re-ask (A7). Framing this as a permanent split into two kinds of agent would over-constrain a small project where one agent does both; the invariant is about what an agent has in front of it while building, not about roles.

**Consequences.** - `dte brief` gains a builder form: the spec, the citation rule, and how to report a gap; no binding leaves, no DTE_RING.
- B28 oneContest binds agents that hold a ring; a builder owes no contest because it never acts under a leaf, only under a spec.
- A spec gap is an inbox kind addressed to whoever holds the spec, distinct from a decision awaiting placement.
- PROTOCOL.md is the protocol for an agent with the tree; a builder gets its own instruction block.

### B43 leanFrontmatter: Frontmatter holds only what no other record holds; succession lives in the ledger (ai, unratified)

**Decision.** A leaf's frontmatter holds its id, uuid, title, parents, date and ratification. `status` appears only when it is not `active`, `made_by` only when it is not `ai`, `conflicts_with` only when it lists something, and the name is the leaf's one alias. Succession is the ledger's fact: under `retire = delete` no leaf carries `supersedes` or `superseded_by`, and `confidence` is gone.

**Why.** A field that repeats another record is a second place the same fact can be wrong. The ledger already says what replaced what, ratification already says who settled a leaf, and git already holds every earlier state, so the frontmatter keeps only what nothing else says.

**Consequences.** - `dte upgrade` brings a 0.1 tree to this shape, frontmatter only.
- `blast` and `show` derive "formerly superseded" from the ledger.
- How sure an agent was belongs in the Why ("inferred from the code, nobody remembers"), not in a field.
- Under `retire = keep` a retired file still carries `status` and `superseded_by`, because there the file is the record.
- 2026-10-31 by dropped from the frontmatter list (B59); by Claude Opus 5.5 on the owner's word (new content over old).

### B44 specCovers: A spec's covers: glob scopes the files built to it, so a class-wide rule reaches its class (ai, unratified)

**Decision.** A spec may say `covers: <globs>` in a comment line near its top. Every file the globs match is built to that spec: it counts as cited through the spec, `show` lists it "via" the spec, and `blast` runs leaf, spec, then those files.

**Why.** A rule about a whole class of files (every component, every store) would otherwise need the same citation pasted into every member, which is noise that rots. The spec is where the class's rule already lives, so the spec is where its reach is declared.

**Consequences.** - Only a comment line counts, so a markdown heading that says "covers:" is not a scope.
- A covers glob that matches nothing is stale and fails `coverage --check`.
- A file still cites what is specific to it; a file with nothing specific needs no header.

### B45 coverageStore: Every artifact cites a leaf, is built to a spec that does, or is listed with why it needs none (ai, unratified)

**Decision.** Coverage counts an artifact as covered when it cites a leaf or is built to a spec that does. An artifact that cites nothing because no decision governs it is listed in `.dtecoverage` under a `why:` line saying so. Coverage reports three gauges, one per hop: artifacts to a leaf or spec, specs to a leaf, and MUSTs to a test.

**Why.** The tree is meant to be total, so 100% has to be reachable and has to mean something. A file that needs no decision is a claim, and writing the claim down with its reason is what lets the rest be expected to cite. One blended number hid which hop was thin.

**Consequences.** - A glob before any `why:` line is an error; a glob that matches nothing is stale.
- An excluded file is still scanned, and one that cites anyway counts.
- "Not swept yet" is not a reason.
- `coverage --check` exits 1 below 100% on the first two gauges, on a stale glob, or on an unlabeled `MUST`.

### B46 mustEnforced: A MUST is cited by the test that enforces it, or its Consequences say *Unenforced:* and why (ai, unratified)

**Decision.** A leaf that states a MUST is cited by the test that enforces it, or its Consequences carry an `*Unenforced:*` line saying why no test can. A bug fix ships with the check that would have caught it.

**Why.** Tests are the layer that enforces (A8), and a rule nothing checks is broken silently. A label keeps the debt visible where a reader of the rule will see it, instead of leaving the reader to assume the rule holds.

**Consequences.** - `validate` warns on a MUST that is neither tested nor labeled; `must_test = off` turns the warning off.
- The leaf never names its tests; the test cites the leaf.
- Whether a citing test truly enforces its MUST is a reviewer's call, not the tool's.
- Triage of the labeled debt is the adopter's process (B57).

### B47 leafIsACall: A leaf is a call a person could decide in plain words; how the code carries it out is spec (ai, unratified)

**Decision.** A leaf records a call a person could weigh and choose otherwise, written in the project's plain words. Anything that describes how the code carries a call out (call order, wrappers, file formats, internal names) is spec content, kept fluid with git as its record. The tripwire: a Decision names the call and its opposite, and a sentence that would still be true had the opposite been chosen belongs in the spec.

**Why.** The tree holds why and specs hold what (A8). Mechanics written as leaves bury the calls a person must ratify under detail nobody can weigh, and every refactor then edits governance.

**Consequences.** - `dte to-spec <ID> <spec>` moves a mechanics leaf's text into a spec and its citations to what it served.
- The protocol states this test where it introduces `dte new`, since an agent that reads only the protocol writes mechanics leaves.
- "Could someone reverse it and would something break" is not enough: a load order passes that and is still mechanics.

### B48 childIsFork: A leaf is one whole decision; a child decides a question its parent leaves open (ai, unratified)

**Decision.** Each leaf states one complete decision. Read alone, its Decision says what is chosen, fully enough that the owner could ratify or reject it without opening any child. A child records a different question that its parent leaves open, one that could be flipped while the parent stands. A leaf that finishes its parent (fills in what the parent's Decision gestures at, supplies its numbers or its list of cases, restates or details it, names one aspect of it) is not a child: it folds back into the parent, or becomes spec.

Two tests settle it. Hide the child: if the parent no longer says something whole, the child was finishing it, so fold. Flip the child: if the parent goes false or empty, the child was an aspect, so fold.

**Why.** The tree's shape is what makes blast radius and precedence computable (A9). An unfinished parent can't be ratified on its own, and a child that finishes it adds a leaf to every radius and a place for the parent's rule to be contradicted, without adding a decision anyone could take separately.

**Consequences.** - `dte fold <child>` moves the child's Decision and Consequences into the parent, its citations and children with them, and writes a `folded` ledger line.
- A parent that cites its children to complete itself fails validate already, since a leaf cites only up its lineage (B49).
- One leaf may govern several things when turning it off for one would break the others; those stay one leaf. A leaf holding two calls that could be flipped separately splits in two.
- Things that were ever reversed independently stay separate.

### B49 citesUpOnly: A leaf's body cites only up its lineage, never a deeper ring (ai, unratified)

**Decision.** A leaf's Decision, Why and Consequences cite only shallower rings. History may name anything, since it records what was true then.

**Why.** A leaf is weighed against its parents alone (A9, B28). A parent that leans on a decision made under it cannot be judged without its own children, and the order the rings give stops meaning anything.

**Consequences.** - `validate` fails a `[[ID]]` or `dte:ID` in a leaf's body (History and Contest excepted) whose ring is deeper than the leaf's own.
- What a parent implies for the rings below is stated in its own terms; the child says how it follows.

### B50 leafWord: A decision is called a leaf (ai, unratified)

**Decision.** DTE calls one recorded decision a leaf: the vocabulary, the tool's output and the rule text all say leaf. The files that cite leaves are artifacts.

**Why.** DTE is adopted into other projects (A4), and "node" collides with any product that has nodes of its own, so a sentence about the tree reads as one about the product. A leaf is unambiguous and fits the tree the rings already describe.

**Consequences.** - The tool prints "leaves", `export` writes a `leaves` key, and `DTE.base` lists "All leaves".
- Code, config, docs and tests are artifacts.

### B51 docsAreLeafOrSpec: Every document that describes how the system works is a leaf or a spec (ai, unratified)

**Decision.** A document that describes the system is either a leaf (a call and its reason) or a spec (what to build). An adopter's existing mechanics docs are its spec layer: declare them in the `specs` globs, one per subsystem. A rationale doc (an out-of-scope list, a list of deferrals) is a set of unlifted leaves.

**Why.** A description that is neither has no place in the tree's reach and drifts from the code without anything noticing (A2). Calling what an adopter already has by its layer costs nothing and gives each doc a home.

**Consequences.** - Exempt: proposals (they are inbox items), history (git), and reader on-ramps such as a glossary or a mental model.
- Re-homing text that already governs built code owes no contest (B28).

### B52 askYourRing: An agent asks the owner its ring; unanswered, it takes the shallowest ring that can still build (ai, unratified)

**Decision.** Before its first task that works under a leaf, a top-level agent asks the owner which ring it holds, unless someone already said. Until answered, and in a run nobody watches, it works at the shallowest ring that can still build, which the adopter names. Subagents are briefed one ring deeper than their spawner.

**Why.** Authority follows ring (A6), and a ring nobody declared cannot be checked. Assuming a ring is how an agent ends up editing above it without noticing.

**Consequences.** - `validate` warns when leaves changed with no ring declared (`--as` or `DTE_RING`); the owner sets `DTE_OWNER=1`.
- Which ring an unanswered agent takes is the adopter's to say, in its own instructions.

### B53 refusedEditStops: A refused tree edit stops the agent, which asks the owner and never routes around it (ai, unratified)

**Decision.** When an agent's environment (a harness hook, a permission layer) refuses an edit to governance, the agent stops that change and asks the owner for an authorization in chat that names the leaves. It never reaches the same result another way.

**Why.** A refusal is the owner's boundary showing up where the tree cannot see it (A6). Routing around it makes the edit look authorized when nobody authorized it, which is the provenance failure A3 exists to prevent.

**Consequences.** - The owner's in-chat word, naming the leaves, is the authorization; `dte authorize` records it on each leaf.

### B54 branchLocal: A specialized branch keeps its own subtree, rooted at a branch-local A leaf, that never merges out (ai, unratified)

**Decision.** A branch that changes the product for its own purpose (built on the newest of everything, say) keeps an A leaf saying how, with the B leaves and specs under it, all living only on that branch. The root carries `branch: <name>` and the subtree inherits it. Findings move to other branches as ported changes, never by merging the subtree.

**Why.** A specialized branch makes real decisions, so they belong in a tree (A9), but they bind only that branch. Marking the subtree lets the tree tell "lives elsewhere" from "deleted without a ledger line" (A1).

**Consequences.** - `validate` warns when a branch-local root sits on another branch, and does not count its departure from one as a deletion.
- `next` still reserves the subtree's ids everywhere, so a port never collides.

### B55 specProse: A spec cites what it serves first and states each rule plainly, one point per paragraph (ai, unratified)

**Decision.** A spec opens by citing what it serves. It states the rule, not who ruled or when; one paragraph carries one point; every sentence reads alone, naming its subject instead of "it" across sentences; and it never addresses the reader as "you".

**Why.** Specs are read by builders who hold no ring and never open the tree (A8, B42), often one paragraph at a time, so a sentence that leans on the one before it is a sentence a builder misreads.

**Consequences.** - History belongs to git, not to the spec.
- An adopter adds its own house style on top.

### B56 portableProtocol: The agent protocol ships clean of DTE-repo specifics, and vendor tells an adopter what changed (ai, unratified)

**Decision.** The agent protocol DTE ships (`PROTOCOL.md`) carries only what every DTE repo needs; DTE's own rings and conventions live in its `CLAUDE.md`. `vendor` copies the protocol, spec, adoption guide, walkthrough and a render of DTE's decisions, and prints the A and B leaves added or retired since the last stamp.

**Why.** DTE is adopted by other repos (A4). A protocol that carries this repo's rings or its Python conventions teaches an adopter's agents rules that are not theirs, and a refresh that says nothing leaves the adopter to diff rule text by hand.

**Consequences.** - The stamp names the copy's own refresh command and nothing about the source checkout.
- `ADOPTING.md` has a "when the rules change" sweep for an existing tree.

### B57 noProcess: DTE governs the tree and defines none of the process around it (ai, unratified)

**Decision.** DTE supplies the format, the tool and the rules for writing and changing leaves. It defines no triage, backlog, release routine, house voice, naming habit for specs, or doc routine; an adopter sets those up its own way, and may record them as its own leaves.

**Why.** A package that dictates process is one an existing project cannot drop in (A4). Every adopter already has habits around its work; DTE's job is the tree those habits point at.

**Consequences.** - Where a DTE rule touches process (labeling an unenforced `MUST`), DTE defines the label and stops.
- What each ring means beyond A is the adopter's map, as is which ring a subagent gets.

### B58 uuidIdentity: Every leaf carries a uuid that tells it apart when two branches mint the same id (ai, unratified)

**Decision.** Every leaf carries a time-ordered uuid (UUIDv7) beside its id. The id stays what people cite; the uuid says which leaf an id means when two branches minted the same number.

**Why.** An id collision across branches silently merges two decisions into one file and points each one's citations at the other's text, which breaks the blast radius (A1). A live repo has parallel branches and cloud clones that cannot see every ref (A4), so collisions happen.

**Consequences.** - `new`, `place` and `import` write one; `upgrade` backfills one stably from the leaf's date, id and title; `validate` requires one, unique.
- `dte renumber` gives a leaf a fresh id and keeps its uuid; `dte merge-ids <ref>` renumbers every leaf here whose id the ref gives to another.
- `new` warns when the remote has branches this clone has not fetched.

### B59 provenanceFields: Provenance is by, date and ratified_by on every leaf; made_by only when a human made it (ai, unratified, contested)

**Decision.** Every leaf records when it was made (`date`) and whether a human settled it (`ratified_by`). `made_by` is written only when a human, or a human with an agent, made the leaf; absent, it reads as `ai`. Who wrote it is git's record: the tool writes no `by`, and reads one an import carries. AI and joint leaves may be in effect without ratification, but validation surfaces every unratified one on every run until a human fills the field.

**Why.** A3 requires provenance captured at the moment of decision. Git already records who committed each leaf and with which agent, at that moment, so a `by` field is a second copy that can disagree; and since agents write most leaves, the common case should cost nothing to write and the human case should stand out. Requiring ratification before a leaf takes effect would block agents mid-task and push them toward not recording decisions at all, which is worse.

**Consequences.** - `dte validate` names the unratified leaves of rings A and B and counts the rest; `dte unratified` lists them all.
- Ratification is a one-field edit by a human, or `dte ratify`.

### B60 oneContest: One contest per unratified leaf before new work under it; re-homing owes none; then it stands (ai, unratified, contested)

**Decision.** An unratified leaf is not a block, but before a tree agent first builds new work under it (a child leaf, a spec, an artifact) the agent runs one contest: it constructs the alternatives (keep, opposite, deletion, optionally a variant), builds each far enough to scope its cost, judges them against the leaf's parents alone, records the verdict on the leaf, and moves on. Parents are read as the rubric and never reopened; siblings are not touched; children and citing artifacts count for nothing, not even as cost. A contested leaf is settled: it is acted on without re-asking until a human ratifies it or an agent supersedes it. Re-homing text that already governs built code is not new work and owes no contest: an import, a fold, a move of mechanics into a spec. A rewrite the owner directs settles the leaf as a contest would. A builder that works from a spec never contests, because it never sees the tree.

**Why.** B7 surfaces unratified leaves instead of blocking on them, and asks agents not to treat them as truth. A model cannot ignore what is in its context, so the only way to stop an unratified leaf from acting as truth is to put its competitors beside it. Building and costing the alternatives does that, and it leaves the owner a comparison to ratify against rather than a bare proposal. A7 forbids re-questioning, so the contest runs exactly once per leaf and its result is recorded; a second pass needs an explicit flag. Children are excluded because a better leaf may be simpler and need none of them; counting them would be sunk cost defending the incumbent. Text that already governs built code is a record of what was decided, not a new decision, and an owner who rewrote a leaf has already weighed it. Known limitation, accepted: the judge is the model that wrote the leaf; the rubric being written down first makes the bias inspectable, not absent.

**Consequences.** - `dte contest <ID>` prints the rubric and the slots; `--record` writes the verdict and, for a non-keep winner, the successor.
- An owner-directed rewrite is logged in History as the owner's; no Contest section is owed.

### B61 bodyEditsLogged: A hand edit to a body carries a History line, or a sweep's one line in the editorial log (ai, unratified, contested)

**Decision.** Bodies are edited by hand, never by a command. Every such edit adds a History line, or, when one wording-only sweep touches many leaves, one line in the editorial log (`decisions/EDITORIAL`) records the sweep and the body it left on each leaf. `validate` compares each changed leaf's body to HEAD, marks it `body changed` in the changed-leaves block, and warns unless a History line HEAD lacks is present or the editorial log vouches for that exact body.

**Why.** `set` logs title changes, but a reworded Decision leaves no trace, so a ratifier cannot see that a leaf changed after drafting. A3 wants who changed what to be visible, and detection catches stray edits by human or agent. A vocabulary sweep across a hundred leaves is one event, though, and the same History line on each one turns History into a dev log about wording instead of a record of the decision.

**Consequences.** - No `reword` command; `dte editorial --by <who> --note "..."` writes the sweep's line.
- A later edit to a swept leaf changes its body hash, so it warns again.
- A History reset (a ratification, a rewrite) counts as logged, since its new line is one HEAD lacks.

### B62 presentGovernance: A leaf is present governance; ratifying drops Contest and History, which git keeps (ai, unratified, contested)

**Decision.** A leaf body holds what stands, why, and what it makes true. The Why is reasoning only: no dates, no account of who said what when, no adoption story. `## History` is one line per event (created, ratified, moved, reworded, contested) and nothing else. `## Contest` holds a contest's rubric, cases, costs and verdict until ratification. Ratifying drops both: History restarts at the ratification line, and git keeps everything before it. The owner may then rewrite the body in their own voice. `## Alternatives considered` is a terse list of the other ways it could have gone and stays.

**Why.** A tree can have history but it cannot become a dev log; every agent that reads the leaf pays for the clutter in context, and a body full of settled argument hides the decision A2 wants findable. Before ratification the activity log helps the ratifier see what changed; after it, the ratified text is what stands and the record of getting there is git's.

**Consequences.** - `dte ratify` drops Contest and History and writes one History line naming the drop.
- `validate` warns when a ratified leaf still carries a Contest section.
- `contested_by` stays, since it is provenance.

### B63 leafHasStakes: A leaf is kept for a call with stakes; system descriptions and low-stakes choices are spec (ai, unratified)

**Decision.** A leaf records a call with stakes: a product call, or a technical call whose flip would change what the project's users get, cost real rework, or that the owner wants settled. A technical description of a system, and a technical choice an agent could flip without anyone outside the code noticing, go in a spec, even when a person could weigh them. The tripwire: would the owner want to be asked before this flips? If not, it is spec.

**Why.** Leaves are what the owner ratifies and what agents never re-question. Every low-stakes leaf spends the owner's attention and freezes something agents should keep free to change, and enough of them bury the calls that matter.

**Consequences.** - A non-trivial choice without stakes is still recorded, in the spec it changes; git keeps why it changed.
- The leaf's Why says what the stakes are; a Why that can name none is a sign the text belongs in a spec.

### B64 freezeIsLeaf: A part of a spec that must stay out of agents' hands becomes a leaf the spec cites (ai, unratified)

**Decision.** When a part of a spec has to stop being fluid (a format others depend on, a number the owner chose, a constraint learned the hard way), that part becomes a leaf, and the spec cites the leaf at that point instead of restating it. A spec has no other way to freeze text: no "do not change" notes, no locked sections.

**Why.** Agents change specs freely, and that is the point of a spec. Only a leaf carries ratification, protection from agents and a blast radius, so a freeze written anywhere else is a sentence the next agent can edit away.

**Consequences.** - Freezing is the owner's call. An agent that thinks part of a spec should be frozen proposes the leaf through the inbox.
- Once ratified, the leaf is human-held, so changing the frozen part needs the owner's authorization.
- Unfreezing is retiring the leaf and putting its text back in the spec.

## Ring C

### C1 yamlSubset: Frontmatter is a restricted YAML subset parsed by hand (ai, unratified)

**Decision.** Leaf frontmatter supports exactly: `key: scalar`, `key: [a, b]`, `key:` with following `- item` lines, empty values, quoted strings, and trailing `#` comments. Nothing else. The tool parses this itself.

**Why.** B6 forbids dependencies, so PyYAML is out. B1 chose frontmatter for its readability. The intersection is a small subset that covers every field in the schema and is trivial to parse correctly. Supporting full YAML by hand would be a bug farm.

**Consequences.** - Nested maps and multi-line strings in frontmatter are rejected; put prose in the body.
- Any conforming port in another language has the same small job.

### C2 blastDefinition: Blast radius is descendants, citing artifacts, and formerly superseded leaves (ai, unratified)

**Decision.** `dte blast X` reports three sets: every leaf descending from X transitively, grouped by ring; every artifact line citing X or any descendant; and every leaf X supersedes, from the tree or from the ledger with the git command that shows its text.

**Why.** Descendants and citing artifacts are the direct reading of A1 through B3 (citations) and B10 (parents). The third set comes from B24: if X is reverted, the leaves it displaced are the obvious candidates to return, and a blast report that omitted them would understate the radius of a revert.

Grouping by ring makes the report readable as "which layers this touches", which is A1's own wording.

**Consequences.** - The report is the required pre-read before editing any leaf (B8).

### C5 proposedInEffect: Proposed leaves are provisionally in effect; their children get a warning (ai, unratified)

**Decision.** A leaf with `status: proposed` counts as in effect for precedence, blast radius, and parenting. Any in-effect leaf whose parent is proposed produces a validation warning, not an error.

**Why.** B7 lets AI leaves exist before ratification; the same reasoning applies to core goals the AI drafts from the owner's words (A2 to A4). Work has to be able to descend from a proposed goal or nothing could be built until every core leaf was ratified. The warning keeps the unratified foundation visible so it does not become permanent by neglect.

Held with medium confidence: the owner may prefer that nothing descends from a proposed core leaf at all.

### C15 nextAcrossBranches: next reserves every ID that exists on any branch git knows about, so parallel branches never collide (ai, unratified)

**Decision.** `next`, and therefore `new`, `place`, and `move`, take the maximum over leaf files and ledger lines in the working tree and on every local and remote-tracking branch git reports. A number minted on `develop` is not minted again on `main`, and vice versa, without anyone merging first.

**Why.** B24 says numbers are never reused and B32 that the ID is the only identity, so an ID collision at merge time has no cheap repair: one side must retire and recreate. Parallel branches make parallel minting the normal case. Asking git for the other branches costs one call per branch and closes the case for one repository. It does not cover two clones minting offline; that would need reserved ranges or a server, and is deferred until it happens.

**Consequences.** - Without git, behaviour is unchanged.
- Fetching before minting is what makes remote-tracking branches current.

### C21 authorizeCommand: dte authorize <ID> --by <human> records a go-ahead on an existing leaf with a History line (ai) (human-held)

**Decision.** `dte authorize` writes `authorized_by` on leaves that already exist and appends a History line with an optional note. It is the command that owns B11's field; `set` still refuses it.

**Why.** An owner who says go ahead after a leaf exists needs a way to be recorded, or `validate --as` fails on every ring-A draft the owner asked for. B29 puts each invariant-bearing field behind its own command.

**Consequences.** - ADOPTING's bootstrap: the agent drafts ring A as ai unratified, runs authorize with the owner's name, the owner ratifies later.

### C23 validateSummary: validate prints counts by default; --full or dte unratified lists every unratified leaf (ai, unratified)

**Decision.** `validate` prints errors and warnings in full, then one line of counts for unratified (with contested and imported), then names each unratified leaf of rings A and B with how many leaves sit below it, since everything under them inherits an unsettled rule; then the pending, outbox and scope counts and the changed-leaves block. `validate --full` and `dte unratified` print the whole unratified list, shallowest ring first and widest first within a ring. The per-leaf no-children-no-citations warning is gone from validate; `scope` reports it as no reach.

**Why.** At 150 leaves a full list makes validate print 300 lines per run and the OK scrolls away; on day one every A leaf warns. B7 surfaces unratified leaves; a count surfaces them without filling an agent's context. B17 needs the changed-leaves block kept.

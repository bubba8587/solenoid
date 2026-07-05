# Strategy threads — the connective tissue

**VERDICT (author, 2026-07-03): ENTIRE DOC DISCARDED.** Author's words: "it's not
necessarily wrong, it's just barely right. we can discard it." This supersedes the
earlier per-thread #5 ruling (2026-07-02, "this thread IS the public positioning") —
that ruling no longer stands. None of the seven threads below are being adopted;
kept in the repo as a point-in-time record, not an active plan. See `docs/backlog.md`
for where the walk goes next.

Third in the series: [`v1.0-audit.md`](v1.0-audit.md) (fix what's broken) →
[`future-directions.md`](future-directions.md) (architecture bets) →
[`scope-features.md`](scope-features.md) (features, 3 rounds + the Alteryx demo).

This one is different in kind. Writing the other three kept surfacing ideas that are
neither bugs, nor architecture, nor features — they're **distribution, positioning, and
composition patterns** that fell out sideways. Threads, not plans. Each is grounded in
something that already exists in the repo, and most cost *positioning* rather than code.

---

## 1 — Seeds are the marketing department (and the demos that can't rot)

**What exists:** 20 seed documents in `src/graph/seedGraphs/`, loaded into the template
menu, and — the underappreciated part — **machine-checked in CI** (`seeds.test.ts`
verifies every node constructs, every cable lands on compatible sockets, groups contain
their members).

**The thread:** the Alteryx demo (scope-features appendix) isn't a one-off — it's an
instance of a *repeatable pattern*: **every competitor teardown, every vertical pitch,
every tutorial is just a seed plus a page of writing.** And because seeds are tested,
the demos *cannot silently rot* when the app changes — the suite fails instead. That's
a marketing asset with a property no marketing site has: it's CI-verified.

Play it forward: the seed gallery *is* the website. Each seed gets a short page — what
it shows, who it's for, the competitor it undercuts, a screenshot — and the "try it"
button is the web build loading that seed. New vertical pitch = new seed + new page.
The Alteryx one first; Crystal Ball, Mathcad, Stella follow as their enabling features
land (same appendix).

**Cost:** near zero code. It's a habit: every demo idea becomes a seed, every seed gets
a page.

---

## 2 — Packs are the business model wearing an architecture costume

**What exists:** `pack-architecture.md` — a fully designed lean-core-plus-optional-packs
split, with a "core toolkit" contract (canvas, engine, units, sockets, formula compiler,
save format) that packs build on and the core promises not to break. It never mentions
economics — it's framed purely as UX (don't show a new user 200 nodes).

**The thread:** that same design *is* a business model, already drawn. Free core + free
general packs (the UX story, unchanged) — and if Solenoid ever wants revenue, **paid
vertical packs** slot into the identical seam: an engineering pack (unit-heavy domain
formulas, scope-features #15), a finance/governance pack (#3 below), a decision pack
(#17). The core-toolkit contract doubles as the commercial boundary: what's promised-
stable to packs is exactly what a paying pack customer needs promised.

The point is not "monetize now" (one author, pre-alpha — maybe never). The point is
that **no new architecture is required to keep the option open**, and knowing this
should *raise the priority* of pinning the core-toolkit contract (the pack doc already
calls that "the real design work"). Cheap now, expensive to retrofit.

**Cost:** zero today. Just: treat the toolkit-contract work as strategic, not cosmetic.

---

## 3 — The governance vertical has regulatory teeth — and the timing is live

**What exists (in the docs):** the "trust triad" — golden tests (logic), expectation
nodes (data), snapshots + review sign-off + provenance (history) — spread across
future-directions and scope-features #6/#12/#14.

**The outside fact (validated 2026-07-02):** US banking regulators' model-risk guidance
(SR 11-7) *named spreadsheets specifically* — "user-developed applications, such as
spreadsheets … are particularly prone to model risk" — and requires documented
development, validation, governance, and controls for models. An entire vendor industry
(Apparity, CIMCON, Workscope…) exists solely to **wrap Excel in externally-bolted
controls** — inventories, change tracking, sign-off workflows — because Excel can't do
any of it natively. And in **April 2026 the regulators rescinded SR 11-7 and replaced it
with revised, more principles-based interagency guidance** — meaning every US bank's
model-risk team is re-evaluating its framework and tooling *right now*.

**The thread:** Solenoid's trust triad isn't just a nice philosophy — it maps almost
1:1 onto what that regime demands: documentation (the graph is self-documenting +
report projection), validation (golden tests + expectations, run headlessly in CI),
change control (snapshots + diff), sign-off (node-anchored review), lineage
(provenance). The pitch writes itself: **"the model inventory entry that validates
itself"** — versus paying a vendor to bolt those controls onto a format that fights
them. This upgrades scope-features #14/#6/#12 from "nice features" to "the spine of a
vertical where compliance *requires* the purchase."

**Cost:** the features themselves (already planned); the vertical is positioning +
one governance-flavored seed + a page mapping triad → guidance clauses.

---

## 4 — Linked graphs: fix the single most broken thing in Excel

**What doesn't exist (verified):** any way for one Solenoid document to reference
another. This is the one genuinely *new feature* in this doc — it surfaced from asking
"how do models compose across an organization?"

**The thread:** Excel's answer is linked workbooks — universally acknowledged as its
most fragile feature. Links break silently on a moved file, values go stale without
warning, `#REF!` archaeology consumes days. Yet people keep using them, because the
*need* is real: the FX-rates sheet SHOULD be maintained once, by treasury, and
referenced by everyone.

Solenoid has the exact parts to do this right, all already shipped or planned:
- a **typed contract** at the boundary (schema inference, Bet 3) — a reference
  declares what it expects; a mismatch is a loud error, not a stale number;
- **placeholder machinery** (shipped) — a missing/renamed reference degrades exactly
  like a missing node type already does: visible, inert, lossless, never silent;
- **snapshots** (#6) — pin a reference to "rates as of Q2 close" or track latest,
  explicitly;
- **provenance** (Bet 4) — "this number came from fx-rates.sol v12, cell X" for free.

"Linked workbooks that fail loudly instead of lying" is a feature Excel users will
recognize *instantly* — it's their scar tissue. Organizationally it's the step from
"my model" to "our models": a company's graphs become a composed system with real
interfaces, which is also the on-ramp to #2's org story and the governance vertical.

**Cost:** real feature work (a reference-node + resolution + the contract check), but
every hard sub-problem reuses an existing mechanism. Belongs on the scope-features
list as an honorary #20; recorded here because it emerged from the composition thread.

---

## 5 — The one-file identity: local-first as a position, not an accident

**RULING (author, 2026-07-02): this thread IS the public positioning — the Obsidian
pathway (file-over-app, plain text, git, longevity). We do NOT advertise AI anywhere;
AI fidelity flows naturally from the same properties and stays internal. Thread #7's
meta-story is filed, not told.**

**What exists:** a portable `.exe`, documents in local storage / plain JSON files,
no accounts, no server, no telemetry. Today that's just… how it happens to be built.

**The thread:** make it a stated identity, because the market is primed for it. SaaS
fatigue is real (subscription sprawl, tools dying and taking data with them, per-seat
pricing resentment — see the Alteryx teardown), and "data sovereignty" now shows up in
procurement checklists. Solenoid can say, truthfully and almost uniquely:

> **One file. Yours.** The model, its data, its tests, its review trail, its history —
> in a file on your disk, readable as text (Bet 2), runnable headlessly (scope #10),
> that will still open in twenty years. No account. No server. No subscription that
> dies and takes your work with it.

Every architecture bet strengthens this: the text projection makes the file
future-proof; headless makes it self-sufficient; snapshots make it self-historied.
It's also the honest counter-position to every VC-funded competitor in the "better
spreadsheet" space (they're all cloud/collab-first — that's their funding model
talking). Solenoid's constraint (one author, no infra) becomes its differentiation.

**Cost:** zero. It's words — README, site, the story told consistently.

---

## 6 — The trust badge: make the triad visible as one glyph

**The thread (small, unifying):** once tests/expectations/review/snapshots exist,
every document can wear a single health indicator — tests passing, expectations green,
reviewed-at-snapshot-N, provenance clean. One glyph in the title bar; expand for
detail. "CI-green" as a *shareable state for a model*: screenshot it into the deck,
require it before a sink node fires (scope #9), require it in the governance story
(#3). It's the trust triad compressed into something a non-user can see and want.

**Cost:** small UI once the underlying features land; listed so the pieces get built
with a common status interface in mind rather than as four unrelated checkmarks.

---

## 7 — The meta-story: the product is its own proof

**What exists:** this repo. Built by one person directing AI agents, with
machine-checked seeds, doc-reconciliation rules, invariant docs, adversarial audits —
`agent-coordination.md` is literally in the docs folder.

**The thread:** scope-features #19 bets that the future of trustworthy AI work is "the
AI proposes, the artifact is inspectable, the human owns it." **Solenoid's own
development is that pattern, applied to building Solenoid.** The audit that found the
P0s, the parity tests, the docs that get reconciled against code — that's the trust
machinery of the product, mirrored in its process. When the time comes to tell the #19
story publicly, the build log *is* the case study: "we know inspectable-AI-work scales,
because that's how this tool exists." Dogfooding as evidence. Keep the receipts
(dev-notes already are them).

**Cost:** zero now. A writeup someday.

---

## Reading the threads together

Order them by *when they matter*:

- **Now, free:** #5 (say the local-first identity out loud), #2 (treat the pack
  toolkit contract as strategic), #1 (adopt the seed-per-demo habit — starting with
  the Alteryx seed already specced).
- **With the near features:** #6 (badge — design the status interface alongside
  tests/expectations), #3 (governance seed + mapping page once snapshots/review
  exist; the regulatory-transition window is open now and vendors are slow).
- **The real new feature:** #4 (linked graphs) — promote onto the scope list when
  Bet 3 lands; it's the org-scale multiplier for everything else.
- **Someday:** #7 writes itself from the receipts.

One sentence for the whole doc: the feature rounds decided **what to build**; these
threads are how the same pieces become **reach** (seeds), **revenue-optionality**
(packs), **a defensible market** (governance, local-first), and **a story** (the
meta-proof) — mostly without writing new code.

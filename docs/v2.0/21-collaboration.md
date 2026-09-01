# Bundle 21 — Collaboration: accounts, cloud saves, multiplayer editing

**Source:** author order 2026-09-01 ("a surface to add to 2.0 plans"). **Verdict:** IN, by
order. **Score:** Strong as a product · Structural relevance (the first author word on
ground `../out-of-scope.md` — a DRAFT with no ARR — had inferred closed) · Very high
complexity · Structural blast radius.
**Written:** 2026-09-01, plan-only.

## Provenance, said plainly

`out-of-scope.md` test 3, §3 and §11 argued: a service is a company, not a feature; real-time
co-editing is free next door and contradicts local-first; hosted anything converts "your
file" into "our servers." That doc is a DRAFT and carries no ARR (rules `authorRuled`:
nothing outside `rules.md` is author-ruled), so those were the agent's inferences, not
rulings — the author's order is the first word on this ground, and the three sections plus
decisions R5 were rewritten to it on 2026-09-01. The arguments were not wrong; they were
costs. This bundle keeps them as design constraints:

1. **The file stays the product.** The cloud holds the same document the disk holds (the text
   form + sidecar, `SavedGraph` v-versioned); everything is exportable at any moment; nothing
   in the client requires the service to open, edit or compute a document.
2. **Local-first stays true.** Offline works; sync catches up; the autosave slots remain the
   client's truth (`documentStore`) with the cloud as a second, versioned home.
3. **Every hosted piece has an exit.** The sync relay is self-hostable; the document store is
   plain files behind an API; a user can leave with everything.
4. **The stages are each a coherent product.** The author can stop after any stage.

`noBackCompat` still flips at Stage 1 (`../2.0-plan.md` P1); the out-of-scope doc as a
whole still awaits its ratification as a DRAFT.

## What it costs (the list the author is choosing to carry)

A hosted service brings: **auth** (sign-in, password reset or OAuth, sessions), **storage**
(documents, versions, assets — images live beside the doc today, `imageAssets.ts`),
**privacy and law** (a privacy policy, terms, data deletion and export, data residency,
GDPR-class requests), **abuse** (shared documents that run Script or fetch — see § Trust),
**uptime and support** (an outage now blocks people; a bug report now comes from a stranger),
**billing** (eventually — the AI palette's per-account key is the natural first metered
thing), and **a release train** (clients in the wild on old versions — `../2.0-plan.md` P3).
None of these is engineering-hard; all of them are permanent. The plan's mitigations: a
managed backend for Stage 1–2 (auth + Postgres + storage + realtime as one dependency, e.g. a
Supabase-class service — candidates, not a pick), a single-purpose relay for Stage 3, and
the text form as the export/import format so deletion and portability are trivial.

## Stage 0 — Cloud saves via your own sync folder (no server; pullable into 1.4)

**What.** A document saved in a Dropbox / OneDrive / iCloud / Syncthing folder already
travels between machines. What is missing is (a) noticing the file changed underneath the
open document and (b) not clobbering a newer copy. Desktop only (`tauri-plugin-fs` watch).
**Do.** `fileSession.ts`: watch the bound path; on external change → if the open doc is
unmodified since its last save, reload silently (a notice: "Reloaded — changed on disk");
if modified, offer Keep mine / Take theirs / Save mine as a copy (`<name> (conflict).sol`).
On save, if the file's mtime moved since the last read, the same offer before writing.
Compare by the text form (byte-stable), so a no-op round-trip never reads as a conflict.
**Tests.** The conflict decision is a pure function over (lastReadMtime, currentMtime,
dirty) — unit-test it; the watcher is a thin desktop shell.
**Why first.** Zero service cost, most of "my documents on my two machines," and it forces
the conflict-copy UX that Stage 2 reuses.

## Stage 1 — Accounts + cloud library

**Identity.** Sign-in (OAuth with GitHub/Google via the managed provider; email magic link
as the fallback). The account is OPTIONAL: signed-out Solenoid is exactly today's app. The
account holds: display name (feeds `commentAuthorStore` and `SavedGraph.meta.author`),
the AI palette key (replacing the device-local `apiKeyStore` entry — the "OAuth-style
connect" the AI deferral wanted), and the cloud library.
**Cloud library.** A document list (name, updatedAt, owner, shared-with) beside the local
library in the doc switcher; open = download the text form + sidecar + assets and adopt as a
local doc bound to a cloud id (the `filePath` slot gains a `cloudId` sibling in `SolDoc`);
save = upload a new VERSION (append-only; the server keeps the version list). Autosave keeps
working locally; cloud save is explicit or on a debounce the user chooses (Settings).
**Versions (P5).** Every upload is a version; a Version panel lists them, restores one (as a
new version, never a rewrite), and diffs any two through `textDiff.ts` (the AI apply-approval
view already renders the exact thing). This is the deferred snapshots idea (#6) in its home.
**Sharing.** A share link with a role: viewer (open read-only; compute locally), commenter
(viewer + comments), editor (full). Roles are enforced server-side on upload; the client
hides what it may not do (`canvasLock` is the read-only precedent).
**Assets.** Images and bundled files ride with the version (a small object store keyed by
content hash — `imageAssets.ts` already writes content beside the doc).
**Save format.** Requires `../2.0-plan.md` P1 (the freeze + migration seam): the server stores
`v`; an older client opening a newer version gets read-only + an update prompt (P3).
**Web.** The web build can sign in and open cloud documents — it is the sharing surface (a
link that opens in a browser). Compute runs on the JS oracle (P4 option (b)); heavy documents
say so.

## Stage 2 — Asynchronous collaboration (the posture out-of-scope §3 always allowed)

- **Comments with identity**: the shipped node-anchored comments (`commentStore.ts`, sidecar-
  carried) gain the account's id + avatar; replies; resolve. Comments stay IN the document
  (they are part of the version), so they work offline and export with it.
- **Presence-lite**: who has the document open (a heartbeat to the service), shown in the top
  bar; no cursors yet.
- **Conflicts**: last-writer-wins at the version level, with the Stage 0 conflict copy when
  two editors upload from the same base (the server knows the base version of every upload;
  a non-linear upload becomes a branch version the client offers to merge by hand through the
  diff view). Honest, and enough for turn-taking teams.
- **Review**: a "sign-off" mark on a version (who approved which version) — scope-features
  #14's second half, cheap once versions exist.

## Stage 3 — Real-time multiplayer editing

**The model.** The addressable model is the reason this is tractable (future-directions
warned: "multiplayer before Bet 2 exists is misery; on a clean addressable model it's
tractable" — Bet 2 shipped). The shared document is a CRDT (Yjs-class; Automerge is the
alternative) shaped like the text form's semantics, not its bytes:
- `nodes`: a map keyed by NAME → { type, init fields, literals, stringLiterals } (each field
  a last-writer-wins register; `init` is JSON-plain by rules plainJsonInit, so it serializes).
- `connections`: a map keyed by `target/targetInput` (one cable per input — the key IS the
  invariant) → { source, sourceOutput }.
- `visual`: positions / sizes / collapsed / page per node (LWW registers; positions are the
  hot path and merge trivially), plus the sidecar's other fields.
- Composite internals: a nested sub-document per composite instance.
**The client.** The rete editor + RF surface become a VIEW of the CRDT document: every local
edit goes through the existing choke points (`flowModel.ts` edit verbs, `useDraftCommit`
commits, `moveNode`) which write the CRDT; remote CRDT changes apply through the same verbs
(the topology pipe already coalesces adds/removes into one commit; `syncTopology` preserves
identity). The engine recomputes locally on every applied change — **every client computes**;
purity makes results agree. The documented exceptions: volatile nodes (RAND — per-client
rolls; a `seed` shared through the doc if agreement matters) and live connections (each
client fetches; `fetchedAt` may differ). No server compute in v1.
**Names under concurrency.** Two clients renaming to the same name, or both creating
`Filter_2`: the CRDT keeps both entries; the client's uniqueness validator resolves the loser
by suffix on apply and surfaces a notice. Name changes rewrite references (already true of a
rename today); do it as one transaction.
**Undo.** Per-user (Yjs `UndoManager` tracks origins) — the snapshot history (`flowHistory`)
becomes a local view; the CRDT is the truth. Composite drill-in undo the same.
**Awareness.** Cursors, selections, viewports (follow a person), active page (Bundle 20);
node-level "being edited by" on the card (a badge state — 1.4's A0 vocabulary gains one).
**Transport.** A WebSocket relay (Hocuspocus / y-sweet / PartyKit-class; self-hostable), auth
by the Stage 1 token, one room per document; persistence of the CRDT state on the server
plus a periodic text-form snapshot as a version (so Stage 1's versions and diffs keep working
under multiplayer).
**Desktop and web.** Both are clients; the desktop computes on Polars, the web on the JS
oracle — same answers by corpus. An AI agent (the palette, or an external tool) is just
another client — which is the #35 MCP port's live-session gap, closed for free.

## Trust on open (P2) — required before Stage 1 ships a share link

Opening someone else's document is the new threat model. Today: sources fetch on load (Web
Source, Data Feed, CSV, the 1.4 widget nodes — with the desktop's CORS-free curl UA),
Script runs on compute in a worker whose sandbox is **containment, not a security boundary**
(the I/O globals are deleted but `import()` is syntax and stays: a dynamic import of a URL
from the worker is a network door), and Write sinks already load disarmed
(rules sinkRunButtonOnly — the precedent).
**Do.** (1) A document you did not author opens **restricted**: sources quiet (1.4's C2),
Script nodes inert (they show their source and an "allow scripts" control; their outputs are
a `#RESTRICTED!`-class SolError so nothing downstream is silently right), sinks disarmed as
always, a banner naming what is held back and by whom the doc was last edited. (2) Allow per
document (remembered per account + document), or per node. (3) Close the worker's door: CSP
`worker-src`/`connect-src` on the web build, the Tauri CSP on desktop, so a Script cannot
reach the network even if allowed. (4) Ownership is a server fact once accounts exist; before
that, "not authored here" = imported from a file or link.
**Tests.** The restriction state machine is pure; a seed-based test proves a restricted
document computes to the restricted errors and an allowed one to the real values.

## Build order (across stages)

1. Stage 0 (desktop watcher + conflict decision) — any time.
2. P1 save-format freeze; P2 trust on open; P3 updater; P6 accessibility pass.
3. Stage 1: provider pick → sign-in → cloud library + versions + diff → sharing roles →
   web open. Ship. Watch the support load before Stage 2.
4. Stage 2: identity on comments → presence → branch-version merge → sign-off. Ship.
5. Stage 3: CRDT schema + the flowModel bridge (headless, node-vitest-testable first — the
   model builder runs without a view) → relay → awareness → per-user undo → composites.

## Exit criteria (per stage)

- **0:** a document in a synced folder reloads on external change and never clobbers a newer
  copy without asking.
- **1:** sign in, save a document to the cloud, open it on another machine and in a browser
  via a share link, restore and diff versions.
- **2:** two people take turns on one document with identified comments and a visible
  conflict copy when they collide.
- **3:** two people move nodes and edit literals in the same document at once, see each
  other's cursors, each undo their own work, and get identical computed values.

## Open author calls

1. The provider strategy (a managed backend vs building one) and the self-host promise.
2. Which stage 2.0 ships with (recommend: 0 in 1.4, 1 + 2 in 2.0, 3 as 2.x).
3. P4 — the web target (recommend the JS oracle as the web engine for shared documents).
4. Pricing / metering — outside this doc; the AI key is the first metered thing.
5. Whether multiplayer is desktop-and-web or desktop-first.

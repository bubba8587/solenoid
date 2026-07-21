# Out of scope — the standing NO list

> **STATUS: DRAFT — not ratified.** The author has not reviewed/approved this list
> (2026-07-02). Treat every entry as a *proposal*, not policy: do not cite it to
> reject work until the author has been through it. The four tests and the
> Alteryx-pattern distinction are the parts most likely to survive review intact.

Last in the series ([architecture](archive/future-directions.md) →
[features](archive/scope-features.md)). This one is the
**anti-roadmap**: categories Solenoid should stay out of, especially where a competitor
already owns the ground. Its job is to be *cited* — when a tempting feature comes up,
check it against this list before scoping it.

## The four tests

A thing belongs OUT of scope if it fails any of these:

1. **The incumbent is free or bundled.** Competing with Google Sheets, Power BI
   (bundled with Office), or GitHub on their home turf is unwinnable regardless of
   quality. Compete only where the incumbent is *expensive and structurally worse*
   (the Alteryx pattern: their whole product is one Solenoid primitive with a
   five-figure price tag).
2. **It requires arbitrary code execution inside the graph.** The entire trust thesis
   (typed, inspectable, pure, provenance-carrying) dies the moment a node can run
   arbitrary Python/JS. This is the Expression-cap decision, generalized.
3. **It requires running a service.** Accounts, hosting, uptime, billing, abuse
   handling — that's a company, not a feature, and it contradicts the one-file
   local-first identity (strategy thread #5) and the one-author reality.
4. **It's a maintenance treadmill.** Anything whose value is "integrations with 300
   external systems" decays continuously and consumes the roadmap forever.

And the mirror test for what IS in scope: **inspectable, typed computation over data,
in a file the user owns.** If a feature strengthens that sentence, it's a candidate;
if it's orthogonal to it, it's scope creep even if it's easy.

---

## The list

### 1. BI dashboarding — Tableau, Power BI, Looker, Metabase, Superset
**Stay out because:** Power BI is effectively bundled into the Office estate;
Metabase/Superset are free open source. Their substance — pixel-polished viz,
row-level security, scheduled distribution to hundreds of viewers, semantic layers —
is a decade of work orthogonal to computation.
**The line:** Solenoid's charts exist to make *your model* legible (a Display with
pictures), and the report projection (scope #13) is a readable face of one document —
never a multi-source enterprise dashboard. Live monitoring (scope #3) watches *your
graph's values*, it does not become a BI portal.
**Tell-tale creep:** "can we add drill-through / a dashboard grid / viewer seats?"

### 2. Being a database — Postgres, SQLite, DuckDB, Snowflake
**Stay out because:** storage, indexing, concurrent writes, backup, and durability are
solved, free, and enormous. A tool that computes over data must not become the place
data *lives*.
**The line:** Solenoid reads sources and (scope #9) writes results back — but the
system of record is always someone else's. The external-engine idea (future-directions
Bet 5) *points at* databases; it never reimplements one. Frame Input holding pasted
literals is fine — that's a literal, not a database.
**Tell-tale creep:** "persistent tables inside Solenoid", "indexes", "multi-user edits
to shared data."

### 3. Real-time co-editing — Google Sheets, Office 365
**Stay out because:** simultaneous-cursors collaboration is free at planetary scale
next door, and building it (CRDTs, presence, conflict UI, servers) is a money pit that
also contradicts local-first.
**The line:** collaboration in Solenoid is **asynchronous review** — node-anchored
comments, sign-off, snapshots, git-friendly diffs (scope #14, #6, Bet 2). The file
travels; people don't share a cursor. Revisit only if the addressable model (Bet 2)
exists AND a real need survives that long.
**Tell-tale creep:** "two people editing the same canvas live."

### 4. Notebooks / arbitrary code cells — Jupyter, Observable, Hex
**Stay out because:** a "run Python here" node instantly destroys every guarantee the
product sells — purity, typing, provenance, auditability, safety of shared files. This
is the sharpest-edged NO on the list because it will be the most requested: it's the
universal escape hatch, and the whole point of Solenoid is that the escape hatch is
where trust goes to die. The author already made this call once at smaller scale (the
Expression cap: type-agnostic scalar/1-D subset, permanently); this is that decision
at product scale.
**The line:** extensibility is *more node types* (packs, composites/subgraphs — typed,
inspectable) — never *arbitrary evaluation*. The report projection is a view of the
graph, not a notebook runtime.
**Tell-tale creep:** "just one scripting node for power users."

### 5. Workflow orchestration — Airflow, Dagster, Prefect, n8n, Zapier, Power Automate
**Stay out because:** retries, backfills, queues, distributed workers, cron
infrastructure, and (for the Zapier class) thousand-connector catalogs are two whole
industries. Fails tests 3 and 4 simultaneously.
**The line:** scope #9/#10 end at — *one graph, one machine, one trigger* (manual, an
alert edge, a simple interval, or an external caller invoking headless Solenoid). The
positioning is better anyway: headless Solenoid is **a step inside their pipelines**
(an Airflow task, a Zapier action), which makes orchestrators a channel, not a
competitor.
**Tell-tale creep:** "retry policies", "run history dashboard", "a second graph type
for jobs."

### 6. Connector catalogs — Fivetran, Airbyte
**Stay out because:** maintaining API connectors to hundreds of SaaS tools is the
purest maintenance treadmill in software; it has killed better-funded products.
**The line:** files (CSV/JSON), HTTP (the existing fetch nodes), and databases via the
external-engine seam. Everything else arrives as a file or through the user's existing
ELT. A pack may add a *specific* high-value connector someday; a connector *catalog*
never.

### 7. App builders — Retool, PowerApps, Appsmith
**Stay out because:** layout designers, component libraries, auth/user management, and
CRUD-app hosting are their whole product and a service business (tests 1 and 3).
**The line:** publish-as-form (scope #2) stays literally "the graph's typed inputs as
fields, its outputs as results" — *generated from* the graph, never designed. No
canvas-of-widgets, no users table, no permissions. The moment a published form needs a
layout editor, it's out of bounds.

### 8. Work-tracking databases — Airtable, Notion, Smartsheet, Monday
**Stay out because:** they're databases-with-views for tracking *things* (tasks,
assets, CRM rows) — a different job (storage + workflow) wearing a spreadsheet
costume. Fails tests 1, 2 (their automations), and 3.
**The line:** Solenoid computes; it does not track. No kanban, no calendar views, no
forms-that-append-rows as a lifestyle.

### 9. ML training platforms — R/SPSS, scikit-learn, DataRobot
**Stay out because:** training, tuning, and deploying models is its own universe, and
"AutoML inside a spreadsheet" is a gimmick against free notebooks.
**The line:** *Excel parity* stats (regression à la LINEST, distributions, the
Analysis-ToolPak tier) are in scope as nodes. The AI story (scope #19) is Solenoid as
the **audit surface for AI-produced computation** — the cage, not the beast. An
LLM-as-column-transform node may someday pass the tests (typed in/out, inspectable,
validated by expectations); an ML *pipeline* never does.

### 10. Version control itself — GitHub, GitLab
**Stay out because:** branching, merging, hosting, and code review at scale are solved
and free.
**The line:** Bet 2 makes the file *git-friendly* (diffable text, stable identities) —
Solenoid rides git, it never reimplements it. Snapshots (scope #6) are in-file *value*
history ("what did the model output at Q2 close"), deliberately distinct from source
history, which belongs to git. No merge-conflict UI beyond "pick a side" pragmatism.

### 11. Hosted anything — sharing servers, cloud sync, a "Solenoid cloud"
**Stay out because:** test 3 in its purest form. Every hosted feature (published
forms as a service, cloud model registry, sync) converts the product into an ops
burden and the identity from "your file" to "our servers."
**The line:** publish features emit **static artifacts or self-hostable pieces** (an
HTML file, a headless CLI the user's own infra calls). If a hosted tier ever happens,
it's a *business decision* layered on top later — nothing in the architecture should
require it. (Same verdict already given to scope #18's embeddable-engine platform:
filed as an identity fork, not chased.)

### 12. The A1 grid itself — Excel, Google Sheets, Grist
**Stay out because — and this is the subtle one:** Solenoid's founding bet is that the
**graph replaces the grid** as the model's structure. Embedding a real free-form
spreadsheet grid (per-cell formulas, A1 references) inside a node would be quietly
conceding that bet, and would put the product in direct feature-front competition with
free incumbents and with Grist (which already is "spreadsheet meets database").
**The line:** tables in Solenoid are *data* (typed columns, entered or imported) —
the popup grid is a data-entry/viewing surface. **Computation happens in the graph,
never per-cell.** The moment someone asks for "=SUM(A1:A5) inside the table popup,"
the answer is: that's a node.
**Tell-tale creep:** per-cell formulas, cell references, cell formatting-as-data.

### 13. Rich document editing — Word, Docs, Notion-style blocks
Already flagged at scope #13, restated as a standing rule: the report projection is
**arrangement of live blocks** (pins, notes, tables, charts). No rich-text engine, no
comments-in-prose, no pagination beyond print CSS. If it needs a toolbar with fonts,
it's out.

---

## Why Alteryx is IN and these are OUT (the pattern, explicitly)

The Alteryx teardown (scope-features appendix) can look like it contradicts this doc —
"don't compete with incumbents, except that one?" The distinction:

**Compete where the incumbent's *product* is your *primitive*.** Alteryx's entire
offering — a node canvas of data verbs — is something Solenoid natively is; the
"competition" costs a seed file. Crystal Ball (Monte Carlo), Mathcad (units), Stella
(simulation) fit the same pattern: each is one planned Solenoid capability sold alone
at $1k–5k/seat.

**Avoid where the incumbent's product is *infrastructure you'd have to build*** —
storage engines, collab servers, connector fleets, hosting, viz platforms. There the
incumbent's moat is exactly the part Solenoid shouldn't want to build, at any price.

One sentence to remember: **Solenoid wins by being the inspectable computation layer —
everything that stores, hosts, orchestrates, or renders at enterprise scale is
someone else's product that Solenoid should plug into, undercut from below, or
ignore.**

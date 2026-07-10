# Pack nodes waiting on the composite pack-node shape

Planning doc (2026-07-09, Pack Duty session). Packs today can ship **formula
presets** (locked Expression nodes — pure data) and **custom-logic node classes**
(real code). They can NOT yet ship a **subgraph/composite** — the "Composite pack
node" in `docs/pack-architecture.md` exists as a user-built container, but there
is no way for a pack to *declare* one (no serialized composite-in-a-pack format,
no per-port promotion authoring surface). Everything below was surveyed during
the pack build-out and deliberately **planned, not hand-rolled**: each is a small
graph of existing nodes, and faking it as one opaque code node would forfeit the
inspect-the-internals value that makes a composite worth having.

When the composite pack shape lands, each entry is: internal graph (existing
nodes) + declared boundary ports. None needs new engine features unless noted.

## Timesavers (from `docs/archive/timesavers-pack-proposal.md` — the [M] set)

- **% of Total** — Aggregate(sum) → broadcast ÷. The proposal's canonical
  example of "one Expression can't aggregate AND broadcast".
- **Pareto / Cumulative %** — Sort desc → Cumulative → ÷ grand total.
- **Join-If** — Filter → TextJoin.
- **Lookup All Matches** — Filter-based multi-return lookup.

Also *deferred from the proposal, not composite-shaped* (parked for their own
reasons):
- The **date-serial [F] idioms** (Quarter, Age/Tenure, Nth Weekday, Date
  Predicates…) — pending the Formula.js date-serial interop check the proposal's
  audit caveat demands; if it fails they become [C] nodes on the `date.ts` pattern.
- The **duration trio** (Duration ⇄ Time, Humanize, Parse) — wants an
  elapsed-`[h]:mm` display format first (an FC format-model question, not a node).
- **Split Name** (multi-output [C]) and the **list-reducer core batch**
  (Conditional Aggregate AND/OR, Multi-Criteria Lookup, Last/First Non-Blank,
  Rank within Group, Running Count, IQR Outlier Flag, Bucket/Recode, Piecewise
  Interpolate) — the proposal recommends these as CORE nodes tagged into the
  pack, a separate build from pack work.

## Electricity & Circuits

- **Wheatstone bridge** — 4 resistor inputs + excitation → bridge voltage;
  internally two Voltage Dividers and a subtract. Classic teaching composite.
- **RLC step response** — R/L/C + source → the damped waveform as a chart
  (LinSpace time base → element-wise expression → Chart). Output is a `chart`
  socket; pairs with the damping-ratio scalar.
- **Battery pack designer** — cell V/Ah + series/parallel counts → pack V, Ah,
  Wh, and per-cell current; trivially a composite of multiplies, but the value
  is the labeled boundary.
- **Filter response (Bode)** — RC/RL corner frequency node exists in spirit
  (reactance nodes); the composite sweeps frequency → gain curve → Chart.

## Fluid Mechanics

- **Pump operating point** — pump curve (points/coefficients) ∩ system curve
  (static head + k·Q²). Needs the 1-D root-finder over a subgraph — exactly the
  Composite "Solve" run mode that already exists; blocked only on packs being
  able to ship a composite.
- **Pipe segment ΔP (end-to-end)** — Reynolds → Colebrook → Darcy in one card
  with fluid presets. Pure chaining of nodes this pack already ships.

## Thermodynamics & Air

- **Psychrometric state point** — any two of (Tdb, Twb, RH, W, Tdew) → the full
  state. Needs property INVERSION (root-finding over the humid-air relations) —
  the reference-packs doc's "solver substrate" case. Composite + Solve mode, or
  a custom node once the 1-D root-finder is a reusable primitive.
- **Heat exchanger (LMTD / effectiveness-NTU)** — four temperatures + UA →
  duty; the two methods as variants.

## Earth & Sky

- **Sun-path chart** — Sun Position swept over a day/year → Chart figure.
- **Solar panel tilt/yield estimate** — sweep tilt against sun elevation →
  argmax. Composite over existing sweep machinery (Data Table run mode).

## Chemistry

- **Titration curve** — volume sweep → pH curve → Chart (strong/weak variants).
- **Buffer designer (Henderson–Hasselbalch)** — target pH + pKa → ratio, and
  the inverse. The inverse direction wants Solve.
- **Chemical equation balancer** — genuinely NOT a composite (integer
  nullspace); if ever built it's a custom-logic node. Parked: niche relative to
  its cost.

## Materials & Mechanical (pack not yet built — next domain candidate)

Scoped in `docs/archive/reference-packs.md`: beam deflection (Roark cases —
variant-heavy, needs the pack variant-switch socket reconcile from backlog),
bolt torque/preload, pipe schedule + hardness-conversion lookup tables
(Interpolated Lookup primitive), stress concentration factors. The **Interpolated
Lookup** primitive (1-D/2-D dataset interpolation) is the gating build for the
table-driven half — it's also what steam tables (IAPWS region backup), matweb-
style material properties, and thermocouple tables want.

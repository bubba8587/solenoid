# Solenoid — Reference Data Packs

Scoping notes. No build commitment yet. The thesis, the node primitives it needs, the
domains worth absorbing, and the licensing line we cannot cross.

## The thesis: subsume the ad-ridden calculator web

There is a whole genre of single-purpose websites that professionals and students use
every day because nothing better exists offline: steam table lookups, AWG resistance
charts, tap drill charts, hardness conversion, resistor color codes, psychrometric
calculators, friction factor calculators, material property databases. They are SEO
spam, drowning in ads, sometimes paywalled, often of unknown provenance, and you cannot
compose their output into anything. You read a number off the page and retype it into
your real calculation.

Solenoid can absorb the underlying reference data and the formula behind it, and deliver
it offline, unit-honest, and composable directly into a larger graph. No ads, no retyping,
no leaving the tool.

We already proved the model. The Convert node subsumes the single biggest genre of these
sites (unit converters). The reference packs are the same move applied to every other
genre. A steam table node is just a Convert node for thermodynamic state.

Why this fits Solenoid specifically:
- **Unit-honest by construction.** Reference data is the purest showcase for the unit
  flagship. A steam node outputs enthalpy in kJ/kg and the unit system carries it
  downstream. This is exactly where unit honesty earns its keep, because every quantity
  in these domains has a real unit and getting the unit wrong is the classic engineering
  error.
- **Composable.** The whole point is that the looked-up value flows into the next node
  instead of being read off a webpage and retyped.
- **Local-first.** Matches the personal-instrument positioning in the competitive doc.
  Works on a plane, no network, no tracking.

## Two kinds of "table," and the design tension

Almost every reference splits into one of two implementations, and picking wrong makes
the node either inaccurate or needlessly heavy.

**1. Pure lookup with interpolation.** A sparse grid of measured values you interpolate
between. Material properties, thermocouple voltage tables, AISC section properties.
These need a new node primitive (see Interpolated Lookup below) plus the dataset.

**2. A correlation that is secretly a table.** Many "tables" are published as grids but
are generated from a standard equation. Implementing the equation is smaller, exact, and
continuous instead of sparse:
- Steam and water: IAPWS-IF97 formulation. Compute properties directly, no table.
- Refrigerants and real fluids: Helmholtz energy equations of state (the CoolProp model).
- Vapor pressure: Antoine equation with per-substance coefficients.
- Pipe friction: Colebrook equation (implicit, see solver note below).
- Thermocouples: NIST ITS-90 polynomials, voltage <-> temperature.
- RTD / PT100: Callendar-Van Dusen equation.
- Standard atmosphere: ISA model, altitude to pressure / temperature / density.

The rule of thumb: if a recognized formulation exists, implement the formulation, not the
printed grid. It is usually both more compact and more accurate, and it sidesteps the
licensing problem of copying a copyrighted table verbatim (see licensing section). Fall
back to interpolated lookup only when the data is genuinely empirical with no closed form
(material properties, most of metallurgy).

**And in most cases we do not implement the formulation ourselves.** These heavy
correlations already exist as mature, well-tested native libraries (steam and water,
refrigerants, linear algebra, signal processing, optimization). The plan is to bind to
those from the desktop's fast compiled engine rather than rewrite the physics. So a
reference pack is usually wiring up something that already exists, not writing it from
scratch. This is also why these packs are desktop-only and never run in the browser
version. See [compute-architecture.md](compute-architecture.md).

## Connection to the solver work

Several references are implicit equations, not direct evaluations. The Colebrook friction
factor is the textbook case: you cannot solve for the friction factor in closed form, you
root-find it. That is exactly the 1D non-linear root-finder from the sweep/solve notes.
Some property inversions (given enthalpy, find temperature) are the same shape. The
reference packs and the solver substrate reinforce each other: building the root-finder
unlocks a chunk of the engineering references, and the references give the root-finder an
obvious reason to exist.

## Node primitives this needs

- **Interpolated Lookup.** The infrastructure node. An embedded or user-supplied dataset
  plus N-D interpolation: 1D linear, 2D bilinear (steam tables are T-by-P grids), optional
  spline. Distinct from the existing XLOOKUP, which is exact-match only. Reference packs
  are curated, pre-loaded instances of this same node.
- **Correlation nodes.** One per formulation (IAPWS, Antoine, Colebrook, ISA, etc.). These
  are ordinary computed nodes, same embedded-formula path as Expression and tableLambda.
- **Substance / material selector.** A shared input control: pick a fluid, metal, gas, or
  thermocouple type from a curated list, which sets the coefficients feeding the node. This
  is a reusable widget across the whole reference family.

A reference node, in general, is: a substance or material selector, plus input conditions
(temperature, pressure, gauge, etc.), producing property outputs that are unit-tagged.

## Domains worth absorbing

Grouped by pack. Each line names the genre of website it would replace.

### Thermo / fluids
- **Steam and water properties** (IAPWS-IF97): saturated and superheated, h, s, v, u, x.
  Replaces steamtablesonline and the spirax-sarco style lookups.
- **Refrigerant and real-fluid properties** (CoolProp model): R-134a, R-410a, ammonia,
  CO2, propane.
- **Psychrometrics / moist air**: humidity, dew point, wet bulb, air enthalpy. Replaces
  every HVAC psychrometric calculator.
- **Water properties vs temperature**: density, viscosity, vapor pressure, surface tension.
- **Air and gas properties vs temperature**: density, viscosity, conductivity, Cp, Prandtl.
- **Standard atmosphere** (ISA): altitude to pressure, temperature, density, speed of sound.
- **Pipe friction**: Colebrook friction factor, Moody chart, pipe roughness values,
  fitting K-factors, Hazen-Williams C factors.

### Materials and mechanical
- **Material property database**: density, modulus, yield and tensile strength, thermal
  expansion, conductivity, specific heat, Poisson ratio. Replaces matweb (note licensing,
  do not scrape).
- **Hardness conversion**: Rockwell, Brinell, Vickers, tensile. Replaces the hardness
  conversion chart sites.
- **AISC structural shapes**: W-beams and channels, section modulus, moment of inertia.
- **Pipe schedules**: NPS, schedule 40/80, OD, ID, wall thickness.
- **Fasteners**: metric and imperial bolt sizes, thread pitch, tap drill and clearance
  drill charts. Replaces tap-drill-chart sites.
- **Drill / tap / reamer size charts.**
- **Beam deflection** (Roark standard load cases), stress concentration factors, bolt
  torque and preload.

### Electrical
- **AWG wire tables**: diameter, area, resistance per length, ampacity. Replaces the AWG
  calculator sites.
- **Resistor color code** and standard E-series values (E12/E24/E96). Replaces the resistor
  color code sites.
- **Thermocouple tables** (NIST ITS-90): types K, J, T, E, voltage <-> temperature.
- **RTD / PT100** (Callendar-Van Dusen): resistance <-> temperature.
- **Wire ampacity and voltage drop** (NEC-style), dielectric constants.

### Chemistry
- **Periodic table**: atomic mass, number, electronegativity, radii, electron config.
- **Standard formation properties**: enthalpy, Gibbs energy, entropy of formation
  (NIST WebBook).
- **Vapor pressure** (Antoine coefficients per substance).
- **pKa tables**, standard reduction potentials (electrochemical series).
- **Solution density vs concentration** (e.g. acids), solubility tables, refractive indices.

### Earth, space, and time
- **Standard atmosphere** (shared with thermo above).
- **Magnetic declination** (World Magnetic Model), gravity vs latitude and altitude.
- **Solar position and insolation**, sunrise / sunset, moon phase.

### Finance and actuarial (extends the strong existing finance coverage)
- **Mortality / life tables.**
- **Tax brackets** by year and jurisdiction.
- **Day-count conventions.**

### Medical / bio
- **BMI, body surface area**, reference lab ranges, basic drug dosing, nutrition data.

## Licensing line

This matters and is easy to get wrong.

- **Safe to implement: the formulation.** Equations and the physics behind them are not
  copyrightable. IAPWS-IF97, Antoine, Colebrook, ISA, Callendar-Van Dusen, NIST ITS-90
  polynomials are published standards meant to be implemented. Implement the equation, do
  not transcribe a copyrighted printed table.
- **Safe data: US government and public domain.** NIST data (WebBook, ITS-90 coefficients),
  CODATA constants, NEC and government standards data, World Magnetic Model. Generally
  public domain or freely usable.
- **Open source we can vendor or port.** CoolProp is MIT-licensed. A port or a vendored
  build covers refrigerants and real fluids cleanly.
- **Do not copy: proprietary compilations.** matweb material data is proprietary, do not
  scrape it. ASME steam table booklets and ASHRAE compilations are copyrighted as
  compilations even though the underlying physics is free to implement. AISC publishes
  shape tables, check the redistribution terms before bundling. When a source is a
  copyrighted compilation, get the same numbers from the underlying formulation or a
  public-domain dataset, never by copying the book.

The clean general strategy: prefer the standard formulation (which is also more accurate),
use public-domain and open-source datasets for the genuinely empirical cases, and never
bundle a proprietary compilation.

## Excel parity note

Excel has none of this natively. There is no STEAM() or THERMOCOUPLE() function. So these
packs are pure differentiation rather than parity, and the catalog entries should be marked
as Solenoid-native (no Excel equivalent) rather than parity-tracked. This is squarely the
"answer questions Excel cannot" territory, and the unit honesty is the part a spreadsheet
fundamentally cannot give you.

## Suggested first target

**Steam tables via IAPWS-IF97.** It is the most recognizable genre, it is a published
formulation (no licensing problem, no interpolation needed), it is unit-rich (best possible
flagship demo), and it forces the substance-selector and property-output conventions that
every later reference node reuses. If the friction-factor reference comes next, it also
exercises the 1D root-finder and ties the reference work to the solver substrate.

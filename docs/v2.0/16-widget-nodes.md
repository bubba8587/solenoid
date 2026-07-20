# 16 — Everyday widget nodes (the throwaway-workbook / load-a-website layer)

Scoped 2026-07-20 (author-directed brainstorm). **Status: SCOPED, not started.**
Tier 1 is autonomous-friendly and could slot into 1.3 instead of 2.0 — sequencing
is the author's call.

## The lens

Small, frequent tasks with clear inputs and outputs that today send a person to
(a) a one-shot website ("100 usd to eur", a QR generator, weather.com), or
(b) a tiny Excel workbook they'll never open again (a watering schedule, a
project-end-date calc, a trip budget). Solenoid's edge over both: **the answer is
a socket.** A website gives you a number you retype; a Solenoid widget node gives
you a value the graph computes on — through Aggregate, IF, Alert, FC units, and a
docked Report. The dashboard framing: docked Report + `refreshMinutes` +
Alerts + Presenter already make a doc a leave-it-open live dashboard; what's
missing is the *sources* worth leaving open.

**The pitch case (author's example): garden watering.** No weather site will tell
you "water Tuesday" — that needs *your* rules over *data*. With ONE new Weather
source node, everything else composes from existing nodes:

```
Geocode("Boise") ─▶ Weather (past_days=14, forecast=7, refreshMinutes=360)
                      ├─ Daily frame (date, rain mm, prob, hi/lo, ET₀)
                      ▼
   Frame Filter (date < today) ─▶ Aggregate sum ─▶ rain_last_7d
   Frame Filter (date ≥ today) ─▶ Aggregate sum ─▶ rain_next_3d
   IF(rain_last_7d < 25 AND rain_next_3d < 10) ─▶ water_today (logical)
                      ─▶ Alert ("Water the garden") + docked Report
```

Alert already fires correctly off an interval-triggered recompute
(`connectionStore.test.ts`) — the plumbing exists end-to-end. Open-Meteo even
serves FAO ET₀ evapotranspiration and soil moisture, so the enthusiast version
(water balance = ET₀ − rain) is the same node.

## Design rules (all derived from shipped precedent)

1. **Keyless + CORS-friendly APIs only** for built-ins (FRED-keyless precedent;
   Stooq died bot-blocked — pick services with *official* free tiers that
   advertise browser use). Keyed providers stay possible via `apiKeyStore`, but
   no Tier-1 widget may require one.
2. **Compute over fetch when physics allows** (NOAA sun / Moon Phase precedent):
   deterministic, offline, headless-runner-safe. Fetch only what genuinely lives
   on a server (weather, rates, holiday gazetting).
3. **Reuse the connection pattern verbatim** (`WebSourceNode`/`DataFeedNode`):
   synchronous `data()` serving `cachedResult`, one background fetch per cache
   key, `connectionStore` status + `fetchedAt`, `refreshMinutes` timer, manual
   refresh, never bake fetched data into the save.
4. **Outputs are data, not a face.** Frames + scalars out typed sockets; the
   graph does the thinking. Rich visuals go out the green `chart` socket
   (standing rule). Task-shaped multi-output is fine (TableInfo precedent).
5. **Provider parsing is pure + fixture-tested** (`dataFeed.test.ts` precedent);
   the headless runner (`run-graph.ts`) gets these nodes for free (Node fetch),
   which enables cron'd headless alerting later.

## Tier 1 (each ≈ the Data Feed build: provider/logic file + node + component + tests + seed)

- **Weather** — the anchor. Open-Meteo (`api.open-meteo.com/v1/forecast`):
  keyless, CORS-open, 10k calls/day free. One call returns past *and* future
  daily rows (`past_days` up to 92 + 16-day forecast). Inputs: lat/lon sockets
  (Geocode feeds them) with typed-literal fallback. Outputs: `Daily` frame
  (date, precip mm, precip probability, temp hi/lo, ET₀, weather code) + `Now`
  scalars (temp, condition text). A °C/°F toggle sets the API unit param AND
  forwards the unit downstream like Convert does. Past/future split stays in the
  graph (Frame Filter vs TODAY) — one frame, no bespoke outputs.
- **Geocode** — place name → lat, lon, IANA timezone, label. Open-Meteo
  geocoding API (keyless, CORS). The enabler node: feeds Weather, Sunrise/Sunset,
  Solar Position, Moon Phase, great-circle Distance — all of which today demand
  hand-typed coordinates. Ambiguous matches: a pick-list popup (Element-picker
  precedent).
- **Currency / FX** — the #1 googled conversion. Frankfurter (ECB reference
  rates, keyless, CORS, ~30 currencies, updated once per business day — say so
  on the card, it's a converter not a forex feed). Inputs: Amount, From, To
  (dropdowns, wireable). Outputs: Converted, Rate, As-of date; optional
  time-series frame (Frankfurter has it) → Chart. This is Solenoid-native:
  currency is a *unit* in the FC model, so the node forwards the target unit
  downstream exactly like Convert. **⚠ Reverses the 1.1 Data-Feed cap "no
  crypto/FX unless asked" — needs the author's explicit yes.**
- **Holidays** — country (+ optional region) + year → frame (date, name).
  Feeds straight into the existing NETWORKDAYS/WORKDAY Holidays input — the
  classic throwaway-workbook task ("real project end date") completes with zero
  new date nodes. Also "days to next holiday" for dashboards. Source call for
  the author: Nager.Date API (keyless, CORS, ~100 countries, zero bundle cost)
  vs a bundled rules dataset (offline + deterministic per rule 2, but a chunky
  dependency). Recommend: Nager first, revisit if offline matters.
- **Time Zone Convert (+ World Clock)** — "3pm ET in Tokyo" / meeting planner.
  Pure compute via `Intl.DateTimeFormat` `timeZone` (zero deps, IANA names —
  which Geocode outputs). Convert node: datetime + from + to → datetime.
  World Clock: zone list → frame (place, local time) for the Report. Care
  needed: date serials are wall-clock-as-UTC (`date.ts`), so conversion is
  serial→wall-clock-in-zone reinterpretation; DST edge cases need tests.
- **QR Code** — text → `ImageValue` out the `chart` socket (standing
  rich-content rule) → embeds in a Report, prints. Tiny pure client lib, no
  network. Template dropdown like Mermaid's: plain text/URL, Wi-Fi
  (`WIFI:S:…;P:…;`), vCard — the Wi-Fi one alone replaces a website visit.

## Tier 2 (cheap follow-ons once Tier 1 lands)

- **Air Quality / Pollen** — Open-Meteo air-quality API (keyless, CORS): PM2.5,
  US/EU AQI, pollen (Europe). Sibling preset of Weather; Alert on AQI threshold.
- **Ticking Now** — give `TodayNowNode` an opt-in `refreshMinutes`-style timer
  (reuse `useAutoRefresh`) so NOW/TODAY drive a *live* dashboard (World Clock,
  countdowns, "stale data" math). Must respect manual calc mode the way
  connection refresh already does.
- **Tides** (NOAA CO-OPS, keyless, US-only) — parked, niche.

## Out / already covered — don't rebuild

- Sun position, sunrise/sunset, moon phase (Earth & Sky pack, computed) ·
  NETWORKDAYS/WORKDAY with a Holidays input · great-circle distance · RAND ·
  JSON→Frame (`jsonToFrame` in WebSource) · tip/loan/BMI-class calculators
  (packs/TVM). Countdown/date-math = existing date nodes; a widget here is a
  *seed*, not a node.
- Stocks/crypto quotes — keyless sources are bot-blocked (Stooq) or
  rate-capped (CoinGecko); Data Feed + Alpha Vantage already covers the keyed
  path. Park.
- Package tracking, sports, news/RSS — no stable keyless data APIs, or
  iframe-shaped (that's the 1.3 embed node's can of worms, author-gated).

## Author calls needed before build

1. **FX yes/no** (reverses the earlier scope cap).
2. **Standing provider policy** — OK to take Open-Meteo / Frankfurter /
   Nager.Date as built-in dependencies? (Privacy note: lat/lon leaves the
   machine; desktop fetches use the curl UA.)
3. **Where they live** — recommendation: Weather / Geocode / FX / Holidays are
   core **Connections** siblings of Data Feed (they fetch); Time Zone / QR /
   World Clock fit the **Timesavers** pack (they compute).
4. **Demo seed** — "Garden Dashboard" (the watering example above) as the
   showcase seed; doubles as release-notes material.

# Zoomed-out perf experiments (not live code)

Saved working state of a perf investigation; nothing here is wired into the app. `LOG.md` is the running log
(hypotheses, n=5-7 results with median [min-max], what was confirmed in Chromium source and what was rejected).

- `scripts/` — probes. Copy into the repo's `scripts/` (they import puppeteer-core from the repo and `./browser.mjs`) and run with the dev server on :1420.
  - `exp-snap.mjs` snapshot the live canvas DOM+CSS to a static page; `exp-pan.mjs` pan/zoom/poke cost of a static page per JS variant (`v*.json`).
  - `exp-mobile.mjs` + `live-ab.sh` live-app phone-emulation A/B, CSS injected per variant (`css/`), CSV per run.
  - `exp-flagged.mjs` census of elements that can flag a card kMayBeClippedByCullRect; `exp-census.mjs`, `exp-vis.mjs` helpers.
- `trial-value-box-inner-clip.patch` — the uncommitted trial (value text in an inner clipped div).
- `*.csv` — raw per-run results.

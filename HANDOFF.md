# port-timezones: handoff (delete on merge)

Status: neither card is ported. Committed: a native zone table generator (`scripts/gen-zone-table.mjs` ->
`crates/solenoid-core/data/zones.bin`), World Clock split into a shell (`static coreFields = ["nowMs"]`, pure
`body()`), a fix for World Clock throwing on a null zone (2,640 of 11,520 recorded calls), and hand tests
(`tests/graph/timeZoneCards.test.ts`, never run yet). Not refrozen; `zone.rs` and `nodes/date.rs` untouched.

Findings: no tz data in std or any solenoid-core dependency (`chrono-tz` arrives only via polars in src-tauri, and its
tzdata differs from ICU's). Intl (Node 22, ICU 77.1, tz 2025b) takes 636 names -> 458 zones, ASCII-case-insensitive;
offset zones ±HH, ±HHMM, ±HH:MM (U+2212 minus works; "+5:30", "GMT+5" refused); proleptic Gregorian, era years.

Table: every instant a JS Date holds. LMT, then scanned transitions 1800-2141 (12 h scan + bisection), then a yearly
rule inferred from 2101-2140 (two "first weekday on/after day D of month M, plus N s" per year). The generator checks
itself against Intl (±1 s around every transition, rule transitions to 2600, 5,000 random instants) and exits 1 on any
mismatch. Delta-encoded LEB128 varints; zones with identical offsets share an entry (345 entries, 19,272 transitions).
The committed bin is the older encoding (104 KB, 23 KB gzipped); REGENERATE before anything reads it (~10 min on 4
threads, expected ~65 KB). Not gzipped: the core has no inflater and takes no new dependency.

Next:
1. `node scripts/gen-zone-table.mjs`; run the new tests.
2. Under the lock: `FREEZE_NODES=TimeZoneConvertNode,WorldClockNode npx vitest run`, then
   `node scripts/freeze-nodes.mjs TimeZoneConvertNode WorldClockNode`.
3. Native reader in `zone.rs` behind `cfg(not(target_arch = "wasm32"))` (`include_bytes!`): offset-zone parsing plus
   the table, for `is_valid_zone` and `zone_offset_ms` (shown parts as Intl gives them, era year and whole seconds,
   then `date_utc`).
4. `clock_text`: wasm formats with Intl en-GB (weekday short, hour, minute, h23) as the TS did; native prints
   "Ddd HH:MM" from the table.
5. Port the bodies into `nodes/date.rs` (Time Zone Convert calls `core_call("TIMEZONECONVERT")`).
6. Switch the TS classes; delete `worldClockRows`, `worldClockFrame`, `placeLabel`, `ClockRow`. Keep `convertZone`,
   `isValidZone`, `zoneOffsetMs` (formula registry) and `IANA_ZONES` (component). Prune `timeZone.test.ts`.
7. tsc, rebuild the wasm (wasm-bindgen 0.2.100), run `timeZone*.test.ts`, `volatileDates.test.ts`,
   `unitFlowAnnotation.test.ts`. Add `*.bin binary` to `.gitattributes`.

Possible bug: World Clock's body never reads `stringLiterals.zones`; arrival coercion feeds the typed list in.
Stale once landed: `zone.rs`'s doc ("natively no IANA zone is known"), node-bodies.md.

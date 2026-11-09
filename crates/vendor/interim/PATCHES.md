# Solenoid's patches to interim

interim (MIT, Conrad Ludgate, https://github.com/conradludgate/interim), vendored from `main` at
`8e2b39baec8019ae84b34b378a89e9e4ab6e9faa` (2026-10-31). The last release, 0.2.1, predates the fix that stopped
"next month" reading as Monday, so Solenoid vendors `main` instead of depending on crates.io.

Solenoid reads relative date phrases with it (`crates/solenoid-core/src/relative_date.rs`, [[C44]] dateSerials). Each
patch below is marked `PATCH(n)` in the source and tested in `tests/patches.rs`, which runs only by hand (the vendored crate is
not in CI); `crates/solenoid-core/tests/relative_dates.rs` holds every patch's phrase through the core. **Each should become an upstream pull
request**; when one lands, drop it here, and when they all have, depend on the release and delete this vendored copy.
To refresh from upstream: copy `src`, `tests`, `Cargo.toml`, `LICENSE.txt` and `README.md` from a newer `main` and
reapply whatever is still listed here.

| # | What | Kind | Upstream |
|---|---|---|---|
| 1 | `9 PM`: an uppercase meridiem after a bare hour panicked (`Lowercase::literal` asserts on user text); it goes through `Lowercase::from` | bug fix | not yet filed |
| 2 | `in 3 days`, `in a week`: a count forward | grammar | not yet filed |
| 3 | `3 days from now`, `2 weeks later`, `a year hence`: forward counts after the unit | grammar | not yet filed |
| 4 | `a`/`an` as one: `a month ago`, `an hour from now` | grammar | not yet filed |
| 5 | `tonight` is today, `last night` yesterday | grammar | not yet filed |
| 6 | `[the] day after tomorrow` (+2), `[the] day before yesterday` (−2) | grammar | not yet filed |
| 7 | `+3 days` counts forward, as `-3 days` counts back | grammar | not yet filed |
| 8 | `weekend` is named by its Saturday, as a weekday is (`this weekend`, `next weekend`); before, it read as the unit `week` ("next weekend" was next Wednesday) | bug fix | not yet filed |
| 9 | `upcoming friday`, `this coming friday`: the coming one, as a bare `friday` is, in either dialect | grammar | not yet filed |
| 10 | Without a time, `last <today's weekday>` is a week ago; before, midnight today was already past, so it read as today | bug fix | not yet filed |
| 11 | `at` before the time reads as `T` does: `tomorrow at 5pm`; a dangling `at` is an error | grammar | not yet filed |

Patches 1, 8 and 10 are bugs any user hits; file those first. The grammar patches are additions the maintainer may
want to shape differently (2, 3 and 4 share `unit_tail`).

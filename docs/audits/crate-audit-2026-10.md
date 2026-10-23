# Crate audit, 2026-10-23 (evidence for the backlog's crate items; the comparison crates lived in a scratch dir)


Ranked by lines a swap would delete. "Same answers" was checked bit for bit against the crate in scratch crates
(cmp-*), with V8 consulted on every disagreement.

| # | Our code (lines) | Crate | Answers | Verdict |
|---|---|---|---|---|
| 1 | NFD table + `text_ops::nfd` (~770) | unicode-normalization 0.1.26 | identical | consider: +35 KB gz wasm; rust-core.md § Size chose the table for size |
| 2 | distribution kernels in dists.rs, fns_stats, formulajs jStat (~530) | statrs 0.19.1 | last digits (≤1.8e-10 rel) | consider: jStat parity vs accuracy |
| 3 | fdlibm.rs (1442) | libm 0.2.16 | libm is wrong vs V8 on log/log10/pow/sin/cos/tanh | keep |
| 4 | matrix det/inverse/rank/solve/eigen/roots/polyfit (~370) | nalgebra / faer | pivot, sign, order change | keep |
| 5 | Formula.js Bessel (~240) | libm jn/yn, puruspe | up to 1.4e-4 rel (bessel.js is imprecise) | keep for Formula.js; crates if Excel accuracy wanted |
| 6 | hash_ops md5/sha1/sha256/crc32/base64 (~200) | md-5, sha1, sha2, crc32fast, base64 | identical | **swap** (+17 KB gz) |
| 7 | letters.rs (137) + generator | unicode-general-category 1.1.0 | identical | consider |
| 8 | FFT (~100) | rustfft 6.4.1 | last bits | keep: +76 KB gz |
| 9 | fxhash.rs (61) | rustc-hash 2.1.3 | identical | **swap** |
| 10 | spelled.rs macro (~70) | strum 0.28 | same | consider (proc-macro build deps) |
| 11 | day ↔ y/m/d helpers (~60) | jiff 0.2.38 | same | consider with the jiff work |
| 12 | Levenshtein, OSA (~38) | strsim 0.11.1 | identical (Jaro-Winkler differs: keep ours) | consider |
| 13 | splitmix RNG, uuid_v4 (~24) | fastrand / uuid | random | consider (uuid would use crypto.getRandomValues) |

Totals: swap ~260 lines, same answers; consider-same-answers ~1,080; consider-answers-change ~770; keep ~55k
(Solenoid's own semantics, or exact JS/V8/Excel/Formula.js behavior no crate reproduces: JS number formatting and
parsing, V8 Math, toFixed ties, Date.parse, Excel criteria and finance quirks, units, frame verbs, CPM, formula
parser/evaluator, card text formatting, packs).

Already on crates where they fit: serde, ryu-js, csv, qrcodegen, regress (vendored).

Test oracle idea: ironcalc_base 0.9.1 (MIT/Apache, wasm-capable, Excel-faithful) as a dev-dependency to check
[[C14]] currentExcelParity for PRICE, YIELD, COUP*, WORKDAY without Excel. Not as a runtime dependency (it follows
Excel, not Formula.js, and pulls chrono, chrono-tz, regex, statrs).

Watch list: ferrigura-jsmath (V8 Math in Rust, published 2026-10-22, immature), ssf-rs (SheetJS format engine),
ironcalc_base.

#!/usr/bin/env bash
# What .github/workflows/engine-test.yml checks on every crate, run locally before a push: rustfmt, clippy with
# warnings as errors natively and for wasm (CI builds the dev profile, where code only the wasm target compiles is
# checked too), and the tests in the dev profile, where overflow checks are on.
#   bash scripts/check-rust.sh          fmt + clippy (a minute or two)
#   bash scripts/check-rust.sh --test   and the tests
set -euo pipefail
cd "$(dirname "$0")/.."
for c in solenoid-parquet solenoid-schedule solenoid-core solenoid-graph; do
  m="crates/$c/Cargo.toml"
  cargo fmt --manifest-path "$m" --check
  cargo clippy --manifest-path "$m" --all-targets -q -- -D warnings
  [ "$c" = solenoid-parquet ] || cargo clippy --manifest-path "$m" --target wasm32-unknown-unknown -q -- -D warnings
  [ "${1:-}" = --test ] && cargo test --manifest-path "$m" -q
  echo "ok $c"
done

#!/usr/bin/env bash
# What .github/workflows/engine-test.yml checks on every crate, run locally before a push: rustfmt, clippy with
# warnings as errors natively and for wasm (CI builds the dev profile, where code only the wasm target compiles is
# checked too), and the tests in the dev profile, where overflow checks are on.
#   bash scripts/check-rust.sh          fmt + clippy (a minute or two)
#   bash scripts/check-rust.sh --test   and the tests
set -euo pipefail
cd "$(dirname "$0")/.."
# One build directory for every crate (their dependencies overlap), without debug info or incremental caches, as CI
# builds (CARGO_INCREMENTAL=0): the checks need the compiler's verdict, not a debugger, and the disk is a fixed allowance.
export CARGO_TARGET_DIR="${SOLENOID_CHECK_TARGET:-$HOME/.cache/solenoid-check}"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
# Every crate is checked even when one fails, so one crate's failure never hides another's verdict.
failed=()
for c in solenoid-parquet solenoid-schedule solenoid-core solenoid-graph; do
  m="crates/$c/Cargo.toml"
  if cargo fmt --manifest-path "$m" --check \
    && cargo clippy --manifest-path "$m" --all-targets -q -- -D warnings \
    && { [ "$c" = solenoid-parquet ] || cargo clippy --manifest-path "$m" --target wasm32-unknown-unknown -q -- -D warnings; } \
    && { [ "${1:-}" != --test ] || cargo test --manifest-path "$m" -q; }; then
    echo "ok $c"
  else
    echo "FAILED $c"
    failed+=("$c")
  fi
done
[ ${#failed[@]} -eq 0 ] || { echo "failed: ${failed[*]}"; exit 1; }

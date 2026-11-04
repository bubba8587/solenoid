#!/usr/bin/env bash
# What .github/workflows/engine-test.yml checks on every crate, run locally before a push: rustfmt, clippy with
# warnings as errors natively and for wasm (CI builds the dev profile, where code only the wasm target compiles is
# checked too), and the tests in the dev profile, where overflow checks are on.
#   bash scripts/check-rust.sh                fmt + clippy on every crate (a minute or two)
#   bash scripts/check-rust.sh core graph     only those crates (core, graph, schedule, parquet)
#   bash scripts/check-rust.sh --test [...]   and their tests
set -euo pipefail
cd "$(dirname "$0")/.."
# One build directory for every crate (their dependencies overlap), without debug info or incremental caches, as CI
# builds (CARGO_INCREMENTAL=0): the checks need the compiler's verdict, not a debugger, and the disk is a fixed allowance.
export CARGO_TARGET_DIR="${SOLENOID_CHECK_TARGET:-$HOME/.cache/solenoid-check}"
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
# Every crate is checked even when one fails, so one crate's failure never hides another's verdict.
test=0 crates=()
for a in "$@"; do
  case "$a" in
    --test) test=1 ;;
    core|graph|schedule|parquet) crates+=("solenoid-$a") ;;
    *) echo "unknown argument: $a (crates: core graph schedule parquet; --test)"; exit 2 ;;
  esac
done
[ ${#crates[@]} -gt 0 ] || crates=(solenoid-parquet solenoid-schedule solenoid-core solenoid-graph)
failed=()
for c in "${crates[@]}"; do
  m="crates/$c/Cargo.toml"
  if cargo fmt --manifest-path "$m" --check \
    && cargo clippy --manifest-path "$m" --all-targets -q -- -D warnings \
    && { [ "$c" = solenoid-parquet ] || cargo clippy --manifest-path "$m" --target wasm32-unknown-unknown -q -- -D warnings; } \
    && { [ "$test" = 0 ] || cargo test --manifest-path "$m" -q; }; then
    echo "ok $c"
  else
    echo "FAILED $c"
    failed+=("$c")
  fi
done
[ ${#failed[@]} -eq 0 ] || { echo "failed: ${failed[*]}"; exit 1; }

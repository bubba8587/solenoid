# Bundle 10 — Decision models & scoring, made honest

**Source:** scope-features #17. **Verdict:** IN — minor, sequence LATE. **Depends on:**
bundle 09's Monte Carlo hook ("wiggle the weights" needs it) — do not pull this forward
of bundle 09.

## What exists today

A Decision Matrix node already exists. Arguably the lowest-stretch item in the whole
2.0 set — this bundle is small.

## The build

Wire the existing Decision Matrix node to a "wiggle the weights, watch the ranking"
panel/gesture, riding bundle 09's Monte Carlo run mode: perturb the weight inputs, re-run
the ranking many times, show whether the outcome (which option wins) is robust or fragile
to small weight changes. Pair with bundle 04's provenance ("here's exactly why vendor B
won") once that's available — not a hard dependency, just a natural pairing.

## Exit criteria

An existing Decision Matrix can be wired into bundle 09's Monte Carlo mode to answer
"does the ranking survive if I wiggle the weights?" as a compelling, small demo.

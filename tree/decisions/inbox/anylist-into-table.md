---
title: "A list output whose kind isn't known yet can be wired into a table input of a set kind"
proposed_ring: C
ask: human
date: 2026-10-29
parents:
  - "[[C10]]"
---
## Decision

Checked against the code on 2026-10-29. A list output of no set kind (a node's list output before anything wired into the node has given it one) can be wired into a Frame input or a table input that takes any kind, but not into a table input of a set kind, such as a number table. Every other output of unknown kind can: a single value of any kind, and "a value or a list", both wire into a number table and are checked when the value arrives. A number list wires into a number table too. Ratifying lets the unknown-kind list wire in the same way. Once its node is wired up, the list takes a kind and wires normally either way.

## Why

It's the one unknown-kind output refused, and nothing written says why.

## What ratifying means

- **Lean:** Ratify; it matches the other unknown-kind outputs.
- **Ratify:** The cable connects, and a wrong kind shows as an error when a value arrives.
- **Reject:** It stays refused, and the connection rules gain the reason.

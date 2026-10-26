---
title: "The app's colors are defined for wide-color screens"
proposed_ring: D
ask: human
made_by: ai
by: Claude
date: 2026-10-26
parents:
  - "[[B14]]"
---
## Decision

Define the accent colors for wide-color displays (the P3 range on many recent laptops and phones), with standard fallbacks. Today your Linux desktop app shows the colors vivid, because its engine stretches them to the screen, while a color-accurate browser such as Chrome shows them as defined, less vivid. After, color-accurate browsers on wide-color screens show the vivid look you tuned.

## Why

You prefer the vivid look. It isn't a simple swap: the app derives each color's shades from its standard value.

## What ratifying means

- **Lean:** Leave it until a color-accurate wide-color screen is your main one.
- **Ratify:** The palette gains wide-color values.
- **Reject:** Standard colors stay.

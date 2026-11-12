---
aliases: ["Motion graphics"]
tags: [spec]
---
<!-- [[B3]] -->

# Spec: Motion graphics

Serves [[B3]] sameNodeEverywhere. Motion graphics are the animated and 3D shots of node cards made for marketing. Plain screen recordings of the app are the `demo-video` skill's job; this spec covers only clips that take cards apart.

## The rebuild

A motion clip may take a card apart and build it back in a 3D renderer (three.js), instead of filming the app. Every box, border, radius, SVG shape, glyph and color in the clip comes from the live app's own layout, read off the page, and never from a hand-drawn copy. The app does the layout; the player only moves the pieces.

## The rest frame

Each clip ends with every piece back where the app put it. That rest frame holds up side by side against the app's own screenshot of the same graph and state, and `render.mjs --check` holds it there.

## The pipeline

The code is `scripts/motion/`, and the `motion` skill says how to run it. `capture.mjs` reads every card off the live page, `export.py` turns what it read into geometry, and `player.js` and the clips render it. The rebuild would be unnecessary if the real components could be rendered straight into the engine with the same freedom (per-part motion, depth).

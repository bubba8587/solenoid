<!-- [[B3]] -->
# Motion graphics

## Motion graphics may rebuild cards in 3D from the app's own geometry, ending exactly as the app draws

Motion graphics may take a card apart and build it back in a 3D renderer (three.js), instead of filming the app. Every box, border, radius, SVG shape, glyph and color comes from the live app's own layout, read off the page, and never from a hand-drawn copy. Each clip must end with every piece back where the app put it, and that rest frame must hold up side by side against the app's own screenshot of the same graph and state.

- How it works: scripts/motion/ (capture.mjs reads the page; export.py turns it into geometry; player.js and the clips render it; render.mjs --check holds the rest frame against the app); the motion skill.
- Plain filming stays the demo-video skill's job.
- **Reopen if:** the real components can be rendered straight into the engine with the same freedom (per-part motion, depth), which would make the rebuild unnecessary.

# Custom-widget packs — the surviving architecture rule

This was the input/control/visual node-menu proposal. Its chart menu is
history: most of it shipped, and its "needs a heavy renderer (ECharts/Plotly)"
analysis was SUPERSEDED by the canvas-drawn figure approach (the 2026-07-16
chart wave — Contour, Waterfall, Candlestick, Boxplot, Calendar, Waffle,
Vector Field — draws on `<canvas>` like SurfaceView, zero new dependencies).
Do not resurrect the ECharts-dependency plan from here.

What survives is the pack-architecture rule for widget packs, cited by
`pack-architecture.md`:

## Custom-widget packs ship real code and can't degrade

The pack architecture's cheap default ("a pack node is a pre-set Expression
node, just data") does NOT apply to charts/input widgets. They are the declared
exception: "needs a custom widget or behavior the node toolkit doesn't
provide." So a viz pack ships real node code (a class + a React component + a
registry entry), and — unlike a formula pack — its nodes cannot degrade
gracefully to a live computation when the pack is off: a dormant viz node falls
back to a harmless placeholder (it was a pass-through sink anyway, so the DATA
still flows — only the picture disappears). `packs.ts` supports this:
`PackPlacement.entry.create` takes an arbitrary node constructor, and every
pack's constructors are always registered so saved files still load.

Tie-breaker for a borderline widget: does it render on existing in-repo
machinery (recharts / the canvas-figure kit), or pull in a heavy new renderer?
In-repo → can be core or a no-new-dep pack. A genuinely new heavy renderer →
pack, behind that optional dependency, lazy-loaded (the Mermaid pattern).

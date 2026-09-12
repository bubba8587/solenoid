// The figure's stylesheet, injected once with the component. Every color is an app design
// token (var(--…)), which resolves in inline SVG because the figure lives in the document —
// so the on-screen figure needs no color resolution; only the headless ganttSvg serializer
// takes concrete colors. Critical/violated/late carry a non-color cue (dash, outline) for
// WCAG 1.4.1. Reduced motion is honored (there is no motion to begin with; guarded anyway).

export const ganttStyles = `
.solenoid-gantt {
  display: flex;
  position: relative;
  overflow: hidden;
  background: var(--surface, #1e1e1e);
  color: var(--text, #e8e8e8);
  border: 1px solid var(--border, #2d2d2d);
  border-radius: 4px;
  font-family: var(--font-sans, system-ui, sans-serif);
  box-sizing: border-box;
}
.solenoid-gantt *, .solenoid-gantt *::before, .solenoid-gantt *::after { box-sizing: border-box; }

/* Grid pane */
.solenoid-gantt__grid { flex: 0 0 auto; display: flex; flex-direction: column; overflow: hidden; border-right: 1px solid var(--border-strong, #3a3a3a); }
.solenoid-gantt__grid-head { display: flex; align-items: flex-end; border-bottom: 1px solid var(--border-strong, #3a3a3a); background: var(--surface-raised, #262626); }
.solenoid-gantt__gh { padding: 0 6px 4px; font-size: 10px; color: var(--text-dim, #9aa0a6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 0 0 auto; }
.solenoid-gantt__grid-scroll { overflow-y: auto; overflow-x: hidden; }
.solenoid-gantt__row { position: absolute; left: 0; right: 0; display: flex; align-items: center; border-bottom: 1px solid var(--border-subtle, #2a2a2a); outline: none; cursor: default; }
.solenoid-gantt__row.is-summary { font-weight: 600; }
.solenoid-gantt__row.is-focused { background: color-mix(in srgb, var(--accent, #56b4e9) 14%, transparent); }
.solenoid-gantt__row:focus-visible { outline: 2px solid var(--accent, #56b4e9); outline-offset: -2px; }
.solenoid-gantt__caret { display: inline-block; width: 12px; flex: 0 0 12px; text-align: center; color: var(--text-dim, #9aa0a6); cursor: pointer; user-select: none; font-size: 0.8em; }
.solenoid-gantt__caret:hover { color: var(--text, #e8e8e8); }
.solenoid-gantt__cell { padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11px; flex: 0 0 auto; }
.solenoid-gantt__cell.is-num { font-family: var(--font-mono, ui-monospace, monospace); color: var(--text-dim, #9aa0a6); }
.solenoid-gantt__cell.is-name { color: var(--text, #e8e8e8); }
.solenoid-gantt__section { position: absolute; left: 0; right: 0; display: flex; align-items: center; padding: 0 8px; font-size: 11px; font-weight: 600; color: var(--text, #e8e8e8); background: var(--surface-raised, #262626); border-bottom: 1px solid var(--border, #2d2d2d); }
.solenoid-gantt__more { position: absolute; left: 0; right: 0; padding: 4px 8px; font-size: 10px; color: var(--text-dim, #9aa0a6); font-style: italic; }

/* Splitter */
.solenoid-gantt__splitter { flex: 0 0 5px; margin-left: -3px; cursor: col-resize; background: transparent; z-index: 3; }
.solenoid-gantt__splitter:hover { background: color-mix(in srgb, var(--accent, #56b4e9) 40%, transparent); }

/* Timeline pane */
.solenoid-gantt__timeline { flex: 1 1 auto; overflow: auto; position: relative; }
.solenoid-gantt__thead { position: sticky; top: 0; z-index: 2; background: var(--surface-raised, #262626); border-bottom: 1px solid var(--border-strong, #3a3a3a); }
.solenoid-gantt__tier { position: absolute; left: 0; right: 0; }
.solenoid-gantt__tcell { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; padding: 0 4px; font-size: 10px; color: var(--text-dim, #9aa0a6); white-space: nowrap; overflow: hidden; border-left: 1px solid var(--border, #2d2d2d); border-bottom: 1px solid var(--border-subtle, #2a2a2a); }

.solenoid-gantt__bg, .solenoid-gantt__bars { position: absolute; left: 0; pointer-events: none; }
/* The links overlay must NOT set pointer-events:none, or its hit paths go dead. An SVG with
   no painted background captures only on its painted children, so empty regions pass through. */
.solenoid-gantt__links { position: absolute; left: 0; }
.solenoid-gantt__link, .solenoid-gantt__arrow { pointer-events: none; }

/* Shading + grid + markers */
.solenoid-gantt__weekend { fill: var(--border-subtle, #2a2a2a); opacity: 0.5; }
.solenoid-gantt__holiday { fill: color-mix(in srgb, var(--sol-error, #e0473a) 16%, transparent); }
.solenoid-gantt__gridline { stroke: var(--border-subtle, #2a2a2a); stroke-width: 1; }
.solenoid-gantt__today { stroke: var(--sol-error, #e0473a); stroke-width: 1.5; }
.solenoid-gantt__status { stroke: var(--accent, #56b4e9); stroke-width: 1.5; stroke-dasharray: 2 2; }

/* Bars */
.solenoid-gantt__bar { fill: var(--accent, #56b4e9); opacity: 0.85; }
.solenoid-gantt__bar.is-critical { fill: var(--sol-error, #e0473a); opacity: 0.9; }
.solenoid-gantt__progress { fill: color-mix(in srgb, var(--accent, #56b4e9) 55%, #000); }
.solenoid-gantt__progress.is-critical { fill: color-mix(in srgb, var(--sol-error, #e0473a) 45%, #000); }
.solenoid-gantt__bar-flag { fill: none; stroke: var(--sol-error, #e0473a); stroke-width: 1.5; }
.solenoid-gantt__hatch { stroke: rgba(0, 0, 0, 0.32); stroke-width: 1.2; }
.solenoid-gantt__crit-hatch { pointer-events: none; }
.solenoid-gantt__crit-outline { fill: none; stroke: color-mix(in srgb, var(--sol-error, #e0473a) 45%, #000); stroke-width: 1; }
.solenoid-gantt__baseline { fill: color-mix(in srgb, var(--text-dim, #9aa0a6) 55%, transparent); }
.solenoid-gantt__deadline line { stroke: var(--text-dim, #9aa0a6); stroke-width: 1; }
.solenoid-gantt__deadline path { fill: var(--text-dim, #9aa0a6); }
.solenoid-gantt__deadline.is-late line { stroke: var(--sol-error, #e0473a); }
.solenoid-gantt__deadline.is-late path { fill: var(--sol-error, #e0473a); }
.solenoid-gantt__pin line { stroke: var(--text, #e8e8e8); stroke-width: 1; }
.solenoid-gantt__pin circle { fill: var(--text, #e8e8e8); stroke: var(--surface, #1e1e1e); stroke-width: 0.75; }
.solenoid-gantt__bracket { fill: var(--text-dim, #9aa0a6); }
.solenoid-gantt__bracket.is-critical { fill: var(--sol-error, #e0473a); }
.solenoid-gantt__diamond { fill: var(--text, #e8e8e8); }
.solenoid-gantt__diamond.is-critical { fill: var(--sol-error, #e0473a); }
.solenoid-gantt__diamond.is-violated { stroke: var(--sol-error, #e0473a); stroke-width: 1.5; }
.solenoid-gantt__blabel { fill: var(--text, #e8e8e8); font-size: 11px; }

/* Links */
.solenoid-gantt__link { stroke: var(--text-dim, #9aa0a6); stroke-width: 1.3; }
.solenoid-gantt__link.is-critical { stroke: var(--sol-error, #e0473a); }
.solenoid-gantt__link.is-violated { stroke: var(--sol-error, #e0473a); }
.solenoid-gantt__arrow { fill: var(--text-dim, #9aa0a6); stroke: none; }
.solenoid-gantt__arrow.is-critical, .solenoid-gantt__arrow.is-violated { fill: var(--sol-error, #e0473a); }
.solenoid-gantt__hit { stroke: transparent; stroke-width: 10; pointer-events: stroke; }
.solenoid-gantt__hit:hover + .solenoid-gantt__link { stroke-width: 2.2; }

@media (prefers-reduced-motion: reduce) {
  .solenoid-gantt * { transition: none !important; animation: none !important; }
}
`;

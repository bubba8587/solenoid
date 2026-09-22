// [[C107]] obsidianPlugin
// The Solenoid look's color tokens, derived from palette.ts the way the chips' are (themeVars),
// so look.css authors no hex and a palette swap is a change of values only. The build appends
// one block per built-in palette and mode to styles.css, under the class main.tsx puts on the
// body for the chosen palette; the demo vault's snippet gets the Default palette's two blocks.
import { paletteStore, PALETTE_NAMES, resolveColor, themeAccent, contrastInk, hexToHsl, DEFAULT_CHROME, chromeCssVars, type PaletteName } from "../../src/graph/palette";
import { themeVars, type ThemeMode } from "../../src/graph/themeVars";

export const LOOK_CLASS = "solenoid-look";

/** The body class for a palette: `solenoid-palette-colorblind-safe`. */
export function paletteClass(name: string): string {
  return `solenoid-palette-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

const ACCENT_SLOT = "gold";

/** The workbench: the look's name for each of the app's chrome tokens. */
const CHROME: [string, string][] = [
  ["--sol-app-bg", "--app-bg"], ["--sol-canvas", "--canvas-bg"], ["--sol-canvas-dot", "--canvas-dot"],
  ["--sol-surface", "--surface"], ["--sol-sunken", "--surface-sunken"], ["--sol-raised", "--surface-raised"],
  ["--sol-border", "--border"], ["--sol-border-strong", "--border-strong"], ["--sol-border-subtle", "--border-subtle"],
  ["--sol-text", "--text"], ["--sol-text-bright", "--text-bright"], ["--sol-text-dim", "--text-dim"], ["--sol-text-muted", "--text-muted"],
  ["--sol-overlay-border", "--overlay-border"], ["--sol-btn-hover", "--btn-hover"],
];
/** The typed hues the socket vars carry (array and matrix shades included). */
const SOCKETS = ["number", "list", "table", "string", "strlist", "strtable", "date", "datelist", "datetable", "complex", "complexlist", "complextable", "logical", "logicallist", "logicaltable", "frame", "lambda", "any"];
/** Slots the look uses that no socket wears. */
const SLOTS = ["amber", "blue", "teal"];
/** Obsidian's named colors, and the hue each takes. */
const NAMED: [string, string][] = [["red", "error"], ["orange", "amber"], ["yellow", "number"], ["green", "lambda"], ["cyan", "complex"], ["blue", "blue"], ["purple", "frame"], ["pink", "date"]];

const rgb = (hex: string): string => hex.slice(1).match(/../g)!.map((h) => parseInt(h, 16)).join(", ");

/** Every color token of the look for one palette in one mode. Sets the palette store's base
 *  for the duration and puts it back. */
export function lookTokens(name: PaletteName, mode: ThemeMode): Record<string, string> {
  const was = paletteStore.activeBase();
  paletteStore.setActiveBase(name);
  try {
    const vars = themeVars(ACCENT_SLOT, mode);
    // A palette that authors no ramp leaves the chrome null (in the app, App.css answers).
    const neutral = chromeCssVars(DEFAULT_CHROME[mode], mode);
    const out: Record<string, string> = {};
    for (const [sol, app] of CHROME) out[sol] = vars[app] ?? neutral[app];
    const accent = themeAccent(resolveColor(ACCENT_SLOT), mode);
    out["--sol-accent"] = accent;
    out["--sol-accent-ink"] = contrastInk(accent);
    const [h, s, l] = hexToHsl(accent);
    out["--accent-h"] = `${Math.round(h)}`;
    out["--accent-s"] = `${Math.round(s * 100)}%`;
    out["--accent-l"] = `${Math.round(l * 100)}%`;
    for (const sock of SOCKETS) out[`--sol-${sock}`] = vars[`--sock-${sock}`]!;
    for (const slot of SLOTS) out[`--sol-${slot}`] = themeAccent(resolveColor(slot), mode);
    out["--sol-error"] = vars["--sol-error"]!;
    for (const [color, hue] of NAMED) out[`--color-${color}-rgb`] = rgb(out[`--sol-${hue}`]);
    return out;
  } finally {
    paletteStore.setActiveBase(was);
  }
}

function block(selector: string, tokens: Record<string, string>): string {
  return `${selector} {\n${Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join("\n")}\n}\n`;
}

/** The Default palette's tokens on the body's own mode classes: what the snippet carries. */
export function defaultLookCss(): string {
  return "\n/* The Default palette's tokens, derived from palette.ts by lookTokens.ts (npm run plugin:build). */\n" +
    block(".theme-dark", lookTokens("Default", "dark")) + block(".theme-light", lookTokens("Default", "light"));
}

/** Every built-in palette's tokens, each under the class main.tsx sets for it. */
export function paletteLookCss(): string {
  let css = "\n/* One block per palette and mode, derived from palette.ts by lookTokens.ts. */\n";
  for (const name of PALETTE_NAMES) {
    for (const mode of ["dark", "light"] as const) css += block(`body.${LOOK_CLASS}.${paletteClass(name)}.theme-${mode}`, lookTokens(name, mode));
  }
  return css;
}

// [[C107]] obsidianPlugin
// The Solenoid look's color tokens, derived from palette.ts the way the chips' are (themeVars),
// so look.css authors no hex and a palette or accent swap is a change of values only. The build
// appends one block per built-in palette and mode, then one per palette, accent and mode, to
// styles.css, under the classes main.tsx puts on the body for the chosen palette and accent; the
// demo vault's snippet gets the Default palette's two blocks under the gold accent.
import { paletteStore, PALETTE_NAMES, COLOR_PALETTE, NEUTRAL_WHITE, NEUTRAL_DARK, CHROME_HOME, resolveColor, themeAccent, contrastInk, hexToHsl, hexToOklch, DEFAULT_CHROME, chromeCssVars, type PaletteName } from "../../src/graph/palette";
import { themeVars, type ThemeMode } from "../../src/graph/themeVars";

export const LOOK_CLASS = "solenoid-look";

/** The body class for a palette: `solenoid-palette-colorblind-safe`. */
export function paletteClass(name: string): string {
  return `solenoid-palette-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
/** The body class for an accent: `solenoid-accent-blue`, `solenoid-accent-neutral-dark`. */
export function accentClass(slot: string): string {
  return `solenoid-accent-${slot}`;
}

/** Every accent the swatch grid can pick: the twelve slots, and the gray swatch's two
 *  fixed neutrals ([[C62]]: the neutral cycle). */
export const ACCENT_SLOTS: readonly string[] = [...COLOR_PALETTE, NEUTRAL_WHITE, NEUTRAL_DARK];
export const DEFAULT_ACCENT = "gold";
export const isAccentSlot = (slot: unknown): slot is string => typeof slot === "string" && ACCENT_SLOTS.includes(slot);

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

/** The tokens that move with the accent: its color, its ink, Obsidian's HSL of it, and the
 *  accent AS text. */
const ACCENT_TOKENS = ["--sol-accent", "--sol-accent-ink", "--accent-h", "--accent-s", "--accent-l", "--sol-ink-accent"];

/** A yellow: it cannot reach text contrast on white, and darkened it is brown (look.css, the
 *  light-mode ink rule, which names gold and lime; this is that rule by hue). */
function isYellow(hex: string): boolean {
  const [, c, h] = hexToOklch(hex);
  const hue = ((h % 360) + 360) % 360;
  return c > 0.05 && hue >= 70 && hue <= 125;
}
/** A palette whose chrome ramp follows the accent's hue ([[C62]], `CHROME_HOME`). */
const isAdaptive = (name: PaletteName): boolean => CHROME_HOME[name] !== undefined;

/** Every color token of the look for one palette, accent and mode. Sets the palette store's
 *  base for the duration and puts it back. */
export function lookTokens(name: PaletteName, accent: string, mode: ThemeMode): Record<string, string> {
  const was = paletteStore.activeBase();
  paletteStore.setActiveBase(name);
  try {
    const vars = themeVars(accent, mode);
    // A palette that authors no ramp leaves the chrome null (in the app, App.css answers).
    const neutral = chromeCssVars(DEFAULT_CHROME[mode], mode);
    const out: Record<string, string> = {};
    for (const [sol, app] of CHROME) out[sol] = vars[app] ?? neutral[app];
    const accentHex = themeAccent(resolveColor(accent), mode);
    out["--sol-accent"] = accentHex;
    out["--sol-accent-ink"] = contrastInk(accentHex);
    const [h, s, l] = hexToHsl(accentHex);
    out["--accent-h"] = `${Math.round(h)}`;
    out["--accent-s"] = `${Math.round(s * 100)}%`;
    out["--accent-l"] = `${Math.round(l * 100)}%`;
    // The accent as text (links, the active item, the h1): itself on the dark workbench; on
    // white, the look's rule: a yellow is the ink, any other hue darkens along its own hue.
    out["--sol-ink-accent"] = mode === "dark" ? "var(--sol-accent)" : isYellow(accentHex) ? "var(--sol-text)" : "oklch(from var(--sol-accent) 0.45 c h)";
    for (const sock of SOCKETS) out[`--sol-${sock}`] = vars[`--sock-${sock}`]!;
    // The ink that reads on each hue as a fill (a light-mode property badge): the chips' rule.
    for (const sock of SOCKETS) out[`--sol-ink-on-${sock}`] = contrastInk(out[`--sol-${sock}`]);
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
const pick = (tokens: Record<string, string>, keep: (name: string) => boolean): Record<string, string> =>
  Object.fromEntries(Object.entries(tokens).filter(([name]) => keep(name)));

/** The palette's own tokens: everything the accent does not move. For an adaptive palette the
 *  chrome moves with the accent too, so it leaves this block for the accent's. */
export function paletteTokens(name: PaletteName, mode: ThemeMode): Record<string, string> {
  const chrome = new Set(CHROME.map(([sol]) => sol));
  return pick(lookTokens(name, DEFAULT_ACCENT, mode), (t) => !ACCENT_TOKENS.includes(t) && !(isAdaptive(name) && chrome.has(t)));
}
/** What one accent sets under one palette: its color, ink and HSL, and an adaptive palette's chrome. */
export function accentTokens(name: PaletteName, accent: string, mode: ThemeMode): Record<string, string> {
  const chrome = new Set(CHROME.map(([sol]) => sol));
  return pick(lookTokens(name, accent, mode), (t) => ACCENT_TOKENS.includes(t) || (isAdaptive(name) && chrome.has(t)));
}

const MODES = ["dark", "light"] as const;

/** The Default palette's tokens under the gold accent, on the body's own mode classes: what
 *  the snippet carries. */
export function defaultLookCss(): string {
  return "\n/* The Default palette's tokens, derived from palette.ts by lookTokens.ts (npm run plugin:build). */\n" +
    MODES.map((mode) => block(`.theme-${mode}`, lookTokens("Default", DEFAULT_ACCENT, mode))).join("");
}

/** Every built-in palette's tokens under the palette's class, then every accent's under the
 *  palette's and the accent's classes; main.tsx sets all three beside the look class. */
export function paletteLookCss(): string {
  let css = "\n/* One block per palette and mode, then one per palette, accent and mode, derived from palette.ts by lookTokens.ts. */\n";
  for (const name of PALETTE_NAMES) {
    for (const mode of MODES) css += block(`body.${LOOK_CLASS}.${paletteClass(name)}.theme-${mode}`, paletteTokens(name, mode));
  }
  for (const name of PALETTE_NAMES) {
    for (const accent of ACCENT_SLOTS) {
      for (const mode of MODES) css += block(`body.${LOOK_CLASS}.${paletteClass(name)}.${accentClass(accent)}.theme-${mode}`, accentTokens(name, accent, mode));
    }
  }
  return css;
}

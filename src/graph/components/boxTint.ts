// [[components#One design system governs every look, layout and word in the app]] (DESIGN.md § The Quiet Accent Rule: a user-authored color)
import type { CSSProperties } from "react";
import { PALETTE, themeAccent, resolveColor, contrastInk, darkenAccent, hexToRgba } from "../palette";

/**
 * A Group's colors ([[C88]] collapsedGroupCard's header and fill, GroupNode.tsx), as CSS variables for any box that
 * wears them (a Dashboard box, a Record card): a solid header in the color with contrast ink (`--box-color`,
 * `--box-ink`), a border darkened in light mode (`--box-border`), and the body washed with the color (`--box-fill`).
 */
export function boxTintVars(base: string, mode: "dark" | "light"): CSSProperties {
  const color = themeAccent(base, mode);
  return {
    "--box-color": color,
    "--box-ink": contrastInk(color),
    "--box-border": mode === "light" ? darkenAccent(base) : color,
    "--box-fill": hexToRgba(color, mode === "light" ? 0.14 : 0.08),
  } as CSSProperties;
}

/** The base color a cell names: a hex color (`#d94f3d`, `#abc`) or a palette slot by its name (`blue`, `vermilion`),
 *  else none. */
export function namedColor(text: string): string | null {
  const t = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t);
  if (hex) return hex[1].length === 3 ? `#${[...hex[1]].map((d) => d + d).join("")}` : t;
  const slot = t.toLowerCase();
  return Object.prototype.hasOwnProperty.call(PALETTE, slot) ? resolveColor(slot) : null;
}

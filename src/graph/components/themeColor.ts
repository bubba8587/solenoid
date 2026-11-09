// [[B14]] oneDesignSystem

/**
 * A theme variable as a plain color a canvas or an SVG attribute can use. The chrome writes its ramp as
 * `light-dark(…)`, which a canvas ignores (keeping its last fill), so such a value resolves through a hidden probe's
 * computed color, inside `within` so it takes that element's color scheme.
 */
export function themeColor(name: string, fallback: string, within: Element = document.documentElement): string {
  const raw = getComputedStyle(within).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (!/light-dark\(|var\(|color-mix\(/.test(raw)) return raw;
  const host = within instanceof HTMLCanvasElement ? (within.parentElement ?? document.body) : within;
  const probe = document.createElement("span");
  probe.style.setProperty("color", `var(${name})`);
  probe.hidden = true;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || fallback;
}

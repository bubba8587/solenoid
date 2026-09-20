// [[C107]] obsidianPlugin
// A list or matrix wears Obsidian's own icon (its List property's, its table view's). A frame and
// a cube have no Obsidian counterpart, so they keep their socket glyph's outline
// (SocketLegend.tsx, cubeGlyph.tsx), in currentColor on the icon slot's 100-unit box.
import type { Shape } from "./yamlValue";

const BOX = (inner: string) =>
  `<g transform="translate(14 14) scale(6)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">` +
  `<rect x="1" y="1" width="10" height="10" rx="1" stroke-width="1.4"/>${inner}</g>`;

const CUBE_SEAMS = "M120,120l87.206,-50.349m-87.206,50.349l-87.205,-50.346m87.205,50.346l-0.001,100.695";
const CUBE_RING = "M214.148,65.644l-0.001,108.71l-94.148,54.356l-94.147,-54.354l0.001,-108.71l94.148,-54.356l94.147,54.354Z";

/** Icons the plugin registers with `addIcon`. */
export const CUSTOM_ICONS: Record<string, string> = {
  "solenoid-frame": BOX(`<path d="M4.15 8.9V3.9H8.95M4.15 6.2H8.15" stroke-width="1.3"/>`),
  "solenoid-cube":
    `<g transform="translate(50 50) scale(0.36) translate(-120 -120)" fill="none" stroke="currentColor" stroke-width="24" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${CUBE_SEAMS}"/><path d="${CUBE_RING}"/></g>`,
};

export const SHAPE_ICON: Record<Shape, string> = {
  list: "lucide-list",
  matrix: "lucide-table",
  frame: "solenoid-frame",
  cube: "solenoid-cube",
};

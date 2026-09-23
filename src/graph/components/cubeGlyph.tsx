// [[C11]] socketBox12
// 240-unit paths drawn deliberately oversized in the 12×12 box, so the socket SVG must paint overflow-visible.

export const CUBE_FILL_PATH = "M223.007,60.529l0.038,119.008l-103.007,59.471l-103.045,-59.537l-0.038,-119.008l103.007,-59.471l103.045,59.537Z";
const CUBE_SEAMS_PATH = "M120,120l87.206,-50.349m-87.206,50.349l-87.205,-50.346m87.205,50.346l-0.001,100.695";
const CUBE_RING_PATH = "M214.148,65.644l-0.001,108.71l-94.148,54.356l-94.147,-54.354l0.001,-108.71l94.148,-54.356l94.147,54.354Z";

// 0.05 maps 240 -> 12 (exact box); larger overflows it.
const CUBE_SCALE = 0.056;
// `dy` is per-call, not baked in: the live socket needs +2px to center on its row, the legend 0.
export function cubeTransform(dy = 0): string {
  return `translate(6 ${6 + dy}) scale(${CUBE_SCALE}) translate(-120 -120)`;
}
// Source-space stroke, thinned so the larger scale doesn't thicken it.
const CUBE_STROKE_WIDTH = 26;

export function CubeGlyphFaces({ fill, dy = 0 }: { fill: string; dy?: number }) {
  // `--socket-ring` from the ancestor darkens the cube by the same step as every glyph.
  const stroke = "var(--socket-ring)";
  return (
    <g transform={cubeTransform(dy)}>
      <path d={CUBE_FILL_PATH} fill={fill} fillRule="nonzero" />
      <path d={CUBE_SEAMS_PATH} fill="none" stroke={stroke} strokeWidth={CUBE_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path d={CUBE_RING_PATH} fill="none" stroke={stroke} strokeWidth={CUBE_STROKE_WIDTH} strokeLinecap="butt" strokeLinejoin="round" />
    </g>
  );
}

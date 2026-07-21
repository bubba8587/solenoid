// Single source for the cube socket glyph (author-drawn — assets/cube-socket-glyph.svg).
// Used by the live socket (SocketComponent), the legend (SocketLegend), and the
// hover highlight (NodeSocket). Tuning the scale / stroke here keeps all three in
// sync. The source paths are in a 240-unit space centered on (120,120); the
// transform maps that center to (6,6) of the 12x12 socket box and scales it.
//
// The cube is OVERSIZED past the 12-box so a hexagon reads the same perceived size
// as the circle/square sockets (a hexagon in the same bounds looks smaller). It
// overflows the box top/bottom, so the socket SVG must paint overflow-visible
// (see socket.css .solenoid-socket-dot). Bump CUBE_SCALE up to grow it; the stroke
// is set so it does NOT thicken as it grows.

export const CUBE_FILL_PATH = "M223.007,60.529l0.038,119.008l-103.007,59.471l-103.045,-59.537l-0.038,-119.008l103.007,-59.471l103.045,59.537Z";
const CUBE_SEAMS_PATH = "M120,120l87.206,-50.349m-87.206,50.349l-87.205,-50.346m87.205,50.346l-0.001,100.695";
const CUBE_RING_PATH = "M214.148,65.644l-0.001,108.71l-94.148,54.356l-94.147,-54.354l0.001,-108.71l94.148,-54.356l94.147,54.354Z";

// 0.05 maps 240 -> 12 (exact box). Larger oversizes it past the box (top/bottom
// extend beyond — needs overflow-visible on the socket SVG).
const CUBE_SCALE = 0.056;
// Centre-anchored (on 6,6) so growing it stays centred. `dy` nudges it down: the
// live socket needs +2px to sit centred on the row, but the legend (centred in its
// own padded box) does NOT — so dy is per-call, not baked into the transform.
export function cubeTransform(dy = 0): string {
  return `translate(6 ${6 + dy}) scale(${CUBE_SCALE}) translate(-120 -120)`;
}
// Source-space stroke; bumped down so the bigger scale doesn't thicken it.
const CUBE_STROKE_WIDTH = 26;

/** The cube's faces: filled silhouette + opaque matching seams + ring. `dy` shifts
 *  it down (the live socket passes 2; the legend leaves it 0). */
export function CubeGlyphFaces({ fill, dy = 0 }: { fill: string; dy?: number }) {
  // The seams/ring are a darker shade of the fill, so the edges track any palette
  // the socket is drawn in.
  // color-mix (not a JS shade helper) because `fill` is usually a CSS var, not a hex.
  const stroke = `color-mix(in srgb, ${fill} 72%, #000)`;
  return (
    <g transform={cubeTransform(dy)}>
      <path d={CUBE_FILL_PATH} fill={fill} fillRule="nonzero" />
      <path d={CUBE_SEAMS_PATH} fill="none" stroke={stroke} strokeWidth={CUBE_STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path d={CUBE_RING_PATH} fill="none" stroke={stroke} strokeWidth={CUBE_STROKE_WIDTH} strokeLinecap="butt" strokeLinejoin="round" />
    </g>
  );
}

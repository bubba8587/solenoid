import type { RGBA } from "./cssColor";

// Per-instance packing for the WebGPU node-card renderer — NOT WIRED by itself.
// One instanced unit quad per card; the fragment shader does the rounded-rect SDF.
//
// Per-instance layout — FLOATS_PER_INSTANCE floats:
//   [ x, y, w, h,                      // world rect (top-left + size)
//     bodyR,bodyG,bodyB,bodyA,         // body fill (0..1, premultiplied at draw)
//     headR,headG,headB,headA,         // header bar fill
//     radius, headerH ]                // corner radius + header-bar height (world units)

export const FLOATS_PER_INSTANCE = 14;

export interface NodeCard {
  x: number; y: number; w: number; h: number;
  body: RGBA;   // 0..255 / a 0..1
  header: RGBA;
  radius: number;
  headerH: number;
}

/** Pack node cards into the interleaved instance array. Colors are normalized to
 *  0..1 and PREMULTIPLIED by alpha (the renderer uses premultiplied-alpha blending). */
export function packNodeInstances(cards: NodeCard[]): Float32Array {
  const out = new Float32Array(cards.length * FLOATS_PER_INSTANCE);
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const o = i * FLOATS_PER_INSTANCE;
    out[o] = c.x; out[o + 1] = c.y; out[o + 2] = c.w; out[o + 3] = c.h;
    const ba = c.body.a;
    out[o + 4] = (c.body.r / 255) * ba; out[o + 5] = (c.body.g / 255) * ba;
    out[o + 6] = (c.body.b / 255) * ba; out[o + 7] = ba;
    const ha = c.header.a;
    out[o + 8] = (c.header.r / 255) * ha; out[o + 9] = (c.header.g / 255) * ha;
    out[o + 10] = (c.header.b / 255) * ha; out[o + 11] = ha;
    out[o + 12] = c.radius; out[o + 13] = c.headerH;
  }
  return out;
}

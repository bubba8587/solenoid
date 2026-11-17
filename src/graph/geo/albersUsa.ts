// [[C100]] chartIsAValue
// The US Map card's projection: d3-geo's `geoAlbersUsa` written out, so a pin and a border land where us-atlas's own
// pre-projected files put them. The lower 48 on one equal-area conic, Alaska and Hawaii each on their own, moved in under
// the southwest; a point none of the three frames holds is off the map.

const RAD = Math.PI / 180;

type Raw = (lon: number, lat: number) => [number, number];

function conicEqualArea(rotate: number, center: [number, number], parallels: [number, number], k: number, tx: number, ty: number): Raw {
  const sy0 = Math.sin(parallels[0] * RAD);
  const n = (sy0 + Math.sin(parallels[1] * RAD)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (l: number, p: number): [number, number] => {
    const r = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(p))) / n;
    return [r * Math.sin(l * n), r0 - r * Math.cos(l * n)];
  };
  const [cx, cy] = raw(center[0] * RAD, center[1] * RAD);
  const dx = tx - cx * k, dy = ty + cy * k;
  return (lon, lat) => {
    let l = (lon + rotate) * RAD;
    l = l > Math.PI ? l - 2 * Math.PI : l < -Math.PI ? l + 2 * Math.PI : l;
    const [x, y] = raw(l, lat * RAD);
    return [dx + x * k, dy - y * k];
  };
}

/** The frame us-atlas's `*-albers-10m` files are drawn in. */
export const US_FRAME = { width: 975, height: 610 } as const;

export interface UsProjection {
  /** A point on the lower 48 conic, wherever it falls. */
  lower48: Raw;
  /** The point in whichever of the three frames holds it, or null when none does. */
  point: (lon: number, lat: number) => [number, number] | null;
  /** Which frame a projected outline belongs to: Alaska and Hawaii draw on their own conics. */
  forState: (fips: string) => Raw;
}

export function albersUsa(k = 1300, tx = US_FRAME.width / 2, ty = US_FRAME.height / 2): UsProjection {
  const lower48 = conicEqualArea(96, [-0.6, 38.7], [29.5, 45.5], k, tx, ty);
  const alaska = conicEqualArea(154, [-2, 58.5], [55, 65], k * 0.35, tx - 0.307 * k, ty + 0.201 * k);
  const hawaii = conicEqualArea(157, [-3, 19.9], [8, 18], k, tx - 0.205 * k, ty + 0.212 * k);
  const inBox = (p: [number, number], x0: number, y0: number, x1: number, y1: number) =>
    p[0] >= tx + x0 * k && p[0] <= tx + x1 * k && p[1] >= ty + y0 * k && p[1] <= ty + y1 * k;
  return {
    lower48,
    point(lon, lat) {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      const a = lower48(lon, lat);
      if (inBox(a, -0.455, -0.238, 0.455, 0.238)) return a;
      const b = alaska(lon, lat);
      if (inBox(b, -0.425, 0.12, -0.214, 0.234)) return b;
      const c = hawaii(lon, lat);
      if (inBox(c, -0.214, 0.166, -0.115, 0.234)) return c;
      return null;
    },
    forState: (fips) => (fips === "02" ? alaska : fips === "15" ? hawaii : lower48),
  };
}

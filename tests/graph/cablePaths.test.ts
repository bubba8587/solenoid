// [[A1]] visualGraphCalculator, [[cable-rendering-knobs#Diagonal and straight: the walk router]], [[cable-rendering-knobs#Spline]]
import { describe, expect, it } from "vitest";
import { fuzzRuns, fuzzSeed } from "./fuzzDepth";
import { getCablePath, draggedCableArgs, Position } from "../../src/graph/cablePaths";


type Pt = { x: number; y: number };
type Mode = "diagonal" | "straight";

// Reconstruct the route's vertex polyline from the SVG. Diagonal paths are
// pure M/L polylines: every point is a vertex. Straight paths have rounded
// corners: each Q's control point IS the original corner vertex, the L points
// before each Q merely sit on the segments, so vertices = M + Q controls +
// final endpoint.
function vertsFromPath(d: string): Pt[] {
  const re = /([MLQ])\s*([-\d.eE]+),([-\d.eE]+)(?:\s+([-\d.eE]+),([-\d.eE]+))?/g;
  const rounded = d.includes("Q");
  const verts: Pt[] = [];
  let last: Pt | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const p1 = { x: parseFloat(m[2]), y: parseFloat(m[3]) };
    if (m[1] === "M") {
      verts.push(p1);
      last = p1;
    } else if (m[1] === "L") {
      if (rounded) last = p1; // on-segment point; only the final one is a vertex
      else { verts.push(p1); last = p1; }
    } else {
      verts.push(p1); // Q control = original corner
      last = { x: parseFloat(m[4]), y: parseFloat(m[5]) };
    }
  }
  if (last && (verts.length === 0 ||
      Math.hypot(last.x - verts[verts.length - 1].x, last.y - verts[verts.length - 1].y) > 1e-9)) {
    verts.push(last);
  }
  return verts;
}

const segAngle = (a: Pt, b: Pt) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

// Distance from an angle to the nearest multiple of `grid` degrees.
function offGrid(angleDeg: number, grid: number): number {
  const m = ((angleDeg % grid) + grid) % grid;
  return Math.min(m, grid - m);
}

// Absolute turn between consecutive segments, in degrees (0..180).
function turnDeg(a: Pt, b: Pt, c: Pt): number {
  let t = segAngle(b, c) - segAngle(a, b);
  t = ((t % 360) + 360) % 360;
  return Math.min(t, 360 - t);
}

type Cfg = {
  sx: number; sy: number; tx: number; ty: number;
  sa: number | null; ta: number | null;
};

function route(mode: Mode, c: Cfg): Pt[] {
  return vertsFromPath(getCablePath(mode, {
    sourceX: c.sx, sourceY: c.sy, sourcePosition: Position.Right, sourceAngleDeg: c.sa,
    targetX: c.tx, targetY: c.ty, targetPosition: Position.Left, targetAngleDeg: c.ta,
  }));
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const STRAIGHT_THRESHOLD = 15;
const TOL = 0.6; // degrees of slack for float noise

function checkInvariants(mode: Mode, c: Cfg) {
  const pts = route(mode, c);
  const S = { x: c.sx, y: c.sy };
  const T = { x: c.tx, y: c.ty };
  const label = `${mode} ${JSON.stringify(c)}`;

  // endpoints exact
  expect(dist(pts[0], S), `start ${label}`).toBeLessThan(0.01);
  expect(dist(pts[pts.length - 1], T), `end ${label}`).toBeLessThan(0.01);

  // Allowed exception: near-touching sockets render as one straight segment.
  if (dist(S, T) < STRAIGHT_THRESHOLD) return;
  expect(pts.length, `stub count ${label}`).toBeGreaterThanOrEqual(2);

  // outward stubs along the socket directions
  const exitWant = c.sa ?? 0;
  const entryWant = c.ta ?? 0;
  expect(offGrid(segAngle(pts[0], pts[1]) - exitWant, 360), `exit dir ${label}`).toBeLessThan(TOL);
  expect(
    offGrid(segAngle(pts[pts.length - 2], pts[pts.length - 1]) - entryWant, 360),
    `entry dir ${label}`,
  ).toBeLessThan(TOL);

  // headings: interior segments on the mode's compass; stubs on the 15° hint grid.
  const compass = mode === "diagonal" ? 45 : 90;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = segAngle(pts[i], pts[i + 1]);
    const grid = i === 0 || i === pts.length - 2 ? 15 : compass;
    expect(offGrid(a, grid), `heading seg ${i} ${label}`).toBeLessThan(TOL);
  }

  // turns: diagonal ≤45; straight 90, or ≤45 at an off-grid stub junction.
  for (let i = 1; i < pts.length - 1; i++) {
    const t = turnDeg(pts[i - 1], pts[i], pts[i + 1]);
    if (mode === "diagonal") {
      expect(t, `turn at ${i} ${label}`).toBeLessThanOrEqual(45 + TOL);
    } else {
      expect(t, `turn at ${i} ${label}`).toBeLessThanOrEqual(90 + TOL);
      expect(t > 45 + TOL && t < 90 - TOL, `41-89 turn at ${i} ${label}`).toBe(false);
    }
  }
}

// Deterministic LCG so failures reproduce.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ANGLE_GRIDS = [null, 45, 15] as const;

function randomCfg(rnd: () => number): Cfg {
  const pickAngle = (): number | null => {
    const grid = ANGLE_GRIDS[Math.floor(rnd() * ANGLE_GRIDS.length)];
    if (grid == null) return null;
    return Math.floor(rnd() * (360 / grid)) * grid;
  };
  return {
    sx: (rnd() - 0.5) * 1000,
    sy: (rnd() - 0.5) * 1000,
    tx: (rnd() - 0.5) * 1000,
    ty: (rnd() - 0.5) * 1000,
    sa: pickAngle(),
    ta: pickAngle(),
  };
}

const EDGE_ANGLES = [null, 0, 45, 90, 135, 180, 225, 270, 315, 15, 105, 285];
const EDGE_OFFSETS = [
  [200, 0], [200, 50], [50, 200], [0, 200], [-200, 0], [-200, -50],
  [-50, -200], [120, 120], [16, 0], [0, 16], [18, 18], [400, 3], [3, 400],
];

// Sample both paths at matched normalized-arclength points and take the max
// gap — small per-step movement must produce small path movement.
function pathGap(a: Pt[], b: Pt[]): number {
  const sample = (pts: Pt[], t: number): Pt => {
    const lens: number[] = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const l = dist(pts[i], pts[i + 1]);
      lens.push(l);
      total += l;
    }
    if (total === 0) return pts[0];
    let want = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (want <= lens[i] || i === lens.length - 1) {
        const u = lens[i] === 0 ? 0 : want / lens[i];
        return {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * u,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * u,
        };
      }
      want -= lens[i];
    }
    return pts[pts.length - 1];
  };
  let worst = 0;
  for (let k = 0; k <= 64; k++) {
    worst = Math.max(worst, dist(sample(a, k / 64), sample(b, k / 64)));
  }
  return worst;
}

// Sweeps crossing walk-family boundaries (shallow→steep, in front → behind, around a rotated source arm), stopping short
// of the collinear head-on line.
const SWEEPS: { sa: number | null; ta: number | null; from: Pt; to: Pt }[] = [
  { sa: null, ta: null, from: { x: 300, y: -250 }, to: { x: 300, y: 250 } },
  { sa: null, ta: null, from: { x: 300, y: 40 }, to: { x: -300, y: 40 } },
  { sa: 45, ta: null, from: { x: 250, y: -200 }, to: { x: -250, y: 200 } },
  { sa: 270, ta: 90, from: { x: 200, y: 150 }, to: { x: 8, y: 150 } },
  { sa: 270, ta: 90, from: { x: -8, y: 150 }, to: { x: -200, y: 150 } },
  { sa: 15, ta: 105, from: { x: 260, y: -180 }, to: { x: 260, y: 180 } },
  { sa: 180, ta: null, from: { x: 150, y: 60 }, to: { x: 150, y: 300 } },
];

const polyLen = (pts: Pt[]) => {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += dist(pts[i], pts[i + 1]);
  return l;
};

function checkContinuity(mode: Mode) {
  const STEP = 0.5;
  for (const sw of SWEEPS) {
    const n = Math.ceil(Math.hypot(sw.to.x - sw.from.x, sw.to.y - sw.from.y) / STEP);
    let prev: Pt[] | null = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const cfg: Cfg = {
        sx: 0, sy: 0,
        tx: sw.from.x + (sw.to.x - sw.from.x) * t,
        ty: sw.from.y + (sw.to.y - sw.from.y) * t,
        sa: sw.sa, ta: sw.ta,
      };
      const pts = route(mode, cfg);
      // Not measured across the near-touching collapse.
      const nearCollapse = Math.hypot(cfg.tx, cfg.ty) < STRAIGHT_THRESHOLD + 2;
      if (prev && !nearCollapse && pathGap(prev, pts) >= 10) {
        // A large jump is allowed only as an equal-length route swap.
        const la = polyLen(prev), lb = polyLen(pts);
        expect(Math.abs(la - lb), `${mode} sweep ${JSON.stringify(sw)} step ${i} jumped between unequal routes (${la.toFixed(1)} vs ${lb.toFixed(1)})`)
          .toBeLessThan(Math.max(3, 0.02 * Math.max(la, lb)));
      }
      prev = nearCollapse ? null : pts;
    }
  }
}

for (const mode of ["diagonal", "straight"] as Mode[]) {
  describe(`${mode} walk router`, () => {
    it("holds the turn/heading invariants over random configurations", () => {
      const rnd = makeRng(fuzzSeed(0xC0FFEE, `${mode} walk router`));
      for (let i = 0; i < fuzzRuns(1500); i++) checkInvariants(mode, randomCfg(rnd));
    });

    it("holds the invariants at close / aligned / behind edge cases", () => {
      for (const sa of EDGE_ANGLES) {
        for (const ta of EDGE_ANGLES) {
          for (const [dx, dy] of EDGE_OFFSETS) {
            checkInvariants(mode, { sx: 0, sy: 0, tx: dx, ty: dy, sa, ta });
          }
        }
      }
    });

    it("morphs continuously while the target drags (no flicker)", () => {
      checkContinuity(mode);
    });
  });
}

describe("spline", () => {
  function spline(c: Cfg): string {
    return getCablePath("spline", {
      sourceX: c.sx, sourceY: c.sy, sourcePosition: Position.Right, sourceAngleDeg: c.sa,
      targetX: c.tx, targetY: c.ty, targetPosition: Position.Left, targetAngleDeg: c.ta,
    });
  }

  // Endpoint tangents of a cubic point along (c1 − start) and (end − c2).
  function parseCubic(d: string) {
    const m = /M\s*([-\d.eE]+),([-\d.eE]+)\s*C\s*([-\d.eE]+),([-\d.eE]+)\s+([-\d.eE]+),([-\d.eE]+)\s+([-\d.eE]+),([-\d.eE]+)/.exec(d);
    if (!m) return null;
    const [sx, sy, c1x, c1y, c2x, c2y, ex, ey] = m.slice(1).map(parseFloat);
    return {
      start: { x: sx, y: sy }, end: { x: ex, y: ey },
      exitDeg: segAngle({ x: sx, y: sy }, { x: c1x, y: c1y }),
      entryDeg: segAngle({ x: c2x, y: c2y }, { x: ex, y: ey }),
    };
  }

  it("does not collapse for merely axis-aligned sockets (Conduit-below case)", () => {
    // A 0° Conduit with a rotated Conduit directly below: dx = 0.
    const cu = parseCubic(spline({ sx: 0, sy: 0, tx: 0, ty: 250, sa: 0, ta: 270 }));
    expect(offGrid(cu!.exitDeg - 0, 360)).toBeLessThan(TOL);
    expect(offGrid(cu!.entryDeg - 270, 360)).toBeLessThan(TOL);
    // Plain cables flat in one axis but long in the other also stay curves.
    expect(parseCubic(spline({ sx: 0, sy: 0, tx: 300, ty: 5, sa: null, ta: null }))).not.toBeNull();
    expect(parseCubic(spline({ sx: 0, sy: 0, tx: -250, ty: 3, sa: null, ta: null }))).not.toBeNull();
  });

  it("is tangent-exact at both sockets for hinted and plain endpoints", () => {
    const cases: Cfg[] = [
      { sx: 0, sy: 0, tx: 200, ty: 120, sa: 45, ta: 315 },
      { sx: 0, sy: 0, tx: -150, ty: 220, sa: 15, ta: 105 },
      { sx: 0, sy: 0, tx: 180, ty: -90, sa: null, ta: null },
    ];
    for (const c of cases) {
      const cu = parseCubic(spline(c));
      expect(offGrid(cu!.exitDeg - (c.sa ?? 0), 360), `exit ${JSON.stringify(c)}`).toBeLessThan(TOL);
      expect(offGrid(cu!.entryDeg - (c.ta ?? 0), 360), `entry ${JSON.stringify(c)}`).toBeLessThan(TOL);
      expect(dist(cu!.start, { x: c.sx, y: c.sy })).toBeLessThan(0.01);
      expect(dist(cu!.end, { x: c.tx, y: c.ty })).toBeLessThan(0.01);
    }
  });

  it("bends back little or not at all with room sideways, and keeps a lead out of each socket", () => {
    // The curve's sideways position, sampled: how far it doubles back, and how far it runs out before turning 20°.
    const shape = (tx: number, ty: number) => {
      const m = /C\s*([-\d.eE]+),([-\d.eE]+)\s+([-\d.eE]+),([-\d.eE]+)/.exec(spline({ sx: 0, sy: 0, tx, ty, sa: null, ta: null }))!;
      const [a, b, c, d] = m.slice(1).map(parseFloat);
      const at = (t: number) => { const u = 1 - t; return [3 * u * u * t * a + 3 * u * t * t * c + t ** 3 * tx, 3 * u * u * t * b + 3 * u * t * t * d + t ** 3 * ty]; };
      let back = 0, hi = -Infinity, lead = 0, turned = false, prev = [0, 0];
      for (let k = 1; k <= 2000; k++) {
        const p = at(k / 2000);
        hi = Math.max(hi, p[0]); back = Math.max(back, hi - p[0]);
        if (!turned && Math.abs(Math.atan2(p[1] - prev[1], p[0] - prev[0])) > (20 * Math.PI) / 180) turned = true;
        if (!turned) lead += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      return { back, lead };
    };
    // Room sideways: no bend-back, and a lead of 30px or more.
    for (const [tx, ty] of [[220, 150], [220, 400], [220, 600]]) {
      const s = shape(tx, ty);
      expect(s.back, `${tx},${ty}`).toBeLessThan(10);
      expect(s.lead, `${tx},${ty}`).toBeGreaterThan(30);
    }
    // Close sideways: a small bend-back, far less than the uncapped arms' 50 to 70px.
    for (const [tx, ty] of [[120, 600], [60, 500], [30, 400]]) expect(shape(tx, ty).back, `${tx},${ty}`).toBeLessThan(25);
  });

  it("holds across every pair of Conduit angles and a grid of positions: finite, tangent-exact, continuous, no longer arms than before", () => {
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const spots: Array<[number, number]> = [];
    for (const tx of [-400, -150, -40, 0, 40, 150, 400]) for (const ty of [-600, -200, -30, 0, 30, 200, 600]) spots.push([tx, ty]);
    const controls = (c: Cfg) => {
      const m = /C\s*([-\d.eE]+),([-\d.eE]+)\s+([-\d.eE]+),([-\d.eE]+)/.exec(spline(c));
      return m ? m.slice(1).map(parseFloat) : null;
    };
    const bad: string[] = [];
    for (const sa of angles) for (const ta of angles) for (const [tx, ty] of spots) {
      const c: Cfg = { sx: 0, sy: 0, tx, ty, sa, ta };
      if (Math.hypot(tx, ty) < 15) continue;
      const cu = parseCubic(spline(c));
      const k = controls(c);
      if (!cu || !k || k.some((v) => !Number.isFinite(v))) { bad.push(`no curve ${JSON.stringify(c)}`); continue; }
      if (offGrid(cu.exitDeg - sa, 360) > TOL || offGrid(cu.entryDeg - ta, 360) > TOL) bad.push(`tangent ${JSON.stringify(c)}`);
      // Arms never outgrow the old rule, max(40, 0.4 × distance).
      const old = Math.max(40, Math.hypot(tx, ty) * 0.4);
      const a1 = Math.hypot(k[0], k[1]), a2 = Math.hypot(k[2] - tx, k[3] - ty);
      if (a1 > old + 1e-6 || a2 > old + 1e-6) bad.push(`longer arm ${JSON.stringify(c)}`);
      // A half-pixel drag moves the control points by little: no jump anywhere on the grid.
      for (const [ddx, ddy] of [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]]) {
        const k2 = controls({ ...c, tx: tx + ddx, ty: ty + ddy })!;
        const jump = Math.max(...k.map((v, i) => Math.abs(v - k2[i])));
        if (jump > 2) bad.push(`jump ${jump.toFixed(2)} ${JSON.stringify(c)} by ${ddx},${ddy}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it("collapses to a straight line only when sockets nearly touch", () => {
    expect(spline({ sx: 0, sy: 0, tx: 10, ty: 4, sa: 0, ta: 270 }))
      .toMatch(/^M [-\d.eE]+,[-\d.eE]+ L [-\d.eE]+,[-\d.eE]+$/);
  });
});

describe("draggedCableArgs", () => {
  it("a plain output leaves rightward and the pointer end faces back", () => {
    const a = draggedCableArgs("output", Position.Right, { x: 100, y: 0 }, { x: 300, y: 50 }, null);
    expect([a.sourcePosition, a.targetPosition]).toEqual([Position.Right, Position.Left]);
    expect([a.sourceX, a.targetX]).toEqual([98, 300]);
  });

  it("a flipped output leaves leftward, from inside its glyph", () => {
    const a = draggedCableArgs("output", Position.Left, { x: 100, y: 0 }, { x: -100, y: 0 }, null);
    expect([a.sourcePosition, a.targetPosition]).toEqual([Position.Left, Position.Right]);
    expect(a.sourceX).toBe(102);
  });

  it("from an input the pointer is the source, and a flipped input is entered from the right", () => {
    const plain = draggedCableArgs("input", Position.Left, { x: 0, y: 0 }, { x: -200, y: 0 }, 45);
    expect([plain.sourcePosition, plain.targetPosition, plain.targetAngleDeg]).toEqual([Position.Right, Position.Left, 45]);
    const flipped = draggedCableArgs("input", Position.Right, { x: 0, y: 0 }, { x: 200, y: 0 }, null);
    expect([flipped.sourcePosition, flipped.targetPosition]).toEqual([Position.Left, Position.Right]);
    expect([flipped.sourceX, flipped.targetX]).toEqual([200, -2]);
  });
});

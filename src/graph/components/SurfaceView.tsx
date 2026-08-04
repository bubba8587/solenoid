import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import { heightRampColor } from "../palette";
import type { SurfacePayload } from "../chartValue";

// A shaded 3-D surface plot drawn to a <canvas>: the grid is projected
// axonometrically; each cell is a flat-shaded quad painted back-to-front. A null
// Z cell is a hole (its quads are skipped). No WebGL / z-buffer.

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v: V3): V3 { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }

// Height colormap — the PALETTE-derived sequential ramp, so the field figures
// retint with the active palette. Re-exported for the other field figures
// (Contour, Vector Field) so height/magnitude reads identically across the family.
export function heightColor(t: number): [number, number, number] {
  return heightRampColor(t);
}

const DH = 0.55;                 // height exaggeration (model units; base spans ~1)
const LIGHT = unit([-0.4, -0.6, 0.7]); // from the upper-front-left
const SURFACE_ALPHA = 0.86;      // slight translucency so the frame shows through

function drawSurface(canvas: HTMLCanvasElement, p: SurfacePayload, W: number, H: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Supersample: render the backing store above device resolution and let the browser
  // downscale it to the CSS size — crisper edges than a 1:1 canvas.
  const scale = Math.min(4, (window.devicePixelRatio || 1) * 2);
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = "round";

  const { xs, ys, z } = p;
  const nx = xs.length, ny = ys.length;
  const fin = (v: number | null): v is number => v != null && Number.isFinite(v);
  if (nx < 2 || ny < 2) return;

  let zmin = Infinity, zmax = -Infinity;
  for (const row of z) for (const v of row) if (fin(v)) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
  if (!Number.isFinite(zmin)) return;
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const nrm = (v: number, a: number, b: number) => (b > a ? (v - a) / (b - a) : 0.5);
  const gx = (ix: number) => nrm(xs[ix], xmin, xmax);
  const gy = (iy: number) => nrm(ys[iy], ymin, ymax);
  const gz = (ix: number, iy: number) => { const v = z[iy]?.[ix]; return fin(v) ? nrm(v, zmin, zmax) : null; };

  // Camera: yaw around the vertical (Z) axis, then pitch (elevation) around the
  // screen-horizontal — orthographic. Points are centered on the base so the box
  // spins about its middle.
  const yaw = (p.yaw ?? 45) * Math.PI / 180, pitch = (p.pitch ?? 45) * Math.PI / 180;
  const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const viewPt = (a: number, b: number, c: number): V3 => {
    const x = a - 0.5, y = b - 0.5, zc = c * DH;
    const x1 = x * cyaw - y * syaw, y1 = x * syaw + y * cyaw;
    return [x1, zc * cp - y1 * sp, y1 * cp + zc * sp]; // [screen-right, screen-up, depth]
  };
  const model = (a: number, b: number, c: number): [number, number] => { const v = viewPt(a, b, c); return [v[0], -v[1]]; }; // canvas y is down
  const depthOf = (a: number, b: number, c: number) => viewPt(a, b, c)[2];

  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  const fold = (mx: number, my: number) => { if (mx < mnx) mnx = mx; if (mx > mxx) mxx = mx; if (my < mny) mny = my; if (my > mxy) mxy = my; };
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) { const [x, y] = model(gx(ix), gy(iy), gz(ix, iy) ?? 0); fold(x, y); }
  // Include the full bounding-box (unit cube) so the reference frame fits too.
  for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) { const [x, y] = model(a, b, c); fold(x, y); }
  const pad = 14;
  const mw = mxx - mnx || 1, mh = mxy - mny || 1;
  const s = Math.min((W - 2 * pad) / mw, (H - 2 * pad) / mh);
  const ox = (W - s * mw) / 2 - s * mnx, oy = (H - s * mh) / 2 - s * mny;
  const proj = (a: number, b: number, c: number): [number, number] => { const [x, y] = model(a, b, c); return [ox + s * x, oy + s * y]; };
  const screen = (ix: number, iy: number, c: number) => proj(gx(ix), gy(iy), c);

  // Reference frame: a light gridded floor + two BACK walls, drawn BEHIND the
  // surface so the surface sits inside the box and occludes the near parts.
  const frameCol = getComputedStyle(canvas).getPropertyValue("--text").trim() || "#888";
  const gridPlane = (o: V3, u: V3, v: V3, div = 4) => {
    const at = (sd: number, td: number) => proj(o[0] + u[0] * sd + v[0] * td, o[1] + u[1] * sd + v[1] * td, o[2] + u[2] * sd + v[2] * td);
    const line = (p: [number, number], q: [number, number]) => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); };
    const c0 = at(0, 0), c1 = at(1, 0), c2 = at(1, 1), c3 = at(0, 1);
    ctx.beginPath(); ctx.moveTo(c0[0], c0[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c3[0], c3[1]); ctx.closePath();
    ctx.fillStyle = frameCol; ctx.globalAlpha = 0.05; ctx.fill();
    ctx.strokeStyle = frameCol; ctx.globalAlpha = 0.16; ctx.lineWidth = 0.5;
    for (let i = 0; i <= div; i++) { const t = i / div; line(at(t, 0), at(t, 1)); line(at(0, t), at(1, t)); }
    ctx.globalAlpha = 1;
  };
  gridPlane([0, 0, 0], [1, 0, 0], [0, 1, 0]); // floor (z = min), always behind
  // The two vertical walls FARTHEST from the viewer (smallest depth) — recomputed each
  // draw so the box stays correct as it rotates; the near two stay open.
  const WALLS: Array<{ o: V3; u: V3; v: V3; c: V3 }> = [
    { o: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], c: [0, 0.5, 0.5] }, // x = min
    { o: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], c: [1, 0.5, 0.5] }, // x = max
    { o: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], c: [0.5, 0, 0.5] }, // y = min
    { o: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], c: [0.5, 1, 0.5] }, // y = max
  ];
  WALLS.map((w) => ({ w, d: depthOf(w.c[0], w.c[1], w.c[2]) })).sort((a, b) => a.d - b.d).slice(0, 2)
    .forEach(({ w }) => gridPlane(w.o, w.u, w.v));

  // Cells with all four corners known, painted back (smallest depth) to front.
  const cells: Array<{ ix: number; iy: number; d: number }> = [];
  for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
    const z00 = gz(ix, iy), z10 = gz(ix + 1, iy), z01 = gz(ix, iy + 1), z11 = gz(ix + 1, iy + 1);
    if (z00 == null || z10 == null || z01 == null || z11 == null) continue;
    const ca = (gx(ix) + gx(ix + 1)) / 2, cb = (gy(iy) + gy(iy + 1)) / 2, cc = (z00 + z10 + z01 + z11) / 4;
    cells.push({ ix, iy, d: depthOf(ca, cb, cc) });
  }
  cells.sort((a, b) => a.d - b.d);

  ctx.globalAlpha = SURFACE_ALPHA;
  for (const { ix, iy } of cells) {
    const c00 = gz(ix, iy)!, c10 = gz(ix + 1, iy)!, c01 = gz(ix, iy + 1)!, c11 = gz(ix + 1, iy + 1)!;
    // Face normal in model space — z scaled to match the projection.
    const P = (ix2: number, iy2: number, c: number): V3 => [gx(ix2), gy(iy2), c * DH];
    let n = cross(sub(P(ix + 1, iy, c10), P(ix, iy, c00)), sub(P(ix, iy + 1, c01), P(ix, iy, c00)));
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
    n = unit(n);
    const bright = 0.55 + 0.45 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
    const [r, g, b] = heightColor((c00 + c10 + c01 + c11) / 4);
    const shade = (ch: number) => Math.round(ch * bright);
    const [q00, q10, q11, q01] = [screen(ix, iy, c00), screen(ix + 1, iy, c10), screen(ix + 1, iy + 1, c11), screen(ix, iy + 1, c01)];
    ctx.beginPath();
    ctx.moveTo(q00[0], q00[1]); ctx.lineTo(q10[0], q10[1]); ctx.lineTo(q11[0], q11[1]); ctx.lineTo(q01[0], q01[1]); ctx.closePath();
    ctx.fillStyle = `rgb(${shade(r)},${shade(g)},${shade(b)})`;
    ctx.fill();
    ctx.strokeStyle = `rgb(${Math.round(shade(r) * 0.7)},${Math.round(shade(g) * 0.7)},${Math.round(shade(b) * 0.7)})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // X / Y / Z labels on the frame's far edges (the box edges ARE the axes).
  const O = proj(0, 0, 0);
  const ends: Array<[[number, number], string]> = [[proj(1, 0, 0), "X"], [proj(0, 1, 0), "Y"], [proj(0, 0, 1), "Z"]];
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = frameCol;
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [end, lab] of ends) {
    const dx = end[0] - O[0], dy = end[1] - O[1], m = Math.hypot(dx, dy) || 1;
    ctx.fillText(lab, end[0] + (dx / m) * 9, end[1] + (dy / m) * 9);
  }
  ctx.globalAlpha = 1;
}

export function SurfaceView({ payload, width, height }: { payload: SurfacePayload; width: number; height: number }) {
  useSyncExternalStore(appThemeStore.subscribe, appThemeStore.version); // redraw on theme change
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (ref.current) drawSurface(ref.current, payload, width, height);
  });
  const empty = payload.xs.length < 2 || payload.ys.length < 2 || !payload.z.some((r) => r.some((v) => v != null && Number.isFinite(v)));
  if (empty) return <div className="solenoid-node__display-value solenoid-node__display-value--empty">—</div>;
  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

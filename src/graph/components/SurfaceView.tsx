import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { appThemeStore } from "../appTheme";
import type { SurfacePayload } from "../chartValue";

// A simple shaded 3-D surface plot, drawn to a <canvas> (one DOM element regardless
// of grid size). The grid is projected axonometrically; each cell is a flat-shaded
// quad (per-face Lambert lighting + a height colormap), painted back-to-front. A null
// Z cell is a hole (its quads are skipped). This is a lightweight faceted surface —
// no WebGL / z-buffer — which reads as 3-D and stays cheap.

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v: V3): V3 { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m]; }

// Viridis colormap (5 stops) — the familiar perceptual height ramp for surfaces.
const VIRIDIS: Array<[number, number, number]> = [
  [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37],
];
function heightColor(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(u));
  const f = u - i, a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const DH = 0.55;                 // height exaggeration (model units; base spans ~1)
const LIGHT = unit([-0.4, -0.6, 0.7]); // from the upper-front-left

function drawSurface(canvas: HTMLCanvasElement, p: SurfacePayload, W: number, H: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Supersample: render the backing store above device resolution and let the browser
  // downscale it to the CSS size — crisper edges than a 1:1 canvas (the quality bump).
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
  if (!Number.isFinite(zmin)) return; // no data to draw
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys), ymax = Math.max(...ys);
  const nrm = (v: number, a: number, b: number) => (b > a ? (v - a) / (b - a) : 0.5);
  const gx = (ix: number) => nrm(xs[ix], xmin, xmax);
  const gy = (iy: number) => nrm(ys[iy], ymin, ymax);
  const gz = (ix: number, iy: number) => { const v = z[iy]?.[ix]; return fin(v) ? nrm(v, zmin, zmax) : null; };

  // Axonometric model projection of a unit-cube point → 2-D model space.
  const model = (a: number, b: number, c: number): [number, number] => [a - b, (a + b) * 0.5 - c * DH];

  // Fit the projected grid — and the axis tripod corner — into the canvas with padding.
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
  const fold = (mx: number, my: number) => { if (mx < mnx) mnx = mx; if (mx > mxx) mxx = mx; if (my < mny) mny = my; if (my > mxy) mxy = my; };
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) { const [x, y] = model(gx(ix), gy(iy), gz(ix, iy) ?? 0); fold(x, y); }
  // The axes emanate from the (xmin, ymin) base corner; include their ends so they fit.
  for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) { const [x, y] = model(a, b, c); fold(x, y); }
  const pad = 14;
  const mw = mxx - mnx || 1, mh = mxy - mny || 1;
  const s = Math.min((W - 2 * pad) / mw, (H - 2 * pad) / mh);
  const ox = (W - s * mw) / 2 - s * mnx, oy = (H - s * mh) / 2 - s * mny;
  const proj = (a: number, b: number, c: number): [number, number] => { const [x, y] = model(a, b, c); return [ox + s * x, oy + s * y]; };
  const screen = (ix: number, iy: number, c: number) => proj(gx(ix), gy(iy), c);

  // Cells with all four corners known, painted back (small gx+gy) to front.
  const cells: Array<{ ix: number; iy: number; d: number }> = [];
  for (let iy = 0; iy < ny - 1; iy++) for (let ix = 0; ix < nx - 1; ix++) {
    if (gz(ix, iy) == null || gz(ix + 1, iy) == null || gz(ix, iy + 1) == null || gz(ix + 1, iy + 1) == null) continue;
    cells.push({ ix, iy, d: gx(ix) + gx(ix + 1) + gy(iy) + gy(iy + 1) });
  }
  cells.sort((a, b) => a.d - b.d);

  for (const { ix, iy } of cells) {
    const c00 = gz(ix, iy)!, c10 = gz(ix + 1, iy)!, c01 = gz(ix, iy + 1)!, c11 = gz(ix + 1, iy + 1)!;
    // Face normal (model space, z scaled to match the projection) → Lambert brightness.
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
    // A faint edge (the fill, darkened) defines the mesh without a heavy wireframe.
    ctx.strokeStyle = `rgb(${Math.round(shade(r) * 0.7)},${Math.round(shade(g) * 0.7)},${Math.round(shade(b) * 0.7)})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // ── Basic XYZ axes ──────────────────────────────────────────────────────────
  // Three lines from the (xmin, ymin) base corner: X and Y along the base edges, Z
  // straight up. A light reference frame, theme-coloured, drawn over the surface.
  const axisCol = getComputedStyle(canvas).getPropertyValue("--text").trim() || "#888";
  const O = proj(0, 0, 0);
  const ends: Array<[[number, number], string]> = [[proj(1, 0, 0), "X"], [proj(0, 1, 0), "Y"], [proj(0, 0, 1), "Z"]];
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = axisCol;
  ctx.lineWidth = 1;
  for (const [end] of ends) { ctx.beginPath(); ctx.moveTo(O[0], O[1]); ctx.lineTo(end[0], end[1]); ctx.stroke(); }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = axisCol;
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [end, lab] of ends) {
    const dx = end[0] - O[0], dy = end[1] - O[1], m = Math.hypot(dx, dy) || 1;
    ctx.fillText(lab, end[0] + (dx / m) * 8, end[1] + (dy / m) * 8);
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

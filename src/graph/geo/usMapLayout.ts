// [[C100]] chartIsAValue
// The US Map figure's geometry: the state outlines as SVG paths and each pin's place, both in the 975×610 Albers USA frame.
import { albersUsa, US_FRAME } from "./albersUsa";
import type { UsMapPayload } from "../chartValue";
import states from "./usStates.json";

export type UsMapScope = UsMapPayload["scope"];
export type Box = { x: number; y: number; w: number; h: number };

interface StateRecord { id: string; name: string; rings: number[][] }
export interface StatePath { id: string; name: string; d: string }

const PROJ = albersUsa();
const OFF_48 = new Set(["02", "15"]);

function ringPath(ring: number[], project: (lon: number, lat: number) => [number, number], grow: (x: number, y: number) => void): string {
  let lon = 0, lat = 0, d = "";
  for (let i = 0; i < ring.length; i += 2) {
    lon += ring[i];
    lat += ring[i + 1];
    const [x, y] = project(lon / 100, lat / 100);
    grow(x, y);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return `${d}Z`;
}

const geometry = new Map<UsMapScope, { paths: StatePath[]; box: Box }>();

/** The scope's states and the box that frames them, with a little room at the edges. */
export function usMapGeometry(scope: UsMapScope): { paths: StatePath[]; box: Box } {
  const hit = geometry.get(scope);
  if (hit) return hit;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const paths = (states as StateRecord[])
    .filter((s) => scope === "all50" || !OFF_48.has(s.id))
    .map((s) => {
      const project = PROJ.forState(s.id);
      return { id: s.id, name: s.name, d: s.rings.map((r) => ringPath(r, project, grow)).join("") };
    });
  const pad = 8;
  const box = scope === "all50"
    ? { x: Math.min(0, x0) - pad, y: Math.min(0, y0) - pad, w: Math.max(US_FRAME.width, x1) - Math.min(0, x0) + 2 * pad, h: Math.max(US_FRAME.height, y1) - Math.min(0, y0) + 2 * pad }
    : { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const out = { paths, box };
  geometry.set(scope, out);
  return out;
}

export interface PlacedPin { x: number; y: number; i: number }

/** Each pin's place on the scope's map, in row order; `off` counts the pins neither frame of the scope holds, so a
 *  place in Alaska on the lower-48 map, or outside the country on either, is reported rather than drawn somewhere. */
export function placePins(p: Pick<UsMapPayload, "lat" | "lon">, scope: UsMapScope): { pins: PlacedPin[]; off: number } {
  const pins: PlacedPin[] = [];
  let off = 0;
  for (let i = 0; i < p.lat.length; i++) {
    const at = scope === "all50" ? PROJ.point(p.lon[i], p.lat[i]) : lower48Only(p.lon[i], p.lat[i]);
    if (at) pins.push({ x: at[0], y: at[1], i });
    else off++;
  }
  return { pins, off };
}

function lower48Only(lon: number, lat: number): [number, number] | null {
  const at = PROJ.point(lon, lat);
  if (!at) return null;
  const main = PROJ.lower48(lon, lat);
  return main[0] === at[0] && main[1] === at[1] ? at : null;
}

/** The view box `factor` times closer about the point `(fx, fy)`, a fraction across and down the current box, held
 *  between the scope's whole box and 40 times closer. */
export function zoomBox(view: Box, home: Box, factor: number, fx: number, fy: number): Box {
  const w = Math.min(home.w, Math.max(home.w / 40, view.w / factor));
  const h = w * (home.h / home.w);
  return clampBox({ x: view.x + (view.w - w) * fx, y: view.y + (view.h - h) * fy, w, h }, home);
}

/** The box moved by `(dx, dy)` frame units, kept over the map so it can't be dragged off into empty space. */
export function panBox(view: Box, home: Box, dx: number, dy: number): Box {
  return clampBox({ ...view, x: view.x + dx, y: view.y + dy }, home);
}

function clampBox(b: Box, home: Box): Box {
  return {
    ...b,
    x: Math.min(home.x + home.w - b.w, Math.max(home.x, b.x)),
    y: Math.min(home.y + home.h - b.h, Math.max(home.y, b.y)),
  };
}

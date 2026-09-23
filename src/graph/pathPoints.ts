// [[C91]] cableWalkRouter
// Pure geometry. Cable paths are absolute M/L/C/Q `d` strings, flattened once to a polyline.

export interface Pt { x: number; y: number }

function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MLCQZmlcqz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push(m[1]);
    else out.push(parseFloat(m[2]));
  }
  return out;
}

function cubicAt(t: number, p0: Pt, p1: Pt, p2: Pt, p3: Pt): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + e * p3.x, y: a * p0.y + b * p1.y + c * p2.y + e * p3.y };
}
function quadAt(t: number, p0: Pt, p1: Pt, p2: Pt): Pt {
  const u = 1 - t;
  const a = u * u, b = 2 * u * t, c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

/** Curves sample into `curveSegs` segments each; [] for an empty or garbage string. */
export function parsePathPoints(d: string, curveSegs = 18): Pt[] {
  const t = tokenize(d);
  const pts: Pt[] = [];
  let i = 0;
  let cur: Pt = { x: 0, y: 0 };
  const num = (): number => (typeof t[i] === "number" ? (t[i++] as number) : NaN);
  while (i < t.length) {
    const cmd = t[i] as string;
    if (typeof cmd !== "string") { i++; continue; }
    i++;
    if (cmd === "M") {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === "L") {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === "C") {
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      const p3 = { x: num(), y: num() };
      for (let s = 1; s <= curveSegs; s++) pts.push(cubicAt(s / curveSegs, cur, p1, p2, p3));
      cur = p3;
    } else if (cmd === "Q") {
      const p1 = { x: num(), y: num() };
      const p2 = { x: num(), y: num() };
      for (let s = 1; s <= curveSegs; s++) pts.push(quadAt(s / curveSegs, cur, p1, p2));
      cur = p2;
    } else if (cmd === "Z" || cmd === "z") {
      if (pts.length) pts.push(pts[0]);
    }
    // Lowercase relative commands never appear in cable paths.
  }
  return pts.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

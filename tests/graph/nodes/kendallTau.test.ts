// [[C120]] linearWork
import { it, expect } from "vitest";
import { coreFunction } from "../coreFunction";

const kendallTau = (xs: number[], ys: number[]) => coreFunction("KENDALL")!(xs, ys);
/** The pairwise loop KENDALL replaced, kept as the reference its O(n log n) counts must equal. */
function slow(xs: number[], ys: number[]) {
  const n = Math.min(xs.length, ys.length); if (n < 2) return null;
  let conc = 0, disc = 0, tx = 0, ty = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = Math.sign(xs[i] - xs[j]), dy = Math.sign(ys[i] - ys[j]);
    if (dx === 0 && dy === 0) continue; if (dx === 0) { tx++; continue; } if (dy === 0) { ty++; continue; }
    if (dx === dy) conc++; else disc++;
  }
  const den = Math.sqrt((conc + disc + tx) * (conc + disc + ty));
  return den === 0 ? "div0" : (conc - disc) / den;
}
it("Kendall's O(n log n) counts equal the pairwise loop, signed zeros, extremes and ties included", () => {
  let seed = 1; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 20000; t++) {
    const n = Math.floor(r() * 40), k = 1 + Math.floor(r() * 6);
    const pool = [0, -0, 1, 2, 1e308, -1e308, 5e-324, -5e-324, 3.5];
    const v = () => (r() < 0.3 ? pool[Math.floor(r() * pool.length)] : Math.floor(r() * k));
    const xs = Array.from({ length: n }, v), ys = Array.from({ length: n + Math.floor(r() * 3) }, v);
    const got = kendallTau(xs, ys); const want = slow(xs, ys);
    const g = typeof got === "object" && got !== null ? "div0" : got;
    if (!Object.is(g, want)) expect({ xs, ys, g }).toEqual({ xs, ys, g: want });
  }
});

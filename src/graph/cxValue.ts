// ─── Tagged complex values — the Cx scalar ────────────────────────────────────
// A complex number is a TAGGED OBJECT, like every other special scalar (SolError,
// UnitCell) — rules.md VAL-15. The earlier [re, im] tuple collided with the 1-D list
// representation, which forced a bespoke broadcaster in nodes/complex.ts, complex
// special-cases in coerceInputs, array canonicalization in setKey, and a chip that
// drew a complexlist as a 2-column table. Tagged, `Array.isArray` means exactly one
// thing everywhere: "this is a 1-D list".
//
// This module is RETE-FREE (FX-2): the formula path (listOps → excelFunctions) and
// the display layer both need the type and its formatter without loading the editor.
// The MATH kernels live here too (D23 amendment, 2026-07-28): the IM* formula
// registrations and the complex nodes run the identical functions (FX-1), so the
// kernels can't sit in the rete-tangled node module.

import { solError, type SolError } from "./errorValue";

export interface Cx { readonly __cx: true; readonly re: number; readonly im: number }

export function cx(re: number, im: number): Cx {
  return { __cx: true, re, im };
}

/** The one complex test (VAL-15). Everything that must tell a complex from any other
 *  value routes here — never a structural array sniff. */
export function isCx(v: unknown): v is Cx {
  return typeof v === "object" && v !== null && (v as { __cx?: unknown }).__cx === true;
}

// Format a Cx as "a+bi", "a-bi", "bi", "a", "0"
export function formatCx(z: Cx, digits = 4): string {
  const { re, im } = z;
  if (Number.isNaN(re) || Number.isNaN(im)) return "NaN";
  const fmtNum = (n: number) =>
    Number.isInteger(n) ? n.toString() : n.toFixed(digits).replace(/\.?0+$/, "");
  const rStr = fmtNum(re);
  if (im === 0) return rStr;
  const iAbs = Math.abs(im);
  const iStr = iAbs === 1 ? "i" : `${fmtNum(iAbs)}i`;
  if (re === 0) return im < 0 ? `-${iStr}` : iStr;
  return im < 0 ? `${rStr} - ${iStr}` : `${rStr} + ${iStr}`;
}

/** Parse a complex out of text: Excel's forms ("3+4i", "-2.5j", "i", "4", "3+i",
 *  scientific mantissas) plus formatCx's spaced output ("3 - 4i"), so the two
 *  round-trip. Suffix `i` or `j`, per Excel. Null when the text isn't a complex —
 *  the caller decides the error (Excel answers #NUM! there). */
export function parseCx(text: string): Cx | null {
  const s = text.trim();
  if (s === "") return null;
  const NUM = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  let m = s.match(new RegExp(`^([+-]?${NUM})\\s*([+-])\\s*(${NUM})?[ij]$`));
  if (m) return cx(Number(m[1]), Number(`${m[2]}${m[3] ?? "1"}`));
  m = s.match(new RegExp(`^([+-])?(${NUM})?[ij]$`));
  if (m) return cx(0, Number(`${m[1] ?? ""}${m[2] ?? "1"}`));
  m = s.match(new RegExp(`^[+-]?${NUM}$`));
  if (m) return cx(Number(s), 0);
  return null;
}

// ─── Math kernels ─────────────────────────────────────────────────────────────
// No error-classification here, matching the node family's convention: the ops
// carry their own non-finite forms (IMDIV by zero is cx(NaN, NaN), which formats
// as "NaN") rather than minting tagged errors.

export function cxAdd(a: Cx, b: Cx): Cx { return cx(a.re+b.re, a.im+b.im); }
export function cxSub(a: Cx, b: Cx): Cx { return cx(a.re-b.re, a.im-b.im); }
export function cxMul(a: Cx, b: Cx): Cx {
  return cx(a.re*b.re-a.im*b.im, a.re*b.im+a.im*b.re);
}
export function cxDiv(a: Cx, b: Cx): Cx {
  const d = b.re**2 + b.im**2;
  if (d === 0) return cx(NaN, NaN);
  return cx((a.re*b.re+a.im*b.im)/d, (a.im*b.re-a.re*b.im)/d);
}
export function cxAbs(z: Cx): number { return Math.hypot(z.re, z.im); }
export function cxArg(z: Cx): number { return Math.atan2(z.im, z.re); }
export function cxExp(z: Cx): Cx {
  const r = Math.exp(z.re);
  return cx(r*Math.cos(z.im), r*Math.sin(z.im));
}
export function cxLn(z: Cx): Cx { return cx(Math.log(cxAbs(z)), cxArg(z)); }
const LN10 = Math.log(10), LN2 = Math.log(2);
export function cxLog10(z: Cx): Cx { const l = cxLn(z); return cx(l.re/LN10, l.im/LN10); }
export function cxLog2(z: Cx): Cx  { const l = cxLn(z); return cx(l.re/LN2,  l.im/LN2);  }
export function cxPow(z: Cx, n: number): Cx {
  if (z.re === 0 && z.im === 0) return cx(0, 0);
  const r = Math.pow(cxAbs(z), n);
  const a = cxArg(z) * n;
  return cx(r*Math.cos(a), r*Math.sin(a));
}
export function cxSqrt(z: Cx): Cx { return cxPow(z, 0.5); }
export function cxConj(z: Cx): Cx { return cx(z.re, -z.im); }
export function cxSin(z: Cx): Cx {
  const { re: r, im: i } = z;
  return cx(Math.sin(r)*Math.cosh(i), Math.cos(r)*Math.sinh(i));
}
export function cxCos(z: Cx): Cx {
  const { re: r, im: i } = z;
  return cx(Math.cos(r)*Math.cosh(i), -Math.sin(r)*Math.sinh(i));
}
export function cxTan(z: Cx): Cx { return cxDiv(cxSin(z), cxCos(z)); }
export function cxSinh(z: Cx): Cx {
  const { re: r, im: i } = z;
  return cx(Math.sinh(r)*Math.cos(i), Math.cosh(r)*Math.sin(i));
}
export function cxCosh(z: Cx): Cx {
  const { re: r, im: i } = z;
  return cx(Math.cosh(r)*Math.cos(i), Math.sinh(r)*Math.sin(i));
}
export function cxSec(z: Cx): Cx { return cxDiv(cx(1,0), cxCos(z)); }
export function cxCsc(z: Cx): Cx { return cxDiv(cx(1,0), cxSin(z)); }
export function cxCot(z: Cx): Cx { return cxDiv(cxCos(z), cxSin(z)); }
export function cxSech(z: Cx): Cx { return cxDiv(cx(1,0), cxCosh(z)); }
export function cxCsch(z: Cx): Cx { return cxDiv(cx(1,0), cxSinh(z)); }

/** Both roots of a·x² + b·x + c = 0 as the conjugate-ordered pair [x₁, x₂] — the
 *  Quadratic Roots node's math and the QUADRATICROOTS registration, one kernel.
 *  a = 0 is a #DOMAIN! (a line, not a quadratic). */
export function quadraticRoots(a: number, b: number, c: number): [Cx, Cx] | SolError {
  if (a === 0) return solError("#DOMAIN!", "a = 0 is a line, not a quadratic — solve b·x + c = 0 directly");
  const disc = b * b - 4 * a * c;
  const s = Math.sqrt(Math.abs(disc)) / (2 * a);
  const z = (v: number) => (v === 0 ? 0 : v); // kill -0 (it would display "-0")
  const re = z(-b / (2 * a));
  if (disc >= 0) return [cx(z(re - s), 0), cx(z(re + s), 0)];
  return [cx(re, z(-s)), cx(re, z(s))]; // the conjugate pair
}

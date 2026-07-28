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

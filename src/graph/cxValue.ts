// [[C17]] shareImpl, [[C24]] arraySemantics

import { formatScalar as displayNumber } from "./components/format";

export interface Cx { readonly __cx: true; readonly re: number; readonly im: number }

export function cx(re: number, im: number): Cx {
  return { __cx: true, re, im };
}

/** Every complex test routes here, never a structural array sniff. */
export function isCx(v: unknown): v is Cx {
  return typeof v === "object" && v !== null && (v as { __cx?: unknown }).__cx === true;
}

export function assembleCx(z: Cx, fmtNum: (n: number) => string, bothParts = false): { text: string; hasBothParts: boolean } {
  const { re, im } = z;
  if (Number.isNaN(re) || Number.isNaN(im)) return { text: "NaN", hasBothParts: false };
  const rStr = fmtNum(re);
  const iAbs = Math.abs(im);
  const iStr = iAbs === 1 ? "i" : `${fmtNum(iAbs)}i`;
  if (!bothParts) {
    if (im === 0) return { text: rStr, hasBothParts: false };
    if (re === 0) return { text: im < 0 ? `-${iStr}` : iStr, hasBothParts: false };
  }
  return { text: im < 0 ? `${rStr} - ${iStr}` : `${rStr} + ${iStr}`, hasBothParts: true };
}

const cxNumFmt = (digits: number) => (n: number) =>
  Number.isInteger(n) ? n.toString() : n.toFixed(digits).replace(/\.?0+$/, "");

export function formatCx(z: Cx, digits = 4): string {
  return assembleCx(z, cxNumFmt(digits)).text;
}

/** On screen each part reads as any unformatted number does ([[D94]] oneNumberDisplay). */
export function formatCxDisplay(z: Cx): string {
  return assembleCx(z, displayNumber, true).text;
}

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



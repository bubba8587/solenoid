// [[C51]] formulaNaming.
import { EXCEL_IMPL_META, FRAME_SURFACE_NAMES, NODE_SURFACE_NAMES } from "./excelFunctions";
import { packFormulaSignature } from "./formulaExtensions";

import { FORMULA_SIGNATURES } from "./formulaSignatureTable";

export { FORMULA_SIGNATURES };

export function genericSignature([min, max]: readonly [number, number]): string {
  if (max === 0) return "";
  const variadic = max >= 255;
  const shown = variadic ? Math.max(min, 1) : max;
  const parts: string[] = [];
  for (let i = 1; i <= shown; i++) parts.push(i <= min ? `arg${i}` : `[arg${i}]`);
  if (variadic) parts.push("…");
  return parts.join(", ");
}

export function signatureFor(name: string): string | null {
  const up = name.toUpperCase();
  const frameNode = FRAME_SURFACE_NAMES[up];
  if (frameNode) return `frame verb — use the ${frameNode} node`;
  const nodeVerb = NODE_SURFACE_NAMES[up];
  if (nodeVerb) return `use the ${nodeVerb} node`;
  const sig = FORMULA_SIGNATURES[up];
  if (sig !== undefined) return sig;
  const packSig = packFormulaSignature(up);
  if (packSig) return packSig;
  const meta = EXCEL_IMPL_META[up];
  if (meta?.arity) return genericSignature(meta.arity);
  return null;
}

export function signatureParams(sig: string): string[] | null {
  if (sig === "") return [];
  if (sig.includes(" — ") || sig.startsWith("use the ")) return null;
  return sig.split(", ");
}

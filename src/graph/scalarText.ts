// [[B1]] obsidianBet
import { noteDateSerial } from "./nodes/dateSerial";
import { parseCx } from "./cxValue";
import type { FrontmatterScalar } from "./noteFrontmatter";

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export type ScalarKind = "number" | "string" | "logical" | "date" | "complex";

export const isComplexText = (t: string): boolean => /[ij]$/.test(t) && /\d/.test(t) && parseCx(t) !== null;

export function guessScalarText(text: string): { value: FrontmatterScalar; kind: ScalarKind } {
  const t = text.trim();
  if (t === "" || t === "~" || t === "null") return { value: null, kind: "string" };
  const lower = t.toLowerCase();
  if (lower === "true") return { value: true, kind: "logical" };
  if (lower === "false") return { value: false, kind: "logical" };
  if (NUMERIC.test(t)) return { value: Number(t), kind: "number" };
  const serial = noteDateSerial(t);
  if (serial !== null) return { value: serial, kind: "date" };
  if (isComplexText(t)) return { value: t, kind: "complex" };
  return { value: t, kind: "string" };
}

// [[B14]] oneDesignSystem: one icon per value type, on every type switcher and column type button.
import type { ReactNode } from "react";
import "./TypeIcon.css";

export type TypeIconKind = "number" | "string" | "text" | "date" | "logical" | "complex";

const Svg = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
/** Every drawn glyph fills the same 16-unit box (4 to 20); outlines read smaller than solid text, so the box runs a touch past the text glyphs' height. */
const LogicalGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="16" x="4" y="4" rx="2" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
const ComplexGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M17.9 6.5A8 8 0 1 0 17.9 17.5" /><path d="M8.2 5.9v12.2" /></Svg>;
/** The date picker's calendar, redrawn on the shared box and stroke. */
const DateGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="14.5" x="4" y="5.5" rx="2" /><path d="M4 10.5h16M9 4v3M15 4v3" /></Svg>;

/** No cast: an empty-set ∅ drawn to match the type glyphs. The caller's tooltip says what it means. */
export function NoCastIcon({ size = 14 }: { size?: number }): ReactNode {
  return <span className="sol-typeicon" aria-hidden="true"><Svg size={size}><circle cx="12" cy="12" r="8" /><path d="M19 4 5 20" /></Svg></span>;
}

/** The type's icon: `#`, `Aa`, the date picker's calendar, a checkbox, a double-struck C. The caller's tooltip names the type. */
export function TypeIcon({ type, size = 14 }: { type: TypeIconKind; size?: number }): ReactNode {
  switch (type) {
    case "number": return <span className="sol-typeicon" aria-hidden="true">#</span>;
    case "string":
    case "text": return <span className="sol-typeicon sol-typeicon--text" aria-hidden="true">Aa</span>;
    case "date": return <span className="sol-typeicon" aria-hidden="true"><DateGlyph size={size} /></span>;
    case "logical": return <span className="sol-typeicon" aria-hidden="true"><LogicalGlyph size={size} /></span>;
    case "complex": return <span className="sol-typeicon" aria-hidden="true"><ComplexGlyph size={size} /></span>;
  }
}

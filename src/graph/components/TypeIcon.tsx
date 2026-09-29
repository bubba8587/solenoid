// [[B14]] oneDesignSystem: one icon per value type, on every type switcher and column type button.
import type { ReactNode } from "react";
import { CalendarIcon } from "./CalendarIcon";
import "./TypeIcon.css";

export type TypeIconKind = "number" | "string" | "text" | "date" | "logical" | "complex";

const Svg = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
/** Lucide "square-check" (ISC), and a double-struck C drawn to match. */
const LogicalGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="18" height="18" x="3" y="3" rx="2" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
const ComplexGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M19 6.2A8.5 8.5 0 1 0 19 17.8" /><path d="M8 5.5v13" /></Svg>;

/** The type's icon: `#`, `Aa`, the date picker's calendar, a checkbox, a double-struck C. The caller's tooltip names the type. */
export function TypeIcon({ type, size = 14 }: { type: TypeIconKind; size?: number }): ReactNode {
  switch (type) {
    case "number": return <span className="sol-typeicon" aria-hidden="true">#</span>;
    case "string":
    case "text": return <span className="sol-typeicon sol-typeicon--text" aria-hidden="true">Aa</span>;
    case "date": return <span className="sol-typeicon" aria-hidden="true"><CalendarIcon size={size} /></span>;
    case "logical": return <span className="sol-typeicon" aria-hidden="true"><LogicalGlyph size={size} /></span>;
    case "complex": return <span className="sol-typeicon" aria-hidden="true"><ComplexGlyph size={size} /></span>;
  }
}

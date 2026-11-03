// [[B14]] oneDesignSystem: one icon per value type, on every type switcher and column type button.
import type { ReactNode } from "react";
import "./TypeIcon.css";

export type TypeIconKind = "number" | "string" | "text" | "date" | "logical" | "complex";

/** A glyph on a 24-unit-high box, `width` units wide; drawn glyphs stroke at 2.2 and center their ink on the box. */
const Svg = ({ size, width = 24, children }: { size: number; width?: number; children: ReactNode }) => (
  <svg viewBox={`0 0 ${width} 24`} width={size * width / 24} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
/** Outlines span 4 to 20 (18.2 of ink with the stroke); the solid text glyphs stand 17 tall, since a filled shape reads bigger than an outline. */
const LogicalGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="16" x="4" y="4" rx="2" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
const ComplexGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M18.95 6.5A8 8 0 1 0 18.95 17.5" /><path d="M9.25 5.9v12.2" /></Svg>;
/** The date picker's calendar, redrawn on the shared box and stroke. */
const DateGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="14.5" x="4" y="5.5" rx="2" /><path d="M4 10.5h16M9 4v3M15 4v3" /></Svg>;
/** `#` and `Aa` cut from Atkinson Hyperlegible Next at weight 426, where its stem matches the 2.2 stroke. */
const NumberGlyph = ({ size }: { size: number }) => <Svg size={size} width={24}><path fill="currentColor" stroke="none" d="M7.01 20.5 7.63 16.22H4.46L4.76 14.03H7.93L8.51 9.97H5.34L5.64 7.78H8.81L9.41 3.5H11.62L11.02 7.78H14.18L14.78 3.5H16.99L16.39 7.78H19.54L19.24 9.97H16.07L15.52 14.03H18.66L18.36 16.22H15.19L14.59 20.5H12.38L12.98 16.22H9.82L9.22 20.5ZM10.14 14.03H13.3L13.86 9.97H10.7Z" /></Svg>;
const TextGlyph = ({ size }: { size: number }) => <Svg size={size} width={34}><path fill="currentColor" stroke="none" d="M3.06 20.35 9.45 3.35H12.27L18.64 20.35H15.94L14.64 16.69H7.06L5.76 20.35ZM7.8 14.53H13.9L10.85 5.92ZM24.04 20.65Q22.85 20.65 21.84 20.23Q20.84 19.81 20.24 19Q19.65 18.2 19.65 17.05Q19.65 15.55 20.69 14.64Q21.73 13.72 23.68 13.21Q25.62 12.7 28.31 12.46V12.21Q28.31 10.89 27.62 10.09Q26.93 9.29 25.46 9.29Q24.33 9.29 23.6 9.8Q22.87 10.31 22.67 11.21L20.51 10.55Q21.02 9.12 22.35 8.31Q23.67 7.51 25.41 7.51Q28.04 7.51 29.26 8.76Q30.49 10.02 30.49 12.64V15.57Q30.49 16.6 30.55 17.46Q30.61 18.32 30.72 19.03Q30.84 19.74 30.94 20.35H28.84L28.34 18.63Q27.79 19.58 26.73 20.12Q25.67 20.65 24.04 20.65ZM24.61 18.87Q25.61 18.87 26.45 18.52Q27.3 18.17 27.8 17.36Q28.31 16.55 28.31 15.16V14.21Q25.38 14.46 23.76 15.07Q22.15 15.69 22.15 16.98Q22.15 17.83 22.81 18.35Q23.47 18.87 24.61 18.87Z" /></Svg>;

/** No cast: an empty-set ∅ drawn to match the type glyphs. The caller's tooltip says what it means. */
export function NoCastIcon({ size = 14 }: { size?: number }): ReactNode {
  return <span className="sol-typeicon" aria-hidden="true"><Svg size={size}><circle cx="12" cy="12" r="7.6" /><path d="M18 4.8 6 19.2" /></Svg></span>;
}

/** The type's icon: `#`, `Aa`, a calendar, a checkbox, a double-struck C. The caller's tooltip names the type. */
export function TypeIcon({ type, size = 14 }: { type: TypeIconKind; size?: number }): ReactNode {
  switch (type) {
    case "number": return <span className="sol-typeicon" aria-hidden="true"><NumberGlyph size={size} /></span>;
    case "string":
    case "text": return <span className="sol-typeicon" aria-hidden="true"><TextGlyph size={size} /></span>;
    case "date": return <span className="sol-typeicon" aria-hidden="true"><DateGlyph size={size} /></span>;
    case "logical": return <span className="sol-typeicon" aria-hidden="true"><LogicalGlyph size={size} /></span>;
    case "complex": return <span className="sol-typeicon" aria-hidden="true"><ComplexGlyph size={size} /></span>;
  }
}

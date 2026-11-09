// [[B14]] oneDesignSystem: one icon per value type, on every type switcher and column type button.
import type { ReactNode } from "react";
import "./TypeIcon.css";

export type TypeIconKind = "number" | "string" | "text" | "date" | "logical" | "complex" | "frame" | "any" | "asis" | "special";

/** A glyph on a 24-unit-high box, `width` units wide; drawn glyphs stroke at 2.2 and center their ink on the box. */
const Svg = ({ size, width = 24, children }: { size: number; width?: number; children: ReactNode }) => (
  <svg viewBox={`0 0 ${width} 24`} width={size * width / 24} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
/** Outlines span 4 to 20 (18.2 of ink with the stroke); the text glyphs sit shorter and bolder (`#` 16.5, `Aa` 15.5), which reads level beside them. */
const LogicalGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="16" x="4" y="4" rx="2" /><path d="m8.5 12 2.5 2.5 4.5-5" /></Svg>;
const ComplexGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M18.95 6.5A8 8 0 1 0 18.95 17.5" /><path d="M9.25 5.9v12.2" /></Svg>;
/** The date picker's calendar, redrawn on the shared box and stroke. */
const DateGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="14.5" x="4" y="5.5" rx="2" /><path d="M4 10.5h16M9 4v3M15 4v3" /></Svg>;
/** The Frame socket's glyph in outline: its rounded square and the F-shaped mark, scaled from the socket's 12-unit box. */
const FrameGlyph = ({ size }: { size: number }) => <Svg size={size}><rect width="16" height="16" x="4" y="4" rx="2" /><path d="M9.5 15.9V9.2h6.4M9.5 12.3h5.3" /></Svg>;
/** The wildcard `*`, cut from the app font as `#` and `Aa` are, at `Aa`'s ink height, where its arms match the 2.2 stroke. */
const AnyGlyph = ({ size }: { size: number }) => <Svg size={size}><path fill="currentColor" stroke="none" d="M8.40 19.75L6.04 18.02L9.61 13.08L3.83 11.29L4.76 8.44L10.55 10.32L10.55 4.25L13.46 4.25L13.46 10.32L19.24 8.44L20.17 11.29L14.30 13.08L17.92 18.02L15.60 19.75L11.94 14.86Z" /></Svg>;
/** Lucide "star" (ISC): the special sockets, which carry no value family (a LAMBDA, a chart, a document). */
const SpecialGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" /></Svg>;
/** Lucide "shapes" (ISC): a value taken at its own rank, whatever shape it has. */
const AsIsGlyph = ({ size }: { size: number }) => <Svg size={size}><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" /><rect x="3" y="14" width="7" height="7" rx="1" /><circle cx="17.5" cy="17.5" r="3.5" /></Svg>;
/** `#` and `Aa` cut from Atkinson Hyperlegible Next at weight 600. */
const NumberGlyph = ({ size }: { size: number }) => <Svg size={size} width={24}><path fill="currentColor" stroke="none" d="M6.36 20.25 6.88 16.63H3.77L4.16 13.81H7.28L7.81 10.19H4.69L5.09 7.37H8.2L8.73 3.75H11.56L11.04 7.37H14.27L14.79 3.75H17.64L17.11 7.37H20.23L19.84 10.19H16.71L16.2 13.81H19.31L18.91 16.63H15.78L15.27 20.25H12.43L12.94 16.63H9.72L9.21 20.25ZM10.13 13.81H13.36L13.86 10.19H10.63Z" /></Svg>;
const TextGlyph = ({ size }: { size: number }) => <Svg size={size} width={32.5}><path fill="currentColor" stroke="none" d="M2.88 19.61 8.73 4.11H12.07L17.91 19.61H14.65L13.6 16.58H7.19L6.14 19.61ZM8.02 14.08H12.75L10.38 7.25ZM22.68 19.89Q21.59 19.89 20.68 19.49Q19.77 19.08 19.23 18.34Q18.69 17.6 18.69 16.55Q18.69 15.18 19.65 14.35Q20.61 13.51 22.37 13.06Q24.13 12.6 26.51 12.4V12.1Q26.51 11.02 25.93 10.44Q25.35 9.86 24.2 9.86Q23.33 9.86 22.73 10.26Q22.13 10.66 21.95 11.41L19.45 10.57Q19.97 9.34 21.24 8.59Q22.51 7.84 24.28 7.84Q26.73 7.84 27.97 8.95Q29.22 10.07 29.22 12.58V15.18Q29.22 16.01 29.27 16.84Q29.32 17.66 29.42 18.37Q29.51 19.08 29.62 19.61H27L26.56 18.14Q25.98 19.02 25 19.46Q24.03 19.89 22.68 19.89ZM23.61 17.85Q24.42 17.85 25.08 17.58Q25.74 17.31 26.13 16.66Q26.51 16.01 26.51 14.88V14.26Q24.22 14.44 22.95 14.91Q21.68 15.38 21.68 16.39Q21.68 17.05 22.21 17.45Q22.74 17.85 23.61 17.85Z" /></Svg>;

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
    case "frame": return <span className="sol-typeicon" aria-hidden="true"><FrameGlyph size={size} /></span>;
    case "any": return <span className="sol-typeicon" aria-hidden="true"><AnyGlyph size={size} /></span>;
    case "special": return <span className="sol-typeicon" aria-hidden="true"><SpecialGlyph size={size} /></span>;
    case "asis": return <span className="sol-typeicon" aria-hidden="true"><AsIsGlyph size={size} /></span>;
  }
}

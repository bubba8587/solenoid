// [[B14]] oneDesignSystem (DESIGN.md § Icon-only buttons)
// Small Lucide (ISC) glyphs shared by menus and buttons, drawn as SVG so they center on
// their box; a font glyph's ink isn't centered on its em (CloseIcon.tsx has the close).
import type { CSSProperties } from "react";

type IconProps = { size?: number; strokeWidth?: number; style?: CSSProperties };

const Svg = ({ size = 14, strokeWidth = 1.6, style, children }: IconProps & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ display: "block", flexShrink: 0, ...style }}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => <Svg {...p}><path d="m9 18 6-6-6-6" /></Svg>;
export const ChevronLeftIcon = (p: IconProps) => <Svg {...p}><path d="m15 18-6-6 6-6" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M6 3 20 12 6 21z" /></Svg>;
/** "link": a chain, for anything that follows cables. */
export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);
/** "link-2": a tether between two ends, for a standoff. */
export const TetherIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />
    <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
    <path d="M8 12h8" />
  </Svg>
);
/** "focus": corner brackets around a dot, for isolating a node. */
export const FocusIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </Svg>
);
export const TriangleAlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Svg>
);

export type ArrowDir = "up" | "down" | "left" | "right" | "up-left" | "up-right" | "down-left" | "down-right";
const ARROW: Record<ArrowDir, string> = {
  up: "m5 12 7-7 7 7M12 19V5",
  down: "M12 5v14m7-7-7 7-7-7",
  left: "m12 19-7-7 7-7M19 12H5",
  right: "M5 12h14m-7-7 7 7-7 7",
  "up-left": "M7 17V7h10M17 17 7 7",
  "up-right": "M7 7h10v10M7 17 17 7",
  "down-left": "M17 7 7 17M17 17H7V7",
  "down-right": "m7 7 10 10M17 7v10H7",
};
export const ArrowIcon = ({ dir, ...p }: IconProps & { dir: ArrowDir }) => <Svg {...p}><path d={ARROW[dir]} /></Svg>;
export const PencilIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </Svg>
);
export const CheckIcon = (p: IconProps) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const SearchIcon = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></Svg>;
export const InfoIcon = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></Svg>;
export const PlusSquareIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12h8" /><path d="M12 8v8" /></Svg>;
export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </Svg>
);
export const MinusSquareIcon = (p: IconProps) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12h8" /></Svg>;
export const Maximize2Icon = (p: IconProps) => (
  <Svg {...p}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /></Svg>
);
export const Minimize2Icon = (p: IconProps) => (
  <Svg {...p}><path d="M4 14h6v6" /><path d="M20 10h-6V4" /><path d="m14 10 7-7" /><path d="m3 21 7-7" /></Svg>
);
export const FullscreenIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>
);
export const ExitFullscreenIcon = (p: IconProps) => (
  <Svg {...p}><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></Svg>
);

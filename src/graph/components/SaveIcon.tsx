/** Shared save glyph, the top bar's Save button mark: wherever a control writes the
 *  document to a file, it wears this. */
export const SaveIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3.5 2.5 h7 L13.5 5.5 V12.5 a1 1 0 0 1 -1 1 H3.5 a1 1 0 0 1 -1 -1 V3.5 a1 1 0 0 1 1 -1 Z" />
    <path d="M5 2.5 V6 h5 V2.5" />
    <rect x="5" y="8.5" width="6" height="5" rx="0.5" />
  </svg>
);

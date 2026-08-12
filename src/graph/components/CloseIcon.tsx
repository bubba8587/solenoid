/** Shared close glyph as SVG, never a text "×"/"✕": a font glyph's ink isn't centered
 *  on its em, so a flex-centered button still renders it low. */
export const CloseIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    style={{ display: "block" }}
    aria-hidden="true"
  >
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </svg>
);

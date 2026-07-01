/**
 * Shared close/dismiss glyph. An SVG "×" (two crossed lines) rather than a text
 * "×"/"✕" character: a font glyph's ink isn't vertically centered on its em, so
 * `align-items: center` (which centers the line-box, not the ink) still leaves it
 * reading low. This SVG is symmetric about both axes, so its optical centre IS the
 * viewBox centre — it lands dead-centre in any flex-centred button at any size.
 */
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

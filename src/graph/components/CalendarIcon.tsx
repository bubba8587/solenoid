/** The calendar glyph on every control that opens the native date picker. */
export const CalendarIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.5 5.5h11M4.5 1v2.5M9.5 1v2.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

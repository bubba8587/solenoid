// [[C44]] dateSerials
// The IANA zone names a picker offers, through Intl.

/** Runtime `Intl.supportedValuesOf` where available, with a static fallback so the list is never empty. */
export const IANA_ZONES: readonly string[] = (() => {
  try {
    const withValues = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = withValues.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch { /* fall through to the static list */ }
  return [
    "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
    "Africa/Cairo", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo",
    "Asia/Singapore", "Australia/Sydney", "Pacific/Auckland",
  ];
})();


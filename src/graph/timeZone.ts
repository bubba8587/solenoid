// [[C44]] dateSerials
// Time zones through Intl: the IANA names a picker offers, and a zone's offset at an instant.

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

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Positive means ahead of UTC. The wall clock is rebuilt with its real year: `Date.UTC` reads 0 to 99 as 1900 on. */
export function zoneOffsetMs(zone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", era: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  let bc = false;
  for (const part of dtf.formatToParts(new Date(utcMs))) {
    if (part.type === "era") bc = part.value === "BC";
    else if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = new Date(0);
  wall.setUTCFullYear(bc ? 1 - p.year : p.year, p.month - 1, p.day);
  wall.setUTCHours(p.hour, p.minute, p.second, 0);
  return wall.getTime() - utcMs;
}


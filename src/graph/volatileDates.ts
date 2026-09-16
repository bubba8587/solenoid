// Midnight rollover (Obsidian bundle R5): TODAY / NOW and a relative Date Input answer for
// the calendar day, so at the next LOCAL midnight the document recomputes once (the F9
// path) when it holds any of them. One timer, re-armed after each firing; no setting.

import { isRelativeDateText } from "./nodes/dateSerial";

const VOLATILE_FN = /\b(TODAY|NOW)\s*\(/i;

/** Does any node's text carry TODAY() / NOW(), or a relative date phrase in a Date Input? */
export function hasVolatileDates(nodes: readonly unknown[]): boolean {
  for (const n of nodes) {
    const o = n as { expr?: unknown; frameText?: unknown; stringLiterals?: Record<string, unknown> };
    if (typeof o.expr === "string" && VOLATILE_FN.test(o.expr)) return true;
    if (typeof o.frameText === "string" && VOLATILE_FN.test(o.frameText)) return true;
    const date = o.stringLiterals?.date;
    if (typeof date === "string" && isRelativeDateText(date)) return true;
  }
  return false;
}

/** Milliseconds until the next local midnight (plus a second, so the day has turned). */
export function msUntilNextMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Arm the rollover: at each local midnight, `recalc()` runs if `nodes()` holds a volatile
 *  date. Returns the disarm. */
export function armMidnightRollover(nodes: () => readonly unknown[], recalc: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    timer = setTimeout(() => {
      if (hasVolatileDates(nodes())) recalc();
      schedule();
    }, msUntilNextMidnight());
  };
  schedule();
  return () => { if (timer) clearTimeout(timer); };
}

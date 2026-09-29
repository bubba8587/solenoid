// [[D46]] freezeVolatilePerCalc, [[C44]] dateSerials
// Midnight rollover: TODAY, NOW, a Knap `'now' | date` and relative Date Inputs answer for the calendar day, so at each local midnight a
// document holding any of them recomputes once. One timer, re-armed after each firing.

import { isRelativeDateText } from "./nodes/dateSerial";
import { getRecalcGen } from "./process";

const VOLATILE_FN = /\b(TODAY|NOW)\s*\(/i;
const KNAP_NOW = /["']now["']\s*\|\s*date\b/;

/** A memo key part: the recalc generation when the formula text calls TODAY or NOW, else -1, so a cached answer refreshes on F9 and at midnight. */
export function volatileStamp(text: string | undefined): number {
  return text && VOLATILE_FN.test(text) ? getRecalcGen() : -1;
}

export function hasVolatileDates(nodes: readonly unknown[]): boolean {
  for (const n of nodes) {
    const o = n as { expr?: unknown; frameText?: unknown; cubeText?: unknown; body?: unknown; stringLiterals?: Record<string, unknown>; internalEditor?: { getNodes(): readonly unknown[] } };
    if (o.constructor?.name === "TodayNowNode") return true;
    if (o.internalEditor && hasVolatileDates(o.internalEditor.getNodes())) return true;
    if (typeof o.expr === "string" && VOLATILE_FN.test(o.expr)) return true;
    if (typeof o.frameText === "string" && VOLATILE_FN.test(o.frameText)) return true;
    if (typeof o.cubeText === "string" && VOLATILE_FN.test(o.cubeText)) return true;
    if (typeof o.body === "string" && KNAP_NOW.test(o.body)) return true;
    const date = o.stringLiterals?.date;
    if (typeof date === "string" && isRelativeDateText(date)) return true;
  }
  return false;
}

/** Plus a second, so the day has turned. */
export function msUntilNextMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Returns the disarm. */
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

// [[C122]] choiceLadder
/** What a viewer can do to a Choice Ladder's choices: take an option at a fork (`instead` of the one taken there), undo
 *  one, or clear them all. */
export type LadderAction = { add: string; instead?: string } | { remove: string } | { reset: true };

/** The choices after an action, matched by name trimmed and case-insensitive: a take appends (moving to the end if already
 *  there, and dropping the one it replaces), an undo removes. */
export function nextChoices(choices: readonly string[], a: LadderAction): string[] {
  const key = (s: string) => s.trim().toLowerCase();
  if ("reset" in a) return [];
  if ("remove" in a) return choices.filter((c) => key(c) !== key(a.remove));
  return [...choices.filter((c) => key(c) !== key(a.add) && (a.instead == null || key(c) !== key(a.instead))), a.add];
}

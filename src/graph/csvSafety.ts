// [[C103]] untrustedContentSeams
// Editable grids never apply this, since their CSV view must round-trip typed text.

/** A number, thousands separators allowed, is never a formula, so a formatted `-1,234.50` stays a number in the spreadsheet. */
export function isFormulaTrigger(text: string): boolean {
  return /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text.replace(/,/g, "")));
}

export function neutralizeFormulaCell(text: string): string {
  return isFormulaTrigger(text) ? `'${text}` : text;
}

/** One CSV field per RFC 4180, neutralized first when it leaves the app. */
export function csvField(text: string, neutralize: boolean): string {
  const out = neutralize ? neutralizeFormulaCell(text) : text;
  return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

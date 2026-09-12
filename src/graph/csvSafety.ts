// One formula-injection rule for every CSV that leaves the app (the popup's Copy / Export
// and the Write File sink): a TEXT cell that a spreadsheet would evaluate on paste or open
// (a leading =, +, -, @, tab or CR that is not a plain number) gets a leading apostrophe.
// Editable grids never apply it, since their CSV view must round-trip typed text exactly.

export function isFormulaTrigger(text: string): boolean {
  return /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text));
}

export function neutralizeFormulaCell(text: string): string {
  return isFormulaTrigger(text) ? `'${text}` : text;
}

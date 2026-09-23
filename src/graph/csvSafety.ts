// [[C103]] untrustedContentSeams
// Editable grids never apply this, since their CSV view must round-trip typed text.

export function isFormulaTrigger(text: string): boolean {
  return /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text));
}

export function neutralizeFormulaCell(text: string): string {
  return isFormulaTrigger(text) ? `'${text}` : text;
}

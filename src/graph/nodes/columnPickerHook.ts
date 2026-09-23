// [[C8]] declareOnce.

export interface ColumnPickerSpec {
  key: string;
  frameInput: string;
}

interface HasColumnPickers {
  columnPickers(): ColumnPickerSpec[];
}

export function columnPickersOf(n: unknown): ColumnPickerSpec[] {
  const f = (n as Partial<HasColumnPickers> | null)?.columnPickers;
  return typeof f === "function" ? f.call(n) : [];
}

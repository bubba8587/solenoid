// [[C17]] shareImpl

export interface TriangleSolved {
  a: number; b: number; c: number;
  A: number; B: number; C: number;
  area: number; perimeter: number;
}

export const PART_KEYS = ["a", "b", "c", "A", "B", "C"] as const;

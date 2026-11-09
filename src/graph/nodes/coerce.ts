// [[C10]] socketLattice, [[C17]] shareImpl
// Keep this import type-only, so no runtime cycle with errorValue can form.
import type { SolError } from "../errorValue";

export type Mat = number[][];

/** The guard matches this by `name`, so never rename it. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShapeError";
  }
}

export type Cell = number | string | boolean | SolError | null;

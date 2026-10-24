import { GraphNode } from "../graphModel";
import { numListIn, numListOut, listIn, complexComboIn, complexComboOut, complexListOut, type CellResult, type BroadcastResult } from "./shared";
import type { SolError } from "../errorValue";
import type { Cx } from "../cxValue";
import { nodeOnCore } from "../nodeOnCore";

export { cx, isCx, type Cx } from "../cxValue";

export class ComplexFromNode extends GraphNode {
  label: string;
  cachedResult: CellResult<Cx> = null;
  literals: Record<string, number> = { re: 0, im: 0 };
  width = 180; height = 170;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "COMPLEX";
    this.addInput("re", numListIn("Real"));
    this.addInput("im", numListIn("Imag"));
    this.addOutput("z", complexComboOut("z"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { z: CellResult<Cx> };
  }
}

export class ComplexUnpackNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    arg: "The angle is in radians, between −π and π.",
  };

  label: string;
  cachedRe: BroadcastResult = null;
  cachedIm: BroadcastResult = null;
  cachedAbs: BroadcastResult = null;
  cachedArg: BroadcastResult = null;
  width = 200; height = 240;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IM Unpack";
    this.addInput("z", complexComboIn("z"));
    this.addOutput("re",  numListOut("Real"));
    this.addOutput("im",  numListOut("Imag"));
    this.addOutput("abs", numListOut("|z|"));
    this.addOutput("arg", numListOut("arg(z)"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { re: BroadcastResult; im: BroadcastResult; abs: BroadcastResult; arg: BroadcastResult };
  }
}

export type ComplexUnaryOp =
  | "conj" | "exp" | "ln" | "log10" | "log2" | "sqrt"
  | "sin"  | "cos" | "tan" | "cot"  | "sec"  | "csc"
  | "sinh" | "cosh" | "sech" | "csch";

export const COMPLEX_UNARY_OP_META: Record<ComplexUnaryOp, { label: string; description: string }> = {
  conj:  { label: "IMCONJUGATE", description: "Complex conjugate: negates the imaginary part. Excel: `IMCONJUGATE`." },
  exp:   { label: "IMEXP",       description: "`e` raised to a complex power. Excel: `IMEXP`." },
  ln:    { label: "IMLN",        description: "Natural logarithm of a complex number. Excel: `IMLN`." },
  log10: { label: "IMLOG10",     description: "Base-10 logarithm of a complex number. Excel: `IMLOG10`." },
  log2:  { label: "IMLOG2",      description: "Base-2 logarithm of a complex number. Excel: `IMLOG2`." },
  sqrt:  { label: "IMSQRT",      description: "Square root of a complex number (principal value). Excel: `IMSQRT`." },
  sin:   { label: "IMSIN",       description: "Sine of a complex number. Excel: `IMSIN`." },
  cos:   { label: "IMCOS",       description: "Cosine of a complex number. Excel: `IMCOS`." },
  tan:   { label: "IMTAN",       description: "Tangent of a complex number. Excel: `IMTAN`." },
  cot:   { label: "IMCOT",       description: "Cotangent of a complex number. Excel: `IMCOT`." },
  sec:   { label: "IMSEC",       description: "Secant of a complex number. Excel: `IMSEC`." },
  csc:   { label: "IMCSC",       description: "Cosecant of a complex number. Excel: `IMCSC`." },
  sinh:  { label: "IMSINH",      description: "Hyperbolic sine of a complex number. Excel: `IMSINH`." },
  cosh:  { label: "IMCOSH",      description: "Hyperbolic cosine of a complex number. Excel: `IMCOSH`." },
  sech:  { label: "IMSECH",      description: "Hyperbolic secant of a complex number. Excel: `IMSECH`." },
  csch:  { label: "IMCSCH",      description: "Hyperbolic cosecant of a complex number. Excel: `IMCSCH`." },
};

export class ComplexUnaryNode extends GraphNode {
  label: string;
  op: ComplexUnaryOp;
  cachedResult: CellResult<Cx> = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: ComplexUnaryOp }) {
    super("Complex");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "conj";
    this.addInput("z", complexComboIn("z"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CellResult<Cx> };
  }
}

export type ComplexBinaryOp = "sum" | "sub" | "product" | "div";

export const COMPLEX_BINARY_OP_META: Record<ComplexBinaryOp, { label: string; description: string }> = {
  sum:     { label: "IMSUM",     description: "Sum of two complex numbers. Excel: `IMSUM`." },
  sub:     { label: "IMSUB",     description: "Difference of two complex numbers. Excel: `IMSUB`." },
  product: { label: "IMPRODUCT", description: "Product of two complex numbers. Excel: `IMPRODUCT`." },
  div:     { label: "IMDIV",     description: "Quotient of two complex numbers. Excel: `IMDIV`." },
};

export class ComplexBinaryNode extends GraphNode {
  label: string;
  op: ComplexBinaryOp;
  cachedResult: CellResult<Cx> = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ComplexBinaryOp }) {
    super("Complex");
    this.label = init?.label ?? "";
    this.op = init?.op ?? "sum";
    this.addInput("a", complexComboIn("A"));
    this.addInput("b", complexComboIn("B"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CellResult<Cx> };
  }
}

export class ComplexPowerNode extends GraphNode {
  label: string;
  cachedResult: CellResult<Cx> = null;
  literals: Record<string, number> = { n: 2 };
  width = 180; height = 190;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IMPOWER";
    this.addInput("z", complexComboIn("z"));
    this.addInput("n", numListIn("n"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { result: CellResult<Cx> };
  }
}

export class PolyRootsNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    coeffs: "Highest degree first: 1, −6, 11, −6 is x³ − 6x² + 11x − 6. Leading zeros are ignored.",
    roots: "All roots as complex numbers, conjugate pairs included.",
    real: "Only the roots with no imaginary part, ascending.",
  };
  label: string;
  cachedRoots: Cx[] | SolError | null = null;
  cachedReal: number[] | null = null;
  width = 210; height = 190;

  constructor(init?: { label?: string }) {
    super("PolyRoots");
    this.label = init?.label ?? "Polynomial Roots";
    this.addInput("coeffs", listIn("Coefficients"));
    this.addOutput("roots", complexListOut("Roots"));
    this.addOutput("real", numListOut("Real roots"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { roots: Cx[] | SolError | null; real: number[] | null };
  }
}

export class QuadraticRootsNode extends GraphNode {
  label: string;
  literals: Record<string, number> = { a: 1, b: 0, c: 1 };
  cachedX1: CellResult<Cx> = null;
  cachedX2: CellResult<Cx> = null;
  width = 210;
  height = 200;

  constructor(init?: { label?: string }) {
    super("QuadraticRoots");
    this.label = init?.label ?? "Quadratic Roots";
    this.addInput("a", numListIn("a"));
    this.addInput("b", numListIn("b"));
    this.addInput("c", numListIn("c"));
    this.addOutput("x1", complexComboOut("x₁"));
    this.addOutput("x2", complexComboOut("x₂"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as { x1: CellResult<Cx>; x2: CellResult<Cx> };
  }
}

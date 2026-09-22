<!-- [[C47]] equationNode -->

# Spec: Equation solver

Serves [[C47]] equationNode. It covers what the system does and blocks, and the decision each behavior serves. A WHY that isn't in a node belongs in one.

The Equation card holds one relation, `LHS = RHS`, and solves it for whichever variable is not wired. Every variable is both an input and an output. The card lives in `nodes/equation.ts` (`EquationNode`); the solving layers are in `equationSolve.ts`. TVM is an Equation card with a fixed relation (`TvmNode extends EquationNode` in `nodes/finance.ts`), so it solves the same way; Triangle Solver has its own solver in `nodes/triangle.ts`.

## Parsing and sockets

- The relation must have exactly one `=`. No `=` at the top reads "An equation needs one = sign, like V = I * R"; a second one reads "Use exactly one = sign"; a parse failure reads "Syntax error". These show as the card's in-card message.
- Every variable name in the relation gets an input socket and an output socket, both named after it. The card also has a `holds` output, labeled "Check". Editing the relation adds sockets for new names and returns the departing names so the caller drops their cables before removing the sockets ([[D10]] onePrunePath).
- A variable is known only through its cable. The card declares no literal map, so a save or seed cannot plant a hidden known ([[C28]] literalsIffEditable).

## What the card does with its inputs

A variable is **known** when its input is wired, even when the cable carries a blank, and **unknown** when unwired. Each known variable's output passes its input through.

- **Two or more unknowns:** the card shows "Wire in all but one variable".
- **No unknowns:** the card checks whether the relation holds, and emits it on `holds`. Each side is evaluated and compared within a relative tolerance of 10⁻⁹ (`equalsWithin`), cell by cell for lists; a scalar broadcasts against a list and a ragged tail compares as null. With units, the check first compares the two sides' dimensions: different dimensions give `#UNIT!` "The two sides carry different units", and two different currencies give `#UNIT!` rather than holding by magnitude ([[D47]] noMixCurrencies). An evaluation failure gives `#VALUE!`.
- **One unknown:** the card solves for it. The unknown's name is `solvedFor`, which the card uses for its accent highlight. An error on any known passes through as the answer; a blank known makes the answer null.

## Solving for one unknown

The layers run in this order.

**1. Quadratic sniff** (scalar knowns only). `sniffQuadratic` probes the residual, `residual(x) = LHS(x) − RHS(x)`, at 0, 1 and −1 and fits a·x² + b·x + c exactly through those three points. It then checks the fit at 2.5, −3.75, 17 and −41.5; a miss beyond 10⁻⁹ of the local scale rejects it, which is what turns away square roots, trig and 1/x. When the fit holds, `solveQuadratic` returns the real roots:

- both roots as an ascending list, computed in the numerically stable form;
- one scalar for a double root (a discriminant within 10⁻¹² of zero, relative);
- `#SOLVE!` "No real solution: the quadratic's discriminant is negative" for a negative discriminant;
- nothing when a is effectively zero (degree below 2), so solving falls through to the next layer.

This runs before symbolic isolation because isolation would take the principal square root and lose a root: x² = 36 must give [−6, 6], not 6.

**2. Symbolic isolation** (`compileSolver`, `isolate`). When the unknown appears exactly once in the whole relation, the solver walks down the side that holds it, inverting one step at a time and applying each inverse to the other side:

- `+`, `−`, `×`, `÷` invert to their opposites, minding which operand holds the unknown;
- `u^n = O` becomes `u = O^(1/n)`, and `b^u = O` becomes `u = LN(O)/LN(b)`; `POWER` inverts the same way;
- `LOG(u, b) = O` becomes `u = b^O`, and `LOG(x, u) = O` becomes `u = x^(1/O)`; the base defaults to 10;
- unary minus flips the sign, and `u%` becomes `O·100`;
- single-argument functions with a clean inverse: `SQRT` to squaring, `EXP` and `LN`, `LOG10` to `10^`, `SIN`/`COS`/`TAN` and their arc functions, `SINH`/`COSH`/`TANH` and their inverses, `DEGREES` and `RADIANS`.

Any other step (`ABS`, a function of several arguments) has no clean inverse, and isolation gives up. The isolated expression is printed back to a fully parenthesized formula string and compiled by the ordinary evaluator, so list broadcasting, function dispatch and per-cell errors all come free, and the result is exact and deterministic. Inversion picks principal branches (the positive square root, the principal arcsine), so the value always satisfies the equation, but another branch's solution is left to the numeric layer. A throw while evaluating gives `#VALUE!` "Solving failed to evaluate".

**3. Numeric root-finding** (`solveNumeric`), the fallback when the unknown appears more than once or behind a step with no inverse. It works on scalar knowns only; with a list among the knowns it gives `#SHAPE!` "Numeric solving works on single values. With lists, this equation solves only where the algebra can be inverted". It uses no outside library: the residual is the compiled evaluator.

1. Build a symmetric log grid: 0 and ±10ᵏ for k from −6 to 12, sorted.
2. Walk the grid. A point where the residual is exactly 0 is a root. Between neighbors whose residuals change sign, bisect (up to 200 steps, until the bracket is within 10⁻¹² relative). A sign change can also be a pole, like 1/(x − 3) at 3, so the converged point counts only when its residual is within 10⁻⁶ of the larger bracket end.
3. Where the residual first becomes finite (`SQRT(x − 2)` below 2 is not), find the domain's edge by bisection, and bracket between the edge and the next grid point, so a root near a domain boundary is not missed.
4. Bisect every bracket, and return the root closest to zero. Taking the first bracket in ascending order would pick the most negative root; a TVM rate residual also crosses zero where 1 + r < 0, and −290% interest is never the intended answer.
5. With no root found, return `#SOLVE!` "No solution found between ±10¹². The equation may have no real root here".

## Units

The numeric layers run on base-SI magnitudes: each known's dimension is captured, then its unit is stripped. The solved unknown's unit is the dimension of its isolated expression (`dimEval`), tagged onto the result. An unknown that appears more than once has no isolated form, so its result stays a bare number rather than a guessed unit. Knowns whose units cannot combine give `#UNIT!`.

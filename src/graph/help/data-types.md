Two rules govern every cable, and neither one shows on the canvas.

**Families stay separate.** A value reaches only sockets of its own family, or a gray family-agnostic one. Crossing families takes a **Cast**, element-wise on a list. There is exactly one built-in bridge: **Boolean ⟷ number**, both directions, at every shape. TRUE or FALSE arrives as 1 or 0, and a number arrives as TRUE (non-zero), FALSE (zero) or unknown (NaN).

**Rank flows upward**, per the ladder below. Its one exception is the split square: a **combo** may feed its own family's scalar, because a combo may in fact be holding a single value. A plain list may not.

The five families:

- **Numeric**: numbers; the default for arithmetic and statistics.
- **Text**.
- **Date**: calendar dates, stored as serial numbers.
- **Complex**: a real part and an imaginary part.
- **Boolean**: TRUE or FALSE. Uses Kleene strong three-valued logic for handling unknowns. Booleans function as numeric 1s and 0s inside Formula surfaces.

Additional socket types:

- **Frame**: a proper data table of named columns. Frame Columns have a singular configurable data type. The Formula surfaces intentionally don't support Frames. Most analogous to Excel Tables.
- **Cube**: an advanced 3-D Frame, where every cell can contain a Frame or another Cube. Nested arrays within arrays.
- **Wildcards**: the Any-typed sockets can accept and output any of the data type families. 
- **LAMBDA**: Define reusable Formulas with the LAMBDA node. LAMBDAs can be used with the standard Excel helper verbs (MAP, BYROW...), but also as the basis for Frame Input's Computed Columns & they render as KATEX if embedded in a Document. 

**Chart**: Solenoid Charts can be passed via sockets and wired into Documents, where they'll render in-line.

**Document**: not data. Each connects only to its own kind, or to a hollow ring.

**Combo sockets:** The split-square sockets can accept Scalar or List-dimensioned values and will downgrade 1-item Lists to a Scalar in their outputs.

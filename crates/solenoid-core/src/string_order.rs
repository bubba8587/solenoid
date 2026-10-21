// [[C130]] rustCore
//! Port of `src/graph/stringOrder.ts`: JS `<` on strings, which orders UTF-16 code units.

use std::cmp::Ordering;

pub fn compare_strings(a: &str, b: &str) -> Ordering {
    crate::jsnum::compare_utf16(a, b)
}

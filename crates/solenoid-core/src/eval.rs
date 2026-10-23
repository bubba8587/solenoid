// [[C130]] rustCore, [[D99]] rustIsSpec, [[C15]] matricesInFormulas
//! The array-aware evaluator (`excelFormula.ts`' `evalAst`): a formula over named values, the Expression card's
//! core. A value is a JS value: a list is an array, a matrix an array of arrays, a LAMBDA a `V::Lambda`.

use crate::excel_formula::cell_to_v;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

use crate::frame::FrameColumn;

use crate::error_value::{ErrorCode, sol_error};
use crate::excel_formula::{apply_op, call_caught, constant_value, guard, lowered, Refusal, Role};
use crate::excel_functions::{fx_error_to_sol, is_ported, V};
use rustc_hash::FxHashMap;
use crate::excel_formula::{Ast, BinOp, UnaryOp};

pub type Env = FxHashMap<String, V>;

/// A LAMBDA value: its parameters, body and the names it closed over; or a function named bare (`eta`).
#[derive(Debug, Default)]
pub struct LambdaV {
    pub params: Vec<String>,
    pub body: Option<Rc<Ast>>,
    pub env: Rc<Env>,
    pub eta: Option<String>,
    /// A wired LAMBDA (a LAMBDA card's value): its body runs over its parameters and these captures alone
    /// (`compilePositional`), whose values `env` holds; inside a computed column a capture naming a column reads it.
    pub captured: Option<Vec<String>>,
    /// A wired LAMBDA's body as written: what it crosses back to the TS as, which compiles its `fn` from it.
    pub src: Option<String>,
    /// A wired LAMBDA's captured values with their units (`capturedValues`), beside `captured`; `env` holds the values
    /// the body reads for them (`readValues`), unit-blind.
    pub units: Vec<V>,
    /// The LAMBDA card's notes on its variables (`descriptions`).
    pub descriptions: Option<Rc<serde_json::Value>>,
}

const MAX_GENERATED: f64 = 1_000_000.0;

/// A function's dispatch facts (`formulaCallTable`'s entry), frozen into data/call_traits.json. Its per-position lists
/// hold only their head; past it they repeat with period two.
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Traits {
    pub kind: Kind,
    pub prep: Prep,
    pub inspects_null: bool,
    pub nullable_ok: bool,
    pub free: bool,
    pub matrix_args: bool,
    pub known: bool,
    pub checks_cx: bool,
    pub resolves: bool,
    #[serde(default)]
    pub refusal: Option<Refusal>,
    roles: Vec<Option<Role>>,
    blanks: Vec<serde_json::Value>,
    scalar: Vec<bool>,
    /// The name's facts the call path reads on every row, resolved once as the table loads ([[C120]] linearWork).
    #[serde(skip)]
    pub fast: Fast,
}

/// How a call reads its arguments (`formulaCallTable`'s kind).
#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Broadcast,
    Whole,
    Range,
    Handler,
}

/// How a range call readies its lists before the body reads them (`prepRangeArgs`).
#[derive(serde::Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Prep {
    /// Blanks drop.
    Default,
    /// Blanks read 0.
    Zero,
    /// A position blank in any list drops from every list.
    Paired,
    /// The lists as they come.
    Raw,
    /// As they come, and a matrix among them is refused.
    Positional,
}

/// A name's facts beside its traits: `ETA_HOSTS`, `LAMBDA_HOSTS`, `MEMO_SHAPERS`, `BRANCH_SELECTORS`, and whether the
/// core carries its body.
#[derive(Debug, Default)]
pub struct Fast {
    pub eta_host: bool,
    pub lambda_host: bool,
    pub memo_shaper: bool,
    pub ported: bool,
    pub selects: Option<fn(usize) -> bool>,
}

fn periodic<T>(xs: &[T], i: usize) -> Option<&T> {
    let n = xs.len();
    if i < n || n < 2 {
        return xs.get(i);
    }
    xs.get(if (i - n).is_multiple_of(2) { n - 2 } else { n - 1 })
}

impl Traits {
    pub fn role(&self, i: usize) -> Option<&Role> {
        periodic(&self.roles, i).and_then(Option::as_ref)
    }
    fn has_roles(&self) -> bool {
        self.roles.iter().any(Option::is_some)
    }
    /// An empty slot's reading, where the blank-slot pass sets one.
    fn blank(&self, i: usize) -> Option<&serde_json::Value> {
        periodic(&self.blanks, i).filter(|v| !v.is_null())
    }
    fn scalar(&self, i: usize) -> bool {
        periodic(&self.scalar, i).copied().unwrap_or(false)
    }
}

thread_local! {
    static TRAITS: FxHashMap<String, Rc<Traits>> = serde_json::from_str::<FxHashMap<String, Traits>>(include_str!("../data/call_traits.json"))
        .expect("data/call_traits.json reads")
        .into_iter()
        .map(|(k, mut v)| {
            v.fast = Fast {
                eta_host: ETA_HOSTS.contains(&k.as_str()),
                lambda_host: LAMBDA_HOSTS.contains(&k.as_str()),
                memo_shaper: MEMO_SHAPERS.contains(&k.as_str()),
                ported: is_ported(&k),
                selects: branch_selector(&k),
            };
            (k, Rc::new(v))
        })
        .collect();
}

/// The facts of an uppercased function name, if it is one.
pub fn traits(name: &str) -> Option<Rc<Traits>> {
    TRAITS.with(|t| t.get(name).cloned())
}

fn is_arr(v: &V) -> bool {
    matches!(v, V::List(_))
}

fn is_matrix(v: &V) -> bool {
    matches!(v, V::List(l) if matches!(l.first(), Some(V::List(_))))
}

fn rank_of(v: &V) -> u8 {
    if is_matrix(v) {
        2
    } else if is_arr(v) {
        1
    } else {
        0
    }
}

fn is_missing(v: &V) -> bool {
    matches!(v, V::Null)
}

fn contains_cx(a: &V) -> bool {
    match a {
        V::Cx(..) => true,
        V::List(l) => l.iter().any(|v| match v {
            V::List(r) => r.iter().any(|x| matches!(x, V::Cx(..))),
            other => matches!(other, V::Cx(..)),
        }),
        _ => false,
    }
}

fn too_deep(v: &V) -> bool {
    match v {
        V::List(rows) if is_matrix(v) => rows.iter().any(|r| matches!(r, V::List(cells) if cells.iter().any(is_arr))),
        _ => false,
    }
}

fn collapse_singleton_rank(v: &V) -> V {
    match v {
        V::List(rows) if is_matrix(v) => match (rows.len(), &rows[0]) {
            (1, V::List(r)) if r.len() == 1 => r[0].clone(),
            _ => v.clone(),
        },
        V::List(l) if l.len() == 1 && !is_arr(&l[0]) => l[0].clone(),
        other => other.clone(),
    }
}

/// The length a JS row reports: a non-array row has none, which no index is below.
fn row_len(r: &V) -> Option<usize> {
    if let V::List(cells) = r { Some(cells.len()) } else { None }
}

/// `mapCells`: the function over each cell of its arguments, by the broadcast-rules table.
pub fn map_cells(argv: &[V], cell: &mut dyn FnMut(&[V]) -> V) -> V {
    if argv.iter().any(too_deep) {
        return V::err(sol_error(ErrorCode::Shape, "A value nested deeper than a 2-D matrix isn't a thing formulas compute on"));
    }
    let args: Vec<V> = argv.iter().map(collapse_singleton_rank).collect();
    let rank = args.iter().map(rank_of).max().unwrap_or(0);
    if rank == 0 {
        return cell(&args);
    }
    if rank == 1 {
        let len = args.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max().unwrap_or(0);
        let mut out = Vec::with_capacity(len);
        let mut ops = Vec::with_capacity(args.len());
        for i in 0..len {
            if args.iter().any(|a| matches!(a, V::List(l) if i >= l.len())) {
                out.push(V::Null);
                continue;
            }
            ops.clear();
            ops.extend(args.iter().map(|a| if let V::List(l) = a { l[i].clone() } else { a.clone() }));
            out.push(cell(&ops));
        }
        return V::List(Rc::new(out));
    }
    let rows = args.iter().filter(|a| is_matrix(a)).filter_map(|m| if let V::List(r) = m { Some(r.len()) } else { None }).max().unwrap_or(0);
    let col_singleton: Vec<bool> = args
        .iter()
        .map(|a| is_matrix(a) && matches!(a, V::List(rs) if rs.iter().all(|r| row_len(r) == Some(1))))
        .collect();
    // `Math.max` over a row with no length is NaN, which no column index is below.
    let mut cols: Option<usize> = Some(1);
    for (k, a) in args.iter().enumerate() {
        let w = match a {
            V::List(rs) if is_matrix(a) => {
                if col_singleton[k] {
                    Some(1)
                } else {
                    rs.iter().try_fold(0usize, |n, r| row_len(r).map(|l| n.max(l)))
                }
            }
            V::List(l) => Some(l.len()),
            _ => Some(1),
        };
        cols = match (cols, w) {
            (Some(c), Some(w)) => Some(c.max(w)),
            _ => None,
        };
    }
    let cols = cols.unwrap_or(0);
    let cell_at = |k: usize, i: usize, j: usize| -> Option<V> {
        let a = &args[k];
        match a {
            V::List(rs) if is_matrix(a) => {
                let ri = if rs.len() == 1 { 0 } else { i };
                let row = rs.get(ri)?;
                let cj = if col_singleton[k] { 0 } else { j };
                if let V::List(cells) = row { cells.get(cj).cloned() } else { None }
            }
            V::List(l) => l.get(j).cloned(),
            other => Some(other.clone()),
        }
    };
    let mut out = Vec::with_capacity(rows);
    for i in 0..rows {
        let mut row = Vec::with_capacity(cols);
        for j in 0..cols {
            let ops: Option<Vec<V>> = (0..args.len()).map(|k| cell_at(k, i, j)).collect();
            row.push(match ops {
                Some(ops) => cell(&ops),
                None => V::Null,
            });
        }
        out.push(V::List(Rc::new(row)));
    }
    V::List(Rc::new(out))
}

/// `formatCx` at four digits.
pub(crate) fn format_cx(re: f64, im: f64) -> String {
    let fmt = |n: f64| {
        if n.fract() == 0.0 && n.is_finite() {
            crate::jsnum::number_to_string(n)
        } else {
            let s = crate::jsnum::to_fixed(n, 4.0).unwrap_or_default();
            // `.replace(/\.?0+$/, "")`
            let t = s.trim_end_matches('0');
            if t.len() < s.len() { t.strip_suffix('.').unwrap_or(t).to_string() } else { s }
        }
    };
    if re.is_nan() || im.is_nan() {
        return "NaN".into();
    }
    let r = fmt(re);
    let ia = im.abs();
    let i = if ia == 1.0 { "i".to_string() } else { format!("{}i", fmt(ia)) };
    if im == 0.0 {
        return r;
    }
    if re == 0.0 {
        return if im < 0.0 { format!("-{i}") } else { i };
    }
    if im < 0.0 { format!("{r} - {i}") } else { format!("{r} + {i}") }
}

fn apply_cx_op(op: BinOp, a: &V, b: &V) -> V {
    match op {
        BinOp::Concat => {
            let s = |v: &V| match v {
                V::Cx(re, im) => format_cx(*re, *im),
                V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
                V::Num(n) => crate::excel_formula::number_to_text(*n),
                other => crate::excel_functions::js_string_of(other),
            };
            V::Str(Rc::from(s(a) + &s(b)))
        }
        BinOp::Eq | BinOp::Ne => {
            let eq = matches!((a, b), (V::Cx(ar, ai), V::Cx(br, bi)) if ar == br && ai == bi);
            V::Bool(if op == BinOp::Eq { eq } else { !eq })
        }
        BinOp::Lt | BinOp::Gt | BinOp::Le | BinOp::Ge => V::err(sol_error(ErrorCode::Type, "Complex numbers have no order. Compare their IMABS values instead")),
        BinOp::Add | BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Pow => V::err(sol_error(ErrorCode::Type, "Operators don't work on complex numbers. Use IMSUM, IMSUB, IMPRODUCT or IMDIV")),
    }
}

/// `applyOp`, with complex and LAMBDA operands caught first.
fn op2(op: BinOp, a: &V, b: &V) -> V {
    if a.is_err() {
        return a.clone();
    }
    if b.is_err() {
        return b.clone();
    }
    if is_missing(a) || is_missing(b) {
        return V::Null;
    }
    if matches!(a, V::Cx(..)) || matches!(b, V::Cx(..)) {
        return apply_cx_op(op, a, b);
    }
    if matches!(a, V::Lambda(_)) || matches!(b, V::Lambda(_)) {
        return V::err(sol_error(ErrorCode::Type, "A LAMBDA isn't a value. Call it with (…) or pass it to MAP, REDUCE and the other helpers"));
    }
    apply_op(op, a, b)
}

/// `-x`, `+x`: JavaScript's unary coercion.
fn js_unary(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => crate::jsnum::string_to_number(s),
        V::List(_) => crate::jsnum::string_to_number(&crate::excel_functions::js_string_of(v)),
        _ => f64::NAN,
    }
}

const ETA_HOSTS: [&str; 6] = ["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"];
const LAMBDA_HOSTS: [&str; 7] = ["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY", "GROUPBY"];

/// A column a row formula reads as values (`RowColumn`): a Cube's, whose rows may hold lists, each row's value and,
/// where it isn't simply its rows, its whole read ([[C22]] rowFormulaRefs).
#[derive(Clone, Debug)]
pub struct RowColumn {
    pub name: String,
    pub values: Vec<V>,
    pub whole: Option<V>,
}

/// The columns a computed column reads: a frame's cells, or columns read as values.
pub enum Table<'a> {
    Frame(&'a crate::frame::FrameValue),
    Rows(Vec<&'a RowColumn>),
}

#[derive(Clone, Copy)]
enum Col<'a> {
    Frame(&'a FrameColumn),
    Row(&'a RowColumn),
}

impl Col<'_> {
    /// `c.values[i] ?? null`.
    fn cell(&self, i: usize) -> V {
        match self {
            Col::Frame(c) => cell_to_v(c.cell_at(i)),
            Col::Row(c) => match c.values.get(i) {
                None | Some(V::Undef) => V::Null,
                Some(v) => v.clone(),
            },
        }
    }

    fn name(&self) -> &str {
        match self {
            Col::Frame(c) => &c.name,
            Col::Row(c) => &c.name,
        }
    }
}

/// A computed column's row (`runColumn`'s row frame): what `@name`, `[name]` and ROW() read.
pub struct RowCtx<'a> {
    cols: FxHashMap<&'a str, Col<'a>>,
    alias: FxHashMap<String, String>,
    reserved: Vec<String>,
    rows: usize,
    cursor: Cell<usize>,
    wholes: RefCell<FxHashMap<String, V>>,
    /// `sideValue(name, "row")` for each name the formula reads by `@` that no column holds.
    row_sides: FxHashMap<String, V>,
    at_verdict: RefCell<FxHashMap<String, AtVerdict>>,
}

/// An `@name` list's verdict, held with the list itself: an address alone could name the next list allocated there.
struct AtVerdict {
    list: Rc<Vec<V>>,
    err: Option<V>,
}

impl<'a> RowCtx<'a> {
    fn column(&self, key: &str) -> Option<Col<'a>> {
        match self.alias.get(key) {
            Some(target) => self.cols.get(target.as_str()).copied(),
            None => self.cols.get(key).copied(),
        }
    }

    fn reserved_err(key: &str) -> V {
        V::err(sol_error(ErrorCode::Ref, format!("\"{key}\" is a reserved input name. Rename the variable or the column")))
    }

    /// `wholeOf`: a column as a one-column table, or its own whole read, built once.
    fn whole_of(&self, c: Col) -> V {
        self.wholes
            .borrow_mut()
            .entry(c.name().to_string())
            .or_insert_with(|| match c {
                Col::Frame(c) => list((0..c.values.len()).map(|i| list(vec![cell_to_v(c.cell_at(i))])).collect()),
                Col::Row(RowColumn { whole: Some(w), .. }) => w.clone(),
                Col::Row(c) => list(c.values.iter().map(|v| list(vec![v.clone()])).collect()),
            })
            .clone()
    }

    /// A wired list with one value per row reads as a column beside the table's ([[D85]] columnsStayColumns).
    fn aligned(&self, v: V) -> V {
        match &v {
            V::List(l) if l.len() == self.rows && self.rows > 1 && !l.iter().any(is_arr) => list(l.iter().map(|x| list(vec![x.clone()])).collect()),
            _ => v,
        }
    }

    fn at(&self, key: &str, v: &V) -> V {
        let V::List(items) = v else { return v.clone() };
        let mut verdicts = self.at_verdict.borrow_mut();
        let fresh = !verdicts.get(key).is_some_and(|v| Rc::ptr_eq(&v.list, items));
        if fresh {
            let n = self.rows;
            let err = if items.iter().any(is_arr) {
                Some(V::err(sol_error(ErrorCode::Shape, format!("@{key} reads one value per row, and a matrix has no single this-row value"))))
            } else if items.len() != n {
                let l = items.len();
                Some(V::err(sol_error(ErrorCode::Shape, format!("@{key}: {l} value{} for {n} row{}", if l == 1 { "" } else { "s" }, if n == 1 { "" } else { "s" }))))
            } else {
                None
            };
            verdicts.insert(key.to_string(), AtVerdict { list: items.clone(), err });
        }
        if let Some(AtVerdict { err: Some(e), .. }) = verdicts.get(key) {
            return e.clone();
        }
        match items.get(self.cursor.get()) {
            None | Some(V::Undef) => V::Null,
            Some(x) => x.clone(),
        }
    }

    fn side(&self, key: &str) -> V {
        if self.reserved.iter().any(|r| r == key) {
            return Self::reserved_err(key);
        }
        self.at(key, &self.row_sides.get(key).cloned().unwrap_or(V::Undef))
    }

    fn whole(&self, key: &str) -> V {
        if let Some(c) = self.column(key) {
            return self.whole_of(c);
        }
        if self.reserved.iter().any(|r| r == key) {
            return Self::reserved_err(key);
        }
        self.aligned(self.row_sides.get(key).cloned().unwrap_or(V::Undef))
    }
}


/// `Object.is` over the values a range call's memo compares: a list or error by identity, the rest by value.
fn same(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::List(x), V::List(y)) => Rc::ptr_eq(x, y),
        (V::Err(x), V::Err(y)) => Rc::ptr_eq(x, y),
        (V::Lambda(x), V::Lambda(y)) => Rc::ptr_eq(x, y),
        (V::Num(x), V::Num(y)) => x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()),
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Fx(x), V::Fx(y)) => x == y,
        (V::Cx(a, b), V::Cx(c, d)) => a.to_bits() == c.to_bits() && b.to_bits() == d.to_bits(),
        _ => false,
    }
}

/// These answer a list built fresh from a whole column, so the memo keeps it, and the range function reading it hits
/// its own memo too ([[C120]] linearWork).
const MEMO_SHAPERS: [&str; 6] = ["FILTER", "UNIQUE", "SORT", "SORTBY", "TAKE", "DROP"];

/// `BRANCH_SELECTORS`: the arguments that pick a branch. Only an error there is the call's answer; an error in a branch
/// not taken isn't, as in Excel, so `IF(@qty = 0, 0, @total / @qty)` guards its division.
fn branch_selector(name: &str) -> Option<fn(usize) -> bool> {
    match name {
        "IF" | "CHOOSE" => Some(|i| i == 0),
        "IFS" => Some(|i| i % 2 == 0),
        _ => None,
    }
}

#[derive(Default)]
pub struct Eval<'a> {
    row: Option<&'a RowCtx<'a>>,
    /// Keeps the range memo across calls outside a row too: a formula evaluated once per item (`formula`).
    memo_calls: bool,
    /// `rangeMemo`: a range function called again with the very same arguments (a whole column, row after row).
    memo: RefCell<FxHashMap<*const Ast, Memo>>,
    /// Each call site's name, facts and empty slots, read once per site rather than once per row.
    sites: RefCell<FxHashMap<*const u8, Rc<Site>>>,
    /// A LAMBDA's body, cloned once and kept while this evaluator lives: the memo and the sites are keyed by node
    /// address, which a body cloned per call and dropped would hand to the next one. A wired LAMBDA's tree is parsed
    /// per call and dropped, so its address can come back holding another body: an entry answers only an equal one.
    bodies: RefCell<FxHashMap<*const Ast, Rc<Ast>>>,
}

/// A range call's last answer at its site.
struct Memo {
    name: String,
    args: Vec<V>,
    answer: V,
}

impl Memo {
    fn answers(&self, name: &str, argv: &[V]) -> Option<V> {
        (self.name == name && self.args.len() == argv.len() && self.args.iter().zip(argv).all(|(a, b)| same(a, b))).then(|| self.answer.clone())
    }
}

struct Site {
    raw: String,
    name: String,
    traits: Option<Rc<Traits>>,
    empty: Vec<bool>,
    any_empty: bool,
}

impl Eval<'_> {
    fn site(&self, raw: &str, args: &[Ast]) -> Rc<Site> {
        let key = raw.as_ptr();
        if let Some(s) = self.sites.borrow().get(&key) {
            if s.raw == raw && s.empty.len() == args.len() && s.empty.iter().zip(args).all(|(e, a)| *e == matches!(a, Ast::Blank)) {
                return s.clone();
            }
        }
        let name = raw.to_uppercase();
        let empty: Vec<bool> = args.iter().map(|a| matches!(a, Ast::Blank)).collect();
        let site = Rc::new(Site { raw: raw.to_string(), traits: traits(&name), any_empty: empty.contains(&true), empty, name });
        self.sites.borrow_mut().insert(key, site.clone());
        site
    }

    /// `compileEvaluator`'s answer: a LAMBDA left uncalled is an error, a Formula.js error reads as Solenoid's.
    pub fn run(&self, ast: &Ast, env: &Rc<Env>) -> V {
        match self.eval(ast, env) {
            V::Lambda(_) => V::err(sol_error(ErrorCode::Value, "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY")),
            V::Fx(code) => V::err(fx_error_to_sol(code)),
            other => other,
        }
    }

    fn eta_or_eval(&self, a: &Ast, env: &Rc<Env>) -> V {
        if let Ast::Name(name) = a {
            if !env.contains_key(name) && constant_value(name).is_none() {
                let up = name.to_uppercase();
                if traits(&up).is_some_and(|t| t.resolves) {
                    return V::Lambda(Rc::new(LambdaV { env: env.clone(), eta: Some(up), ..Default::default() }));
                }
            }
        }
        self.eval(a, env)
    }

    pub fn eval(&self, n: &Ast, env: &Rc<Env>) -> V {
        match n {
            Ast::Num(_, v) => V::Num(*v),
            Ast::Str(s) => V::Str(s.clone()),
            Ast::Bool(b) => V::Bool(*b),
            Ast::Blank => V::Null,
            Ast::AtCol(name) => match self.row {
                None => V::err(sol_error(ErrorCode::Ref, "@ reads the current row, so it only works inside a computed column")),
                Some(row) => match row.column(name) {
                    Some(c) => c.cell(row.cursor.get()),
                    None => match env.get(name) {
                        Some(v) => row.at(name, v),
                        None => row.side(name),
                    },
                },
            },
            Ast::WholeCol(name) => match self.row {
                None => V::err(sol_error(ErrorCode::Ref, "[column] reads a whole table column, so it only works inside a computed column")),
                Some(row) => row.whole(name),
            },
            Ast::Name(name) => constant_value(name).map_or_else(|| env.get(name).cloned().unwrap_or(V::Undef), V::Num),
            Ast::Unary { op, arg } => {
                let a = self.eval(arg, env);
                let neg = *op == UnaryOp::Neg;
                let f = |x: &V| match x {
                    V::Err(_) => x.clone(),
                    V::Null => V::Null,
                    V::Cx(..) => V::err(sol_error(ErrorCode::Type, "Operators don't work on complex numbers. Use IMSUB(0, z) to negate")),
                    other => V::Num(if neg { -js_unary(other) } else { js_unary(other) }),
                };
                if is_arr(&a) {
                    map_cells(&[a], &mut |x| f(&x[0]))
                } else if a.is_err() {
                    a
                } else {
                    f(&a)
                }
            }
            Ast::Percent(arg) => {
                let a = self.eval(arg, env);
                let f = |x: &V| match x {
                    V::Err(_) => x.clone(),
                    V::Null => V::Null,
                    V::Cx(..) => V::err(sol_error(ErrorCode::Type, "Operators don't work on complex numbers. Use IMDIV(z, COMPLEX(100, 0))")),
                    other => V::Num(js_unary(other) / 100.0),
                };
                if is_arr(&a) {
                    map_cells(&[a], &mut |x| f(&x[0]))
                } else if a.is_err() {
                    a
                } else {
                    f(&a)
                }
            }
            Ast::Bin { op, l, r } => {
                let (l, r) = (self.eval(l, env), self.eval(r, env));
                if is_arr(&l) || is_arr(&r) {
                    return map_cells(&[l, r], &mut |x| op2(*op, &x[0], &x[1]));
                }
                op2(*op, &l, &r)
            }
            Ast::Apply { func, args } => {
                let f = self.eval(func, env);
                if f.is_err() {
                    return f;
                }
                let V::Lambda(lam) = f else {
                    return V::err(sol_error(ErrorCode::Value, "Only a LAMBDA can be called like a function"));
                };
                let argv: Vec<V> = args.iter().map(|a| self.eta_or_eval(a, env)).collect();
                if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
                    return e.clone();
                }
                let p = lam.params.len();
                if p > 0 && argv.len() != p {
                    return V::err(sol_error(ErrorCode::Value, format!("This LAMBDA takes {p} argument{}, not {}", if p == 1 { "" } else { "s" }, argv.len())));
                }
                self.call_lambda(&lam, &argv)
            }
            Ast::Call { name: raw, args } => self.call(raw, args, env),
        }
    }

    /// `lam.fn(...args)`.
    pub fn call_lambda(&self, lam: &LambdaV, args: &[V]) -> V {
        if let Some(name) = &lam.eta {
            return match self.dispatch(name, None, args) {
                V::Num(r) => guard(r, args),
                r => r,
            };
        }
        let body = lam.body.as_ref().expect("a LAMBDA has a body");
        if let Some(captured) = &lam.captured {
            // `compilePositional` over the parameters, then the captures; a column outranks a capture ([[C22]] rowFormulaRefs).
            let mut inner: Env = FxHashMap::default();
            for (i, p) in lam.params.iter().enumerate() {
                inner.insert(p.clone(), args.get(i).cloned().unwrap_or(V::Undef));
            }
            for c in captured {
                let v = match self.row.and_then(|r| r.column(c).map(|col| r.whole_of(col))) {
                    Some(whole) => whole,
                    None => lam.env.get(c).cloned().unwrap_or(V::Undef),
                };
                inner.insert(c.clone(), v);
            }
            return self.run(body, &Rc::new(inner));
        }
        let mut inner: Env = (*lam.env).clone();
        for (i, p) in lam.params.iter().enumerate() {
            inner.insert(p.clone(), args.get(i).cloned().unwrap_or(V::Undef));
        }
        self.eval(body, &Rc::new(inner))
    }

    fn call(&self, raw: &str, args: &[Ast], env: &Rc<Env>) -> V {
        if let Some(V::Lambda(bound)) = env.get(raw) {
            let bound = bound.clone();
            let argv: Vec<V> = args.iter().map(|a| self.eval(a, env)).collect();
            if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            let p = bound.params.len();
            if p > 0 && argv.len() != p {
                return V::err(sol_error(ErrorCode::Value, format!("{raw} takes {p} argument{}, not {}", if p == 1 { "" } else { "s" }, argv.len())));
            }
            return self.call_lambda(&bound, &argv);
        }
        let site = self.site(raw, args);
        let name = &site.name;
        if name == "LAMBDA" {
            let Some((body, ps)) = args.split_last() else {
                return V::err(sol_error(ErrorCode::Value, "LAMBDA needs a body: LAMBDA(param…, body)"));
            };
            let mut params: Vec<String> = Vec::with_capacity(ps.len());
            for a in ps {
                let Ast::Name(p) = a else {
                    return V::err(sol_error(ErrorCode::Value, "LAMBDA parameters must be plain names"));
                };
                if params.contains(p) {
                    return V::err(sol_error(ErrorCode::Name, format!("LAMBDA parameter {p} appears twice")));
                }
                // [[D77]] constantsAlwaysWin
                if constant_value(p).is_some() {
                    return V::err(sol_error(ErrorCode::Name, format!("{p} is a constant, so it can't name a LAMBDA parameter")));
                }
                params.push(p.clone());
            }
            let kept = self.bodies.borrow().get(&(body as *const Ast)).filter(|b| ***b == *body).cloned();
            let body = kept.unwrap_or_else(|| {
                let b = Rc::new(body.clone());
                self.bodies.borrow_mut().insert(body as *const Ast, b.clone());
                b
            });
            return V::Lambda(Rc::new(LambdaV { params, body: Some(body), env: env.clone(), ..Default::default() }));
        }
        let Some(t) = site.traits.as_deref() else { return V::err(sol_error(ErrorCode::Name, format!("Unknown function {name}"))) };
        if let Some(r) = &t.refusal {
            return V::err(sol_error(r.code, r.message.as_str()));
        }
        let mut argv: Vec<V> = if t.fast.eta_host {
            args.iter().map(|a| self.eta_or_eval(a, env)).collect()
        } else {
            args.iter().map(|a| self.eval(a, env)).collect()
        };
        let roled = apply_arg_roles(name, t, &site.empty, &mut argv);
        let settled: &[bool] = roled.as_deref().unwrap_or(&site.empty);
        if site.any_empty {
            for (i, a) in args.iter().enumerate() {
                if matches!(a, Ast::Blank) {
                    if let Some(v) = t.blank(i) {
                        argv[i] = lowered(v);
                    }
                }
            }
        }
        if t.kind == Kind::Handler {
            return crate::excel_functions::error_handler(name, &argv);
        }
        let selects = t.fast.selects;
        if let Some(e) = argv.iter().enumerate().find(|&(i, v)| selects.is_none_or(|s| s(i)) && v.is_sol_error()) {
            return e.1.clone();
        }
        let any_arr = argv.iter().any(is_arr);
        let lifted: Vec<usize> = if any_arr { (0..argv.len()).filter(|&i| t.scalar(i) && is_arr(&argv[i])).collect() } else { Vec::new() };
        if lifted.is_empty() {
            if any_arr && (self.row.is_some() || self.memo_calls) && (t.kind == Kind::Range || t.fast.memo_shaper) {
                let key = args.as_ptr();
                if let Some(r) = self.memo.borrow().get(&key).and_then(|m| m.answers(name, &argv)) {
                    return r;
                }
                let r = self.route_call(name, t, argv.clone(), settled);
                if !is_arr(&r) || t.fast.memo_shaper {
                    self.memo.borrow_mut().insert(key, Memo { name: name.clone(), args: argv, answer: r.clone() });
                }
                return r;
            }
            return self.route_call(name, t, argv, settled);
        }
        let cols: Vec<V> = lifted.iter().map(|&i| argv[i].clone()).collect();
        map_cells(&cols, &mut |cells| {
            if let Some(bad) = cells.iter().enumerate().find(|&(k, v)| selects.is_none_or(|s| s(lifted[k])) && v.is_err()) {
                return bad.1.clone();
            }
            if cells.iter().any(is_missing) {
                return V::Null;
            }
            let mut one = argv.clone();
            for (k, &i) in lifted.iter().enumerate() {
                one[i] = cells[k].clone();
            }
            self.route_call(name, t, one, settled)
        })
    }

    /// Steps 9 to 11 of the dispatch ladder (`routeCall`).
    fn route_call(&self, name: &str, t: &Traits, mut argv: Vec<V>, settled: &[bool]) -> V {
        let mut column = false;
        if t.free {
            if let Some((read, col)) = read_vectors(&argv) {
                argv = read;
                column = col;
            }
        }
        if !t.matrix_args && argv.iter().any(is_matrix) {
            if t.prep == Prep::Positional {
                return V::err(sol_error(ErrorCode::Shape, format!("{name} over a matrix isn't supported yet. Wire the matrix through its node")));
            }
            if t.kind == Kind::Range {
                argv = argv.into_iter().map(|a| if is_matrix(&a) { flat1(&a) } else { a }).collect();
            } else if t.kind == Kind::Whole || !t.known {
                return V::err(sol_error(ErrorCode::Shape, format!("{name} works on values and 1-D lists, not a 2-D matrix")));
            }
        }
        if t.checks_cx && argv.iter().any(contains_cx) {
            return V::err(sol_error(ErrorCode::Type, format!("{name} doesn't compute on complex numbers. Use the IM* family")));
        }
        match t.kind {
            Kind::Whole => {
                if !t.nullable_ok && argv.iter().enumerate().any(|(i, a)| is_missing(a) && !settled.get(i).copied().unwrap_or(false)) {
                    return V::Null;
                }
                let r = self.dispatch(name, Some(t), &argv);
                if column { as_column(r) } else { r }
            }
            Kind::Range => {
                let args = match prep_range_args(t.prep, argv) {
                    Ok(a) => a,
                    Err(e) => return e,
                };
                let flat_owned: Vec<V>;
                let flat: &[V] = if args.iter().any(|a| matches!(a, V::List(_))) {
                    flat_owned = args.iter().flat_map(|a| if let V::List(l) = a { l.as_ref().clone() } else { vec![a.clone()] }).collect();
                    &flat_owned
                } else {
                    &args
                };
                // The range bodies read their lists flat, but for those that read each list in place. A value nested
                // past a table would reach a flat reader as a list among its numbers.
                let in_place = crate::excel_functions::reads_lists(name);
                if !in_place && flat.iter().any(is_arr) {
                    return V::err(sol_error(ErrorCode::Value, format!("{name} reads values and tables, not lists nested inside a table")));
                }
                match self.dispatch(name, Some(t), if in_place { &args } else { flat }) {
                    V::Num(r) if !r.is_finite() => guard(r, flat),
                    r => r,
                }
            }
            _ => self.broadcast_call(name, t, &argv, settled),
        }
    }

    fn broadcast_call(&self, name: &str, t: &Traits, argv: &[V], blank_slots: &[bool]) -> V {
        let whole_at = match name {
            "WORKDAY" | "NETWORKDAYS" => Some(2),
            "WORKDAY.INTL" | "NETWORKDAYS.INTL" => Some(3),
            _ => None,
        };
        if let Some(w) = whole_at {
            if let Some(list @ V::List(_)) = argv.get(w) {
                let V::List(items) = flat1(list) else { unreachable!() };
                if let Some(e) = items.iter().find(|v| v.is_sol_error()) {
                    return e.clone();
                }
                let whole = V::List(Rc::new(items.iter().filter(|v| !matches!(v, V::Null | V::Undef)).cloned().collect()));
                let rest: Vec<V> = argv.iter().enumerate().filter(|&(i, _)| i != w).map(|(_, v)| v.clone()).collect();
                let blanks: Vec<bool> = (0..argv.len()).filter(|&i| i != w).map(|i| blank_slots.get(i).copied().unwrap_or(false)).collect();
                return self.broadcast_with(&rest, &blanks, t.inspects_null, &|args: &[V]| {
                    let mut full: Vec<V> = args[..w.min(args.len())].to_vec();
                    full.push(whole.clone());
                    full.extend_from_slice(&args[w.min(args.len())..]);
                    self.dispatch(name, Some(t), &full)
                }, None);
            }
        }
        self.broadcast_with(argv, blank_slots, t.inspects_null, &|args: &[V]| self.dispatch(name, Some(t), args), t.fast.selects)
    }

    fn broadcast_with(&self, argv: &[V], blank_slots: &[bool], inspects_null: bool, f: &dyn Fn(&[V]) -> V, selects: Option<fn(usize) -> bool>) -> V {
        let call = |args: &[V]| match f(args) {
            V::Num(r) => guard(r, args),
            r => r,
        };
        if !argv.iter().any(is_arr) {
            let blank = argv.iter().enumerate().any(|(i, v)| is_missing(v) && !blank_slots.get(i).copied().unwrap_or(false));
            return if !inspects_null && blank { V::Null } else { call(argv) };
        }
        let len = argv.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max().unwrap_or(0);
        if len == 0 {
            return V::List(Rc::new(Vec::new()));
        }
        map_cells(argv, &mut |ops| {
            if let Some(e) = ops.iter().enumerate().find(|&(i, v)| selects.is_none_or(|s| s(i)) && v.is_sol_error()) {
                return e.1.clone();
            }
            if !inspects_null && ops.iter().any(is_missing) {
                return V::Null;
            }
            call(ops)
        })
    }

    /// `dispatch`: the body itself, its JavaScript failure read as #VALUE!.
    fn dispatch(&self, name: &str, t: Option<&Traits>, argv: &[V]) -> V {
        let (lambda_host, ported) = match t {
            Some(t) => (t.fast.lambda_host, t.fast.ported),
            None => (LAMBDA_HOSTS.contains(&name), is_ported(name)),
        };
        if lambda_host {
            return self.host(name, argv);
        }
        if !ported {
            return V::err(sol_error(ErrorCode::Name, format!("Unknown function {name}")));
        }
        if argv.iter().any(is_matrix) && !crate::excel_functions::reads_matrices(name) {
            return V::err(sol_error(ErrorCode::Shape, format!("{name} works on values and 1-D lists, not a 2-D matrix")));
        }
        call_caught(name, argv)
    }

    /// MAP, BYROW, BYCOL, REDUCE, SCAN and MAKEARRAY (excelFunctions.ts), which call their LAMBDA back.
    fn host(&self, name: &str, a: &[V]) -> V {
        let arg = |i: usize| a.get(i).cloned().unwrap_or(V::Undef);
        let last = if name == "MAP" { a.last().cloned().unwrap_or(V::Undef) } else { arg(if matches!(name, "MAKEARRAY" | "REDUCE" | "SCAN" | "GROUPBY") { 2 } else { 1 }) };
        let V::Lambda(lam) = last else {
            return V::err(sol_error(ErrorCode::Value, format!("{name} needs a LAMBDA as its last argument")));
        };
        // `etaFn`: a function named bare gets only the arguments that mean something to it.
        let call = |args: &[V], meaningful: usize| -> V {
            if lam.eta.is_some() { self.call_lambda(&lam, &args[..meaningful.min(args.len())]) } else { self.call_lambda(&lam, args) }
        };
        let absent = |v: &V| matches!(v, V::Null | V::Undef);
        // `oneValue`: the LAMBDA answers one value each time, as Excel's does; a list would nest past a table.
        // A list or table of one cell is that cell, as Excel reads a 1×1 array.
        let one = |each: &str, r: V| match r {
            V::List(l) => {
                let cell = match l.as_slice() {
                    [V::List(row)] => match row.as_slice() {
                        [c] if !matches!(c, V::List(_)) => Some(c.clone()),
                        _ => None,
                    },
                    [c] => Some(c.clone()),
                    _ => None,
                };
                cell.unwrap_or_else(|| V::err(sol_error(ErrorCode::Shape, format!("{name}'s LAMBDA answers one value for each {each}, not a list"))))
            }
            other => other,
        };
        match name {
            "MAP" => {
                let arrays = &a[..a.len() - 1];
                if arrays.is_empty() || arrays.len() > 3 {
                    return V::err(sol_error(ErrorCode::Value, "MAP takes 1–3 arrays and a LAMBDA"));
                }
                if arrays.iter().any(absent) {
                    return V::Null;
                }
                let shaped: Vec<Vec<Vec<V>>> = arrays.iter().map(|v| as_rows(v).unwrap_or_default()).collect();
                let rows = shaped.iter().map(Vec::len).max().unwrap_or(0);
                let cols = shaped.iter().flatten().map(Vec::len).max().unwrap_or(0);
                let cell_at = |k: usize, i: usize, j: usize| shaped.get(k).and_then(|m| m.get(i)).and_then(|r| r.get(j)).cloned().unwrap_or(V::Null);
                let out: Vec<Vec<V>> = (0..rows)
                    .map(|i| {
                        (0..cols)
                            .map(|j| one("cell", call(&[cell_at(0, i, j), cell_at(1, i, j), cell_at(2, i, j), V::Num((i + 1) as f64), V::Num((j + 1) as f64)], arrays.len())))
                            .collect()
                    })
                    .collect();
                like_input(&arrays[0], out)
            }
            "BYROW" => match as_rows(&arg(0)) {
                None => V::Null,
                Some(m) => list(m.into_iter().map(|row| list(vec![one("row", call(&[list(row)], 1))])).collect()),
            },
            "BYCOL" => match as_rows(&arg(0)) {
                None => V::Null,
                Some(m) => {
                    let cols = m.iter().map(Vec::len).max().unwrap_or(0);
                    list((0..cols).map(|j| one("column", call(&[list(m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Null)).collect())], 1))).collect())
                }
            },
            "REDUCE" => {
                let Some(m) = as_rows(&arg(1)) else { return V::Null };
                let mut acc = if absent(&arg(0)) { V::Null } else { arg(0) };
                let mut step = 0.0;
                for cell in m.into_iter().flatten() {
                    if cell.is_sol_error() {
                        return cell;
                    }
                    step += 1.0;
                    acc = call(&[acc, cell, V::Num(step)], 2);
                    if acc.is_sol_error() {
                        return acc;
                    }
                }
                acc
            }
            "SCAN" => {
                let v = arg(1);
                let Some(m) = as_rows(&v) else { return V::Null };
                let mut acc = if absent(&arg(0)) { V::Null } else { arg(0) };
                let mut step = 0.0;
                let mut poisoned: Option<V> = None;
                let out: Vec<Vec<V>> = m
                    .into_iter()
                    .map(|row| {
                        row.into_iter()
                            .map(|cell| {
                                if let Some(p) = &poisoned {
                                    return p.clone();
                                }
                                if cell.is_sol_error() {
                                    poisoned = Some(cell.clone());
                                    return cell;
                                }
                                step += 1.0;
                                acc = one("step", call(&[acc.clone(), cell, V::Num(step)], 2));
                                if acc.is_sol_error() {
                                    poisoned = Some(acc.clone());
                                }
                                acc.clone()
                            })
                            .collect()
                    })
                    .collect();
                like_input(&v, out)
            }
            "MAKEARRAY" => {
                if absent(&arg(0)) || absent(&arg(1)) {
                    return V::Null;
                }
                // JS's Math.max: NaN stays NaN, so a NaN side passes the cap and builds nothing.
                let js_max = |a: f64, b: f64| if a.is_nan() { a } else { a.max(b) };
                let side = |v: &V| js_max(js_unary(v).floor(), 0.0);
                let (r, c) = (side(&arg(0)), side(&arg(1)));
                // Each side counts as at least one, so a zero side can't hide a huge other one.
                let cells = js_max(r, 1.0) * js_max(c, 1.0);
                if cells > MAX_GENERATED {
                    return V::err(sol_error(ErrorCode::Overflow, format!("MAKEARRAY count {} exceeds the 1000000 element limit", crate::jsnum::number_to_string(cells))));
                }
                let (r, c) = (if r.is_nan() { 0.0 } else { r }, if c.is_nan() { 0.0 } else { c });
                list((0..r as usize).map(|i| list((0..c as usize).map(|j| one("cell", self.call_lambda(&lam, &[V::Num((i + 1) as f64), V::Num((j + 1) as f64)]))).collect())).collect())
            }
            "GROUPBY" => {
                if absent(&arg(0)) || absent(&arg(1)) {
                    return V::Null;
                }
                let items = |v: V| match v {
                    V::List(l) => l.as_ref().clone(),
                    other => vec![other],
                };
                let (ks, vs) = (items(arg(0)), items(arg(1)));
                let mut index: std::collections::HashMap<crate::fns_matrix::Key, usize> = std::collections::HashMap::new();
                let mut groups: Vec<(V, Vec<V>)> = Vec::new();
                for (k, v) in ks.iter().zip(&vs) {
                    match index.get(&crate::fns_matrix::set_key(k)) {
                        Some(&g) => groups[g].1.push(v.clone()),
                        None => {
                            index.insert(crate::fns_matrix::set_key(k), groups.len());
                            groups.push((k.clone(), vec![v.clone()]));
                        }
                    }
                }
                list(groups.into_iter().map(|(k, vals)| list(vec![k, call(&[list(vals)], 1)])).collect())
            }
            _ => V::err(sol_error(ErrorCode::Name, format!("Unknown function {name}"))),
        }
    }
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

/// `asRows`: a matrix's rows, a list as one row, a value as a one-cell grid.
fn as_rows(v: &V) -> Option<Vec<Vec<V>>> {
    match v {
        V::Null | V::Undef => None,
        V::List(rs) if is_matrix(v) => Some(rs.iter().map(|r| if let V::List(c) = r { c.as_ref().clone() } else { Vec::new() }).collect()),
        V::List(l) => Some(vec![l.as_ref().clone()]),
        other => Some(vec![vec![other.clone()]]),
    }
}

/// `likeInput`: a matrix in answers a matrix; a list in answers its one row.
fn like_input(v: &V, mut rows: Vec<Vec<V>>) -> V {
    if !is_matrix(v) && rows.len() == 1 {
        return list(rows.pop().unwrap_or_default());
    }
    list(rows.into_iter().map(list).collect())
}

/// `Array.prototype.flat()`, one level.
fn flat1(v: &V) -> V {
    match v {
        V::List(l) => list(l.iter().flat_map(|x| if let V::List(inner) = x { inner.as_ref().clone() } else { vec![x.clone()] }).collect()),
        other => other.clone(),
    }
}

/// `readVectors` ([[D85]] columnsStayColumns): a one-column or one-row table reads as its items.
fn read_vectors(argv: &[V]) -> Option<(Vec<V>, bool)> {
    let mut first: Option<bool> = None;
    let mut changed = false;
    let out: Vec<V> = argv
        .iter()
        .map(|a| {
            if !is_matrix(a) {
                if first.is_none() && is_arr(a) {
                    first = Some(false);
                }
                return a.clone();
            }
            let V::List(rows) = a else { unreachable!() };
            if rows.len() > 1 && rows.iter().all(|r| row_len(r) == Some(1)) {
                first.get_or_insert(true);
                changed = true;
                return list(rows.iter().map(|r| if let V::List(c) = r { c[0].clone() } else { V::Undef }).collect());
            }
            if rows.len() == 1 {
                first.get_or_insert(false);
                changed = true;
                return rows[0].clone();
            }
            a.clone()
        })
        .collect();
    changed.then_some((out, first == Some(true)))
}

/// `asColumn`: a list answer back as the column its input came in as.
fn as_column(r: V) -> V {
    match &r {
        V::List(l) if !l.iter().any(is_arr) => list(l.iter().map(|x| list(vec![x.clone()])).collect()),
        _ => r,
    }
}

/// The error a body called by name answers before it runs, as a formula's call scans for one (`argumentError` in
/// excelFormula.ts): an error argument, or for a range function an error among a list's cells. None for the error
/// handlers, which read errors.
pub fn argument_error(name: &str, argv: &[V]) -> Option<V> {
    let t = traits(name);
    if t.as_ref().is_some_and(|t| t.kind == Kind::Handler) {
        return None;
    }
    if let Some(e) = argv.iter().find(|v| v.is_sol_error()) {
        return Some(e.clone());
    }
    let t = t?;
    if t.kind != Kind::Range {
        return None;
    }
    let flat = argv.iter().map(|a| if !t.matrix_args && is_matrix(a) { flat1(a) } else { a.clone() }).collect();
    prep_range_args(t.prep, flat).err()
}

/// `prepRangeArgs`: a list's first error answers, then its blanks go as `prep` says.
fn prep_range_args(prep: Prep, argv: Vec<V>) -> Result<Vec<V>, V> {
    if matches!(prep, Prep::Raw | Prep::Positional) {
        return Ok(argv);
    }
    for a in &argv {
        if let V::List(l) = a {
            for v in l.iter() {
                match v {
                    V::Err(_) => return Err(v.clone()),
                    V::Fx(code) => return Err(V::err(fx_error_to_sol(*code))),
                    _ => {}
                }
            }
        }
    }
    Ok(match prep {
        Prep::Zero => argv.into_iter().map(|a| match a {
            V::List(l) => list(l.iter().map(|v| if is_missing(v) { V::Num(0.0) } else { v.clone() }).collect()),
            other => other,
        }).collect(),
        Prep::Paired => {
            let lens: Vec<usize> = argv.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).collect();
            let Some(&n) = lens.iter().min() else { return Ok(argv) };
            let keep: Vec<usize> = (0..n).filter(|&i| !argv.iter().any(|a| matches!(a, V::List(l) if is_missing(&l[i])))).collect();
            if keep.len() == n {
                return Ok(argv);
            }
            argv.into_iter().map(|a| match a {
                V::List(l) => list(keep.iter().map(|&i| l[i].clone()).collect()),
                other => other,
            }).collect()
        }
        Prep::Default => argv.into_iter().map(|a| match a {
            V::List(l) => list(l.iter().filter(|v| !is_missing(v)).cloned().collect()),
            other => other,
        }).collect(),
        Prep::Raw | Prep::Positional => argv,
    })
}

/// `applyArgRoles`: each argument read by its role; the answer is which slots the null rule must not blank on.
/// The slots a role settled beside the empty ones, or None where no role applies.
fn apply_arg_roles(name: &str, t: &Traits, empty: &[bool], argv: &mut [V]) -> Option<Vec<bool>> {
    if !t.has_roles() {
        return None;
    }
    let mut settled = empty.to_vec();
    for (i, v) in argv.iter_mut().enumerate() {
        let Some(role) = t.role(i) else { continue };
        settled[i] = true;
        *v = apply_role(role, v, &|| format!("{name}: argument {}", i + 1), true);
    }
    let group: Vec<usize> = (0..argv.len()).filter(|&i| matches!(t.role(i), Some(Role::Picks { required: true }))).collect();
    if !group.is_empty() && group.iter().all(|&i| matches!(argv[i], V::Undef)) {
        argv[group[0]] = V::err(sol_error(ErrorCode::Syntax, format!("{name}: no positions given, and they have no default")));
    }
    Some(settled)
}

/// `applyRole`; a picks role is read with `required` off, as `applyArgRoles` reads it.
fn apply_role(role: &Role, v: &V, label: &dyn Fn() -> String, picks_optional: bool) -> V {
    if v.is_sol_error() {
        return v.clone();
    }
    fn fill(v: &V, blank: &V) -> V {
        match v {
            V::List(l) => list(l.iter().map(|x| fill(x, blank)).collect()),
            V::Null | V::Undef => blank.clone(),
            other => other.clone(),
        }
    }
    let no_default = || V::err(sol_error(ErrorCode::Syntax, format!("{} is blank, and it has no default", label())));
    match role {
        Role::Setting { blank } => fill(v, &lowered(blank)),
        Role::Required => match v {
            V::List(l) => list(l.iter().map(|x| apply_role(role, x, label, picks_optional)).collect()),
            V::Null | V::Undef => no_default(),
            other => other.clone(),
        },
        Role::Picks { required } => {
            let out = match v {
                V::List(rows) if is_matrix(v) => list(
                    rows.iter()
                        .map(|r| match r {
                            V::List(cells) => list(cells.iter().map(|x| if matches!(x, V::Null | V::Undef) {
                                V::err(sol_error(ErrorCode::Syntax, format!("A position in {} is blank", label())))
                            } else {
                                x.clone()
                            }).collect()),
                            V::Null | V::Undef => V::err(sol_error(ErrorCode::Syntax, format!("A position in {} is blank", label()))),
                            other => other.clone(),
                        })
                        .collect(),
                ),
                V::List(l) => {
                    let kept: Vec<V> = l.iter().filter(|x| !matches!(x, V::Null | V::Undef)).cloned().collect();
                    if kept.is_empty() { V::Undef } else { list(kept) }
                }
                V::Null | V::Undef => V::Undef,
                other => other.clone(),
            };
            if matches!(out, V::Undef) && *required && !picks_optional { no_default() } else { out }
        }
    }
}

// ─── Names a formula reads ──────────────────────────────────────────────────────

fn is_eta_name(a: &Ast) -> bool {
    matches!(a, Ast::Name(n) if constant_value(n).is_none() && traits(&n.to_uppercase()).is_some_and(|t| t.resolves))
}

fn lambda_scope(args: &[Ast], bound: &[String]) -> Vec<String> {
    let mut inner = bound.to_vec();
    inner.extend(args[..args.len() - 1].iter().filter_map(|a| if let Ast::Name(n) = a { Some(n.clone()) } else { None }));
    inner
}

/// `extractVariables`: the bare names a formula reads, first-seen order, past constants, LAMBDA parameters and the
/// functions an eta host takes by name.
pub fn variables(ast: &Ast) -> Vec<String> {
    fn walk(n: &Ast, out: &mut Vec<String>, bound: &[String]) {
        match n {
            Ast::Name(name) => {
                if constant_value(name).is_none() && !bound.contains(name) && !out.contains(name) {
                    out.push(name.clone());
                }
            }
            Ast::Call { name, args } => {
                let up = name.to_uppercase();
                if up == "LAMBDA" && !args.is_empty() {
                    walk(&args[args.len() - 1], out, &lambda_scope(args, bound));
                    return;
                }
                let eta = ETA_HOSTS.contains(&up.as_str());
                for a in args {
                    if !(eta && is_eta_name(a)) {
                        walk(a, out, bound);
                    }
                }
            }
            Ast::Apply { func, args } => {
                walk(func, out, bound);
                for a in args {
                    if !is_eta_name(a) {
                        walk(a, out, bound);
                    }
                }
            }
            Ast::Unary { arg, .. } | Ast::Percent(arg) => walk(arg, out, bound),
            Ast::Bin { l, r, .. } => {
                walk(l, out, bound);
                walk(r, out, bound);
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(ast, &mut out, &[]);
    out
}

/// `rowRefNames`: the names read by `@name` or `[name]`, first-seen order, past LAMBDA parameters.
pub fn row_refs(ast: &Ast) -> Vec<String> {
    fn walk(n: &Ast, out: &mut Vec<String>, bound: &[String]) {
        match n {
            Ast::AtCol(name) | Ast::WholeCol(name) => {
                if !bound.contains(name) && !out.contains(name) {
                    out.push(name.clone());
                }
            }
            Ast::Call { name, args } => {
                if name.eq_ignore_ascii_case("LAMBDA") && !args.is_empty() {
                    walk(&args[args.len() - 1], out, &lambda_scope(args, bound));
                    return;
                }
                for a in args {
                    walk(a, out, bound);
                }
            }
            Ast::Apply { func, args } => {
                walk(func, out, bound);
                for a in args {
                    walk(a, out, bound);
                }
            }
            Ast::Unary { arg, .. } | Ast::Percent(arg) => walk(arg, out, bound),
            Ast::Bin { l, r, .. } => {
                walk(l, out, bound);
                walk(r, out, bound);
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(ast, &mut out, &[]);
    out
}

// ─── Values across the boundary ─────────────────────────────────────────────────

thread_local! {
    /// Lists the TS sent once under an id (`{"__def": id, "v": …}`) and names again by it (`{"__ref": id}`), so a
    /// formula called once per item doesn't re-send its captures each time ([[C120]] linearWork). The TS forgets an
    /// id when its list is collected (`engine_forget`).
    static HELD: RefCell<FxHashMap<u64, V>> = RefCell::new(FxHashMap::default());
    static MISSING: Cell<bool> = const { Cell::new(false) };
}

thread_local! {
    /// The formulas `engine_eval` ran last, parsed once, each with an evaluator whose range memo outlives the call, as
    /// `compileEvaluator` keeps its AST and `rangeMemo` across calls: `x - AVERAGE(vals)` over each item of a held
    /// list reads `vals` once ([[C120]] linearWork).
    static FORMULAS: RefCell<Vec<(String, Rc<Compiled>)>> = const { RefCell::new(Vec::new()) };
}

/// A formula parsed once, with the evaluator whose memo it keeps.
struct Compiled {
    ast: Ast,
    eval: Eval<'static>,
}

const FORMULAS_KEPT: usize = 16;

/// `compileEvaluator(src)(env)`; None where it doesn't parse.
pub fn formula(src: &str, env: Env) -> Option<V> {
    let hit = FORMULAS.with(|f| f.borrow().iter().find(|(s, _)| s == src).map(|(_, c)| c.clone()));
    let compiled = match hit {
        Some(c) => c,
        None => {
            let c = Rc::new(Compiled { ast: crate::excel_formula::parse_formula(src)?, eval: Eval { memo_calls: true, ..Eval::default() } });
            FORMULAS.with(|f| {
                let mut f = f.borrow_mut();
                if f.len() == FORMULAS_KEPT {
                    f.remove(0);
                }
                f.push((src.to_string(), c.clone()));
            });
            c
        }
    };
    Some(compiled.eval.run(&compiled.ast, &Rc::new(env)))
}

pub fn forget_held(ids: &[u64]) {
    HELD.with(|h| {
        let mut h = h.borrow_mut();
        for id in ids {
            h.remove(id);
        }
    });
}

/// Whether a `__ref` named a list the core doesn't hold since the last call; the call then goes to the TS.
pub fn take_missing() -> bool {
    MISSING.with(|m| m.replace(false))
}

/// A value as the TS sends it: arrays nest, `{"__undef": 1}` is undefined, `{"__lambda": …}` a wired LAMBDA or a
/// function named bare, `{"__def"}` and `{"__ref"}` a held list, anything else a cell.
pub fn decode_value(j: &serde_json::Value) -> V {
    use serde_json::Value as Json;
    match j {
        Json::Array(items) => list(items.iter().map(decode_value).collect()),
        Json::Object(o) if o.contains_key("__ref") => o["__ref"].as_u64().and_then(|id| HELD.with(|h| h.borrow().get(&id).cloned())).unwrap_or_else(|| {
            MISSING.with(|m| m.set(true));
            V::Undef
        }),
        Json::Object(o) if o.contains_key("__def") => {
            let v = decode_value(&o["v"]);
            if let Some(id) = o["__def"].as_u64() {
                HELD.with(|h| h.borrow_mut().insert(id, v.clone()));
            }
            v
        }
        Json::Object(o) if o.contains_key("__undef") => V::Undef,
        Json::Object(o) if o.contains_key("__cx") => {
            let part = |i: usize| match o["__cx"].get(i).map(|p| cell_to_v(&crate::wire::decode_cell(p))) {
                Some(V::Num(n)) => n,
                _ => f64::NAN,
            };
            V::Cx(part(0), part(1))
        }
        Json::Object(o) if o.contains_key("__unit") => {
            let w = &o["__unit"];
            let num = |j: Option<&Json>| match j.map(|p| cell_to_v(&crate::wire::decode_cell(p))) {
                Some(V::Num(n)) => n,
                _ => f64::NAN,
            };
            let dim = w.get("dim").and_then(Json::as_object).map(|d| d.iter().map(|(k, x)| (k.clone(), num(Some(x)))).collect()).unwrap_or_default();
            V::Unit(Rc::new(crate::unit_dims::UnitCell {
                value: num(w.get("value")),
                dim,
                display: w.get("display").and_then(Json::as_str).map(String::from),
                ratio: w.get("ratio").and_then(Json::as_bool).unwrap_or(false),
                scale: w.get("scale").filter(|j| !j.is_null()).map(|j| num(Some(j))),
                offset: w.get("offset").filter(|j| !j.is_null()).map(|j| num(Some(j))),
                unit_dim: w.get("udim").and_then(Json::as_object).map(|d| d.iter().map(|(k, x)| (k.clone(), num(Some(x)))).collect()),
            }))
        }
        Json::Object(o) if o.contains_key("__lambda") => {
            let w = &o["__lambda"];
            if let Some(name) = w.get("eta").and_then(Json::as_str) {
                return V::Lambda(Rc::new(LambdaV { eta: Some(name.to_uppercase()), ..Default::default() }));
            }
            let strs = |k: &str| -> Vec<String> { w.get(k).and_then(Json::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default() };
            let values = |k: &str| -> Option<Vec<V>> { w.get(k).and_then(Json::as_array).map(|a| a.iter().map(decode_value).collect()) };
            let (params, captured) = (strs("params"), strs("captured"));
            let units = values("capturedValues").unwrap_or_default();
            // A λ frozen before its values crossed with their units carries only the ones its body reads.
            let read = values("readValues").unwrap_or_else(|| units.clone());
            let Some(src) = w.get("expr").and_then(Json::as_str) else {
                return V::err(sol_error(ErrorCode::Value, "This LAMBDA has no formula text to run"));
            };
            let Some(body) = crate::excel_formula::parse_formula(src) else {
                return V::err(sol_error(ErrorCode::Syntax, "The lambda body has a syntax error"));
            };
            let env: Env = captured.iter().cloned().zip(read.into_iter().chain(std::iter::repeat(V::Undef))).collect();
            let descriptions = w.get("descriptions").filter(|d| d.is_object()).map(|d| Rc::new(d.clone()));
            V::Lambda(Rc::new(LambdaV { params, body: Some(Rc::new(body)), env: Rc::new(env), eta: None, captured: Some(captured), src: Some(src.to_string()), units, descriptions }))
        }
        _ => cell_to_v(&crate::wire::decode_cell(j)),
    }
}

// ─── Computed columns ───────────────────────────────────────────────────────────

/// What a computed column computes (`ComputedSpec`): a formula, or a bare wired LAMBDA called with each row's cells.
#[derive(Clone, Copy)]
pub enum ColumnSpec<'s> {
    Expr { ast: &'s Ast, lambdas: &'s [String] },
    Lambda(&'s LambdaV),
}

pub struct ColumnInputs<'a> {
    pub table: Table<'a>,
    /// `sideValue(name, "var")` for the names the formula reads bare that no column holds.
    pub sides: FxHashMap<String, V>,
    pub row_sides: FxHashMap<String, V>,
    pub reserved: Vec<String>,
    pub alias: FxHashMap<String, String>,
    pub rows: usize,
}

pub struct ColumnOutcome<C = crate::frame::FrameCell> {
    pub cells: Vec<C>,
    pub side_vars: Vec<String>,
}

/// `computeColumnCells`: each row's cell and the side inputs the formula reads, or the error that stops it.
pub fn column(spec: ColumnSpec, inp: ColumnInputs) -> Result<ColumnOutcome, crate::error_value::SolError> {
    column_with(spec, inp, crate::excel_formula::tag_computed_cell)
}

/// `runColumn` with each row's answer tagged by `tag`: a frame's one value per row, or a Cube's row that may hold a
/// list (`tagCubeComputedCell`).
pub fn column_with<C>(spec: ColumnSpec, inp: ColumnInputs, tag: fn(V) -> C) -> Result<ColumnOutcome<C>, crate::error_value::SolError> {
    let cols: FxHashMap<&str, Col> = match &inp.table {
        Table::Frame(f) => f.columns.iter().map(|c| (c.name.as_str(), Col::Frame(c))).collect(),
        Table::Rows(cs) => cs.iter().map(|c| (c.name.as_str(), Col::Row(c))).collect(),
    };
    let ctx = RowCtx {
        cols,
        alias: inp.alias,
        reserved: inp.reserved,
        rows: inp.rows,
        cursor: Cell::new(0),
        wholes: RefCell::default(),
        row_sides: inp.row_sides,
        at_verdict: RefCell::default(),
    };
    let ev = Eval { row: Some(&ctx), ..Eval::default() };
    let has_col = |n: &str| ctx.cols.contains_key(n);
    let side = |p: &str| inp.sides.get(p).cloned().unwrap_or(V::Undef);
    let mut side_vars: Vec<String> = Vec::new();
    // One binding per parameter: a column (whole, or this row's cell for a LAMBDA) or a side value.
    enum Bind<'c> {
        Col(Col<'c>),
        Side(V),
    }
    let params: Vec<String> = match &spec {
        ColumnSpec::Expr { ast, lambdas } => {
            let mut vs = variables(ast);
            for l in lambdas.iter() {
                if !vs.contains(l) {
                    vs.push(l.clone());
                }
            }
            vs
        }
        ColumnSpec::Lambda(lam) => lam.params.clone(),
    };
    let mut binds: Vec<Bind> = Vec::with_capacity(params.len());
    for p in &params {
        if let Some(target) = ctx.alias.get(p) {
            match ctx.cols.get(target.as_str()) {
                Some(c) => binds.push(Bind::Col(*c)),
                None => return Err(sol_error(ErrorCode::Ref, format!("No column \"{target}\" to bind \"{p}\" to"))),
            }
            continue;
        }
        if let Some(c) = ctx.cols.get(p.as_str()) {
            binds.push(Bind::Col(*c));
            continue;
        }
        if ctx.reserved.contains(p) {
            return Err(sol_error(ErrorCode::Ref, format!("\"{p}\" is a reserved input name. Rename the variable or the column")));
        }
        side_vars.push(p.clone());
        binds.push(Bind::Side(ctx.aligned(side(p))));
    }
    let mut cells = Vec::with_capacity(inp.rows);
    use crate::excel_functions::{take_raised, Raised};
    take_raised();
    let finish = |v: V| match take_raised() {
        Raised::Thrown(e) => tag(V::err(e)),
        Raised::Nothing => tag(v),
    };
    /// ROW()'s row while the column runs; dropping it clears the row.
    struct Rows;
    impl Rows {
        fn at(&self, i: usize) {
            crate::excel_functions::set_row_number(Some(i as f64 + 1.0));
        }
    }
    impl Drop for Rows {
        fn drop(&mut self) {
            crate::excel_functions::set_row_number(None);
        }
    }
    let rows = Rows;
    match spec {
        ColumnSpec::Expr { ast, .. } => {
            for p in row_refs(ast) {
                if ctx.reserved.contains(&p) {
                    continue;
                }
                if let Some(target) = ctx.alias.get(&p) {
                    if !has_col(target) {
                        return Err(sol_error(ErrorCode::Ref, format!("No column \"{target}\" to bind \"{p}\" to")));
                    }
                    continue;
                }
                if !has_col(&p) && !side_vars.contains(&p) {
                    side_vars.push(p);
                }
            }
            // Every binding is a whole column or a side value, so one env serves every row.
            let env: Env = params.iter().zip(&binds).map(|(p, b)| (p.clone(), match b {
                Bind::Col(c) => ctx.whole_of(*c),
                Bind::Side(v) => v.clone(),
            })).collect();
            let env = Rc::new(env);
            for i in 0..inp.rows {
                ctx.cursor.set(i);
                rows.at(i);
                let v = ev.run(ast, &env);
                cells.push(finish(v));
            }
        }
        ColumnSpec::Lambda(lam) => {
            for i in 0..inp.rows {
                ctx.cursor.set(i);
                rows.at(i);
                let argv: Vec<V> = binds.iter().map(|b| match b {
                    Bind::Col(c) => c.cell(i),
                    Bind::Side(v) => v.clone(),
                }).collect();
                // A parameter's error cell answers the row before the body runs.
                let err = binds.iter().zip(&argv).find(|(b, v)| matches!(b, Bind::Col(_)) && v.is_sol_error()).map(|(_, v)| v.clone());
                let v = match err {
                    Some(e) => e,
                    None => ev.call_lambda(lam, &argv),
                };
                cells.push(finish(v));
            }
        }
    }
    Ok(ColumnOutcome { cells, side_vars })
}

// [[C10]] socketLattice, [[D102]] graphOnCore
//! The socket lattice: which output type connects to which input, what an adoptive socket takes up from its cable,
//! and each type's rank and element family. The app reads it as one set of tables (`lattice_tables`).

/// Every socket type, in the order the tables list them.
pub const TYPES: [&str; 31] = [
    "number",
    "list",
    "numlist",
    "string",
    "strlist",
    "strcombo",
    "date",
    "datelist",
    "datecombo",
    "complex",
    "complexlist",
    "complexcombo",
    "complextable",
    "logical",
    "logicallist",
    "logicalcombo",
    "logicaltable",
    "table",
    "strtable",
    "datetable",
    "anytable",
    "anylist",
    "anydata",
    "anycombo",
    "frame",
    "cube",
    "lambda",
    "chart",
    "document",
    "any",
    "trueany",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dim {
    Scalar,
    List,
    Combo,
    Matrix,
}

const DIMS: [Dim; 4] = [Dim::Scalar, Dim::List, Dim::Combo, Dim::Matrix];

/// Each element family's type at each dimension: scalar, list, combo, matrix.
const FAMILIES: [(&str, [&str; 4]); 5] = [
    ("number", ["number", "list", "numlist", "table"]),
    ("string", ["string", "strlist", "strcombo", "strtable"]),
    ("date", ["date", "datelist", "datecombo", "datetable"]),
    (
        "complex",
        ["complex", "complexlist", "complexcombo", "complextable"],
    ),
    (
        "logical",
        ["logical", "logicallist", "logicalcombo", "logicaltable"],
    ),
];

fn dim_rank(d: Dim) -> u8 {
    match d {
        Dim::Scalar => 0,
        Dim::List | Dim::Combo => 1,
        Dim::Matrix => 2,
    }
}

fn at(fam: &[&'static str; 4], d: Dim) -> &'static str {
    fam[DIMS.iter().position(|x| *x == d).unwrap()]
}

fn dim_flows(d_out: Dim, d_in: Dim) -> bool {
    dim_rank(d_out) <= dim_rank(d_in) || (d_out == Dim::Combo && d_in == Dim::Scalar)
}

fn family_of(t: &str) -> Option<(&'static str, &'static [&'static str; 4], Dim)> {
    FAMILIES.iter().find_map(|(name, fam)| {
        fam.iter()
            .position(|x| *x == t)
            .map(|i| (*name, fam, DIMS[i]))
    })
}

fn is_matrix(t: &str) -> bool {
    matches!(
        t,
        "table" | "strtable" | "datetable" | "complextable" | "logicaltable" | "anytable"
    )
}

fn is_family_value(t: &str) -> bool {
    family_of(t).is_some()
}

fn is_rank1_value(t: &str) -> bool {
    family_of(t).is_some_and(|(_, _, d)| d != Dim::Matrix)
}

fn is_scalar_combo(t: &str) -> bool {
    family_of(t).is_some_and(|(_, _, d)| matches!(d, Dim::Scalar | Dim::Combo))
}

fn is_list_combo(t: &str) -> bool {
    family_of(t).is_some_and(|(_, _, d)| matches!(d, Dim::List | Dim::Combo))
}

fn is_opaque(t: &str) -> bool {
    matches!(t, "lambda" | "chart" | "document")
}

/// Within a family, a lower rank flows into a higher one (a combo also into a scalar); number and logical cross.
fn family_accepts(in_t: &str, out_t: &str) -> bool {
    let (Some((fi, _, di)), Some((fo, _, dof))) = (family_of(in_t), family_of(out_t)) else {
        return false;
    };
    let crosses = fi == fo || matches!((fi, fo), ("number", "logical") | ("logical", "number"));
    if !crosses || !dim_flows(dof, di) {
        return false;
    }
    fi != fo || dof != di
}

fn accepts(in_t: &str, out_t: &str) -> bool {
    if in_t == out_t || in_t == "trueany" || out_t == "trueany" {
        return true;
    }
    if in_t == "any" {
        return is_scalar_combo(out_t) || out_t == "anycombo";
    }
    if out_t == "any" {
        return !is_opaque(in_t);
    }
    if in_t == "anytable" && (is_family_value(out_t) || out_t == "anylist") {
        return true;
    }
    if out_t == "anytable" && is_matrix(in_t) {
        return true;
    }
    if in_t == "anylist" && (is_rank1_value(out_t) || out_t == "anycombo") {
        return true;
    }
    if out_t == "anylist" && is_list_combo(in_t) {
        return true;
    }
    if in_t == "anycombo" && (is_rank1_value(out_t) || out_t == "anylist") {
        return true;
    }
    if out_t == "anycombo" {
        return !is_opaque(in_t);
    }
    if in_t == "anydata" && (is_family_value(out_t) || out_t == "anylist" || out_t == "anytable") {
        return true;
    }
    if out_t == "anydata" {
        return !is_opaque(in_t);
    }
    if in_t == "frame" && (is_family_value(out_t) || out_t == "anytable" || out_t == "anylist") {
        return true;
    }
    if in_t == "cube"
        && (is_family_value(out_t) || out_t == "anytable" || out_t == "anylist" || out_t == "frame")
    {
        return true;
    }
    family_accepts(in_t, out_t)
}

/// Whether a cable from an output of type `out` may plug into an input of type `inp`.
pub fn can_connect(out: &str, inp: &str) -> bool {
    accepts(inp, out)
}

/// A type's rank: 0 a value, 1 a list, 2 a matrix; none for a type outside the families and wildcards.
pub fn lattice_rank(t: &str) -> Option<u8> {
    match t {
        "any" => Some(0),
        "anylist" | "anycombo" => Some(1),
        "anydata" | "anytable" => Some(2),
        _ => family_of(t).map(|(_, _, d)| dim_rank(d)),
    }
}

pub fn element_family(t: &str) -> Option<&'static str> {
    family_of(t).map(|(name, _, _)| name)
}

pub fn combo_of(t: &str) -> Option<&'static str> {
    family_of(t).map(|(_, fam, _)| at(fam, Dim::Combo))
}

pub fn type_at_rank(t: &str, rank: u8) -> Option<&'static str> {
    let d = match rank {
        0 => Dim::Scalar,
        1 => Dim::List,
        _ => Dim::Matrix,
    };
    family_of(t).map(|(_, fam, _)| at(fam, d))
}

fn base_form(t: &str, base_rank: u8) -> &'static str {
    type_at_rank(t, if base_rank == 2 { 2 } else { 1 }).unwrap()
}

/// What an adoptive input declared at `base` takes up from a cable of type `wired`.
pub fn adopt_type_for_base<'a>(base: &'a str, wired: &'a str) -> &'a str {
    let fam = element_family(wired);
    if base == "anylist" || base == "anytable" {
        let (Some(_), Some(br), Some(wr)) = (fam, lattice_rank(base), lattice_rank(wired)) else {
            return base;
        };
        if wr >= br {
            return wired;
        }
        return base_form(wired, br);
    }
    if matches!(base, "any" | "anycombo" | "anydata") && fam.is_none() {
        return base;
    }
    wired
}

/// What an adoptive output declared at `base` shows for a resolved type `t`.
pub fn project_type_to_base<'a>(base: &'a str, t: &'a str) -> &'a str {
    if base != "anylist" && base != "anytable" {
        return t;
    }
    let Some(br) = lattice_rank(base) else {
        return t;
    };
    if element_family(t).is_none() {
        return base;
    }
    if lattice_rank(t) == Some(br) {
        return t;
    }
    base_form(t, br)
}

/// The tables the app reads the lattice through, as JSON: `types`, and per output type the input types it connects
/// to (`connects[out]`), per base the type adopted from each wired type (`adopts[base][wired]`), per base the type
/// shown for each resolved type (`projects[base][t]`), and per type its `rank`, `family`, `combo` and `atRank`.
pub fn tables_json() -> String {
    use serde_json::{json, Map, Value};
    let mut connects = Map::new();
    let mut adopts = Map::new();
    let mut projects = Map::new();
    let mut types = Map::new();
    for a in TYPES {
        connects.insert(
            a.into(),
            Value::from(
                TYPES
                    .iter()
                    .filter(|b| can_connect(a, b))
                    .copied()
                    .collect::<Vec<_>>(),
            ),
        );
        adopts.insert(
            a.into(),
            Value::Object(
                TYPES
                    .iter()
                    .map(|b| (b.to_string(), json!(adopt_type_for_base(a, b))))
                    .collect(),
            ),
        );
        projects.insert(
            a.into(),
            Value::Object(
                TYPES
                    .iter()
                    .map(|b| (b.to_string(), json!(project_type_to_base(a, b))))
                    .collect(),
            ),
        );
        types.insert(
            a.into(),
            json!({
                "rank": lattice_rank(a),
                "family": element_family(a),
                "combo": combo_of(a),
                "atRank": [type_at_rank(a, 0), type_at_rank(a, 1), type_at_rank(a, 2)],
            }),
        );
    }
    json!({ "order": TYPES, "connects": connects, "adopts": adopts, "projects": projects, "types": types }).to_string()
}

/// A passthrough's vote over its wired inputs' types (`None` unwired): `trueany` when any is, or none is wired, or
/// they disagree; else the one type they share.
pub fn agree_types<'a>(types: &[Option<&'a str>]) -> &'a str {
    if types.contains(&Some("trueany")) {
        return "trueany";
    }
    let wired: Vec<&str> = types.iter().flatten().copied().collect();
    match wired.first() {
        Some(first) if wired.iter().all(|t| t == first) => first,
        _ => "trueany",
    }
}

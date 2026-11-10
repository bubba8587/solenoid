// [[C25]] firstClassUnits, [[C139]] mathlibLaws
//! The geometry pack's figure cards: each solves one figure per row of a frame, the wired one or its own keyed table,
//! and answers the same frame with every part filled.

use super::values::{Column, Frame};
use super::Cv;
use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::frame::FrameColType;
use crate::jsnum::{nan_max, number_to_string};
use crate::unit_catalog::fc_unit_to_unit;
use crate::unit_dims::{dim_equal, dim_pow, Dim};
use crate::unit_value::{to_precision, unit_error};
use libm::{acos, asin, cos, pow, sin};
use serde_json::Value as Json;
use std::f64::consts::PI;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "TriangleSolverNode" => triangle_solver(c),
        "UnitCircleNode" => unit_circle(c),
        "CircleSolverNode" => circle_solver(c),
        "RegularPolygonNode" => regular_polygon(c),
        "TwoPointsNode" => two_points(c),
        "PolygonPointsNode" => polygon_points(c),
        "SolidNode" => solid_solver(c),
        _ => return None,
    })
}

// ─── The Triangle Solver ────────────────────────────────────────────────────────────────────────────────────────────

const PART_KEYS: [&str; 6] = ["a", "b", "c", "A", "B", "C"];
const TRI_EPS: f64 = 1e-9;
const D2R: f64 = PI / 180.0;
const R2D: f64 = 180.0 / PI;

/// A triangle's parts by `PART_KEYS` position, each given or not.
pub(crate) type Parts = [Option<f64>; 6];

struct Solved {
    parts: [f64; 6],
    area: f64,
    perimeter: f64,
}

fn clamp1(x: f64) -> f64 {
    x.clamp(-1.0, 1.0)
}

/// The angle opposite side `a` from the three sides, as the cosine rule has it.
fn cos_rule(a: f64, b: f64, c: f64) -> f64 {
    acos(clamp1((b * b + c * c - a * a) / (2.0 * b * c))) * R2D
}

fn fill_by_sines(t: &mut Parts, known_side: usize, known_angle: usize) {
    let missing: Vec<usize> = (3..6).filter(|&k| t[k].is_none()).collect();
    if missing.len() == 1 {
        t[missing[0]] = Some(180.0 - (3..6).map(|k| t[k].unwrap_or(0.0)).sum::<f64>());
    } else if missing.len() == 2
        && let (Some(a), Some(b), Some(c)) = (t[0], t[1], t[2])
    {
        let ang_a = *t[3].get_or_insert_with(|| cos_rule(a, b, c));
        let ang_b = *t[4].get_or_insert_with(|| cos_rule(b, a, c));
        t[5] = Some(180.0 - ang_a - ang_b);
    }
    let ratio = t[known_side].unwrap_or(f64::NAN) / sin(t[known_angle].unwrap_or(f64::NAN) * D2R);
    for k in 0..3 {
        if t[k].is_none() {
            t[k] = Some(ratio * sin(t[k + 3].unwrap_or(f64::NAN) * D2R));
        }
    }
}

/// Three parts, at least one a side, to all six with the area and perimeter.
fn solve_triangle(g: &Parts) -> Result<Solved, V> {
    let sides: Vec<usize> = (0..3).filter(|&k| g[k].is_some()).collect();
    let angles: Vec<usize> = (3..6).filter(|&k| g[k].is_some()).collect();
    let v = |k: usize| g[k].unwrap_or(f64::NAN);
    if sides.len() + angles.len() != 3 {
        return Err(err(ErrorCode::Solve, "Give exactly three parts (sides and angles)"));
    }
    for &k in &sides {
        if !(v(k) > 0.0) {
            return Err(err(ErrorCode::Domain, format!("Side {} must be positive", PART_KEYS[k])));
        }
    }
    for &k in &angles {
        if !(v(k) > 0.0 && v(k) < 180.0) {
            return Err(err(ErrorCode::Domain, format!("Angle {} must be between 0° and 180°", PART_KEYS[k])));
        }
    }
    if angles.len() == 3 {
        return Err(err(ErrorCode::Solve, "Three angles fix only the shape. Swap one for a side"));
    }
    let sum_given: f64 = angles.iter().fold(0.0, |s, &k| s + v(k));
    if angles.len() >= 2 && sum_given >= 180.0 - TRI_EPS {
        return Err(err(ErrorCode::Domain, "The angles reach 180° with nothing left over"));
    }
    let mut t = *g;
    if sides.len() == 3 {
        let (a, b, c) = (v(0), v(1), v(2));
        if a + b <= c + TRI_EPS || b + c <= a + TRI_EPS || a + c <= b + TRI_EPS {
            return Err(err(ErrorCode::Domain, "Those sides break the triangle inequality"));
        }
        let ang_a = cos_rule(a, b, c);
        let ang_b = cos_rule(b, a, c);
        t[3] = Some(ang_a);
        t[4] = Some(ang_b);
        t[5] = Some(180.0 - ang_a - ang_b);
    } else if sides.len() == 2 {
        let angle = angles[0];
        let opposite = angle - 3;
        if g[opposite].is_none() {
            let (s1, s2) = (sides[0], sides[1]);
            t[opposite] = Some((pow(v(s1), 2.0) + pow(v(s2), 2.0) - 2.0 * v(s1) * v(s2) * cos(v(angle) * D2R)).sqrt());
            fill_by_sines(&mut t, opposite, angle);
        } else {
            let other = *sides.iter().find(|&&k| k != opposite).unwrap_or(&opposite);
            let sin_other = (v(other) * sin(v(angle) * D2R)) / v(opposite);
            if sin_other > 1.0 + TRI_EPS {
                return Err(err(ErrorCode::Domain, "No triangle fits those parts"));
            }
            let right = sin_other >= 1.0 - TRI_EPS;
            let deg1 = if right { 90.0 } else { asin(clamp1(sin_other)) * R2D };
            let deg2 = 180.0 - deg1;
            let fits = |d: f64| v(angle) + d < 180.0 - TRI_EPS;
            if !right && fits(deg1) && fits(deg2) {
                return Err(err(ErrorCode::Solve, "Ambiguous (SSA): two triangles fit. Give a different third part"));
            }
            let other_angle = other + 3;
            t[other_angle] = Some(if fits(deg1) { deg1 } else { deg2 });
            let last = (3..6).find(|&k| t[k].is_none()).unwrap_or(5);
            t[last] = Some(180.0 - v(angle) - t[other_angle].unwrap_or(f64::NAN));
            t[last - 3] = Some((v(opposite) * sin(t[last].unwrap_or(f64::NAN) * D2R)) / sin(v(angle) * D2R));
        }
    } else {
        let last = (3..6).find(|&k| t[k].is_none()).unwrap_or(5);
        t[last] = Some(180.0 - sum_given);
        fill_by_sines(&mut t, sides[0], sides[0] + 3);
    }
    let parts = t.map(|x| x.unwrap_or(f64::NAN));
    let area = 0.5 * parts[1] * parts[2] * sin(parts[3] * D2R);
    Ok(Solved { parts, area, perimeter: parts[0] + parts[1] + parts[2] })
}

/// The solved triangle: each part, the area, the perimeter, whether the parts agree, and the parts it solved.
pub(crate) struct TriangleResult {
    pub(crate) values: [V; 6],
    area: V,
    perimeter: V,
    valid: V,
    solved: Vec<usize>,
}

/// The two numbers with this sum and product, when they are one number twice: two different ones are the same
/// triangle's two adjacent sides either way round, a mirror pair with nothing to choose between them.
fn equal_pair(sum: f64, prod: f64) -> Result<f64, V> {
    let disc = sum * sum - 4.0 * prod;
    let tol = TRI_EPS * sum * sum;
    if !(disc >= -tol) {
        Err(err(ErrorCode::Domain, "No triangle fits those parts"))
    } else if disc <= tol {
        Ok(sum / 2.0)
    } else {
        Err(err(ErrorCode::Solve, "Ambiguous: a triangle and its mirror image both fit. Give a different part"))
    }
}

/// The parts with a side worked out from the area or the perimeter, where the parts alone don't fix a triangle and
/// the size makes it one; `None` where even the size leaves it open.
fn sized_parts(g: &Parts, area: Option<f64>, perimeter: Option<f64>) -> Option<Result<Parts, V>> {
    let sides: Vec<usize> = (0..3).filter(|&k| g[k].is_some()).collect();
    let angles: Vec<usize> = (3..6).filter(|&k| g[k].is_some()).collect();
    let v = |k: usize| g[k].unwrap_or(f64::NAN);
    if area.is_some_and(|k| !(k > 0.0)) {
        return Some(Err(err(ErrorCode::Domain, "The area must be positive")));
    }
    if perimeter.is_some_and(|p| !(p > 0.0)) {
        return Some(Err(err(ErrorCode::Domain, "The perimeter must be positive")));
    }
    let no_fit = || Some(Err(err(ErrorCode::Domain, "No triangle fits those parts")));
    let mut t = *g;
    match (sides.len(), angles.len()) {
        // The angles fix the shape; the size scales a unit triangle of that shape.
        (0, 2 | 3) => {
            let mut unit: Parts = [None; 6];
            unit[0] = Some(1.0);
            unit[angles[0]] = g[angles[0]];
            unit[angles[1]] = g[angles[1]];
            let u = match solve_triangle(&unit) {
                Ok(u) => u,
                Err(e) => return Some(Err(e)),
            };
            t[0] = Some(match (area, perimeter) {
                (Some(k), _) => (k / u.area).sqrt(),
                (None, Some(p)) => p / u.perimeter,
                _ => return None,
            });
        }
        (2, 0) => {
            let missing = 3 - sides[0] - sides[1];
            let (x, y) = (v(sides[0]), v(sides[1]));
            if let Some(p) = perimeter {
                t[missing] = Some(p - x - y);
            } else {
                // The included angle's sine is 2K / xy: past 1 nothing fits, under 1 an acute and an obtuse angle do.
                let sine = 2.0 * area? / (x * y);
                if sine > 1.0 + TRI_EPS {
                    return no_fit();
                }
                if sine < 1.0 - TRI_EPS {
                    return Some(Err(err(
                        ErrorCode::Solve,
                        "Ambiguous: an acute and an obtuse triangle both fit. Give an angle",
                    )));
                }
                t[missing + 3] = Some(90.0);
            }
        }
        (1, 1) => {
            let (x, y) = (sides[0], angles[0]);
            let (xv, rad) = (v(x), v(y) * D2R);
            if y - 3 != x {
                // An adjacent angle: the area or the perimeter gives the angle's other side.
                let z = 3 - x - (y - 3);
                let zv = match (area, perimeter) {
                    (Some(k), _) => 2.0 * k / (xv * sin(rad)),
                    (None, Some(p)) => {
                        let rest = p - xv;
                        (rest * rest - xv * xv) / (2.0 * (rest - xv * cos(rad)))
                    }
                    _ => return None,
                };
                t[z] = Some(zv);
            } else {
                // The opposite angle: the other two sides' sum and product, so they are equal or a mirror pair.
                let (sum, prod) = match (area, perimeter) {
                    (Some(k), Some(p)) => (p - xv, 2.0 * k / sin(rad)),
                    (Some(k), None) => {
                        let prod = 2.0 * k / sin(rad);
                        ((xv * xv + 2.0 * prod * (1.0 + cos(rad))).sqrt(), prod)
                    }
                    (None, Some(p)) => {
                        let sum = p - xv;
                        (sum, (sum * sum - xv * xv) / (2.0 * (1.0 + cos(rad))))
                    }
                    _ => return None,
                };
                let each = match equal_pair(sum, prod) {
                    Ok(e) => e,
                    Err(e) => return Some(Err(e)),
                };
                for k in (0..3).filter(|&k| k != x) {
                    t[k] = Some(each);
                }
            }
        }
        // One side, the area and the perimeter: Heron's s - b and s - c sum to the side.
        (1, 0) => {
            let (Some(k), Some(p)) = (area, perimeter) else { return None };
            let (x, half) = (v(sides[0]), p / 2.0);
            if !(half > x) {
                return no_fit();
            }
            let each = match equal_pair(x, k * k / (half * (half - x))) {
                Ok(e) => half - e,
                Err(e) => return Some(Err(e)),
            };
            for j in (0..3).filter(|&j| j != sides[0]) {
                t[j] = Some(each);
            }
        }
        // One angle, the area and the perimeter: the adjacent sides' product from the area, their sum from the
        // perimeter by the cosine rule.
        (0, 1) => {
            let (Some(k), Some(p)) = (area, perimeter) else { return None };
            let y = angles[0];
            let rad = v(y) * D2R;
            let prod = 2.0 * k / sin(rad);
            let sum = (p * p + 2.0 * prod * (1.0 + cos(rad))) / (2.0 * p);
            let each = match equal_pair(sum, prod) {
                Ok(e) => e,
                Err(e) => return Some(Err(e)),
            };
            t[y - 3] = Some(p - sum);
            for j in (0..3).filter(|&j| j != y - 3) {
                t[j] = Some(each);
            }
        }
        _ => return None,
    }
    Some(Ok(t))
}

/// Six parts and an optional area and perimeter: the parts solve as they can, the size fills in where they can't, and
/// whatever is left over is a check.
pub(crate) fn solve_given_parts(
    given: &Parts,
    area: Option<f64>,
    perimeter: Option<f64>,
    cell_err: Option<V>,
) -> TriangleResult {
    if cell_err.is_none() {
        let sides = (0..3).filter(|&k| given[k].is_some()).count();
        let fixed = given.iter().flatten().count() >= 3 && sides > 0;
        let sized =
            if fixed || (area.is_none() && perimeter.is_none()) { None } else { sized_parts(given, area, perimeter) };
        let mut r = match sized {
            Some(Err(e)) => {
                return TriangleResult {
                    values: std::array::from_fn(|k| given[k].map_or_else(|| e.clone(), V::Num)),
                    area: e.clone(),
                    perimeter: e,
                    valid: V::Bool(false),
                    solved: Vec::new(),
                }
            }
            Some(Ok(parts)) => solve_parts(&parts, None),
            None => solve_parts(given, None),
        };
        if let (V::Num(got_area), V::Num(got_perimeter)) = (&r.area, &r.perimeter) {
            r.solved = (0..6).filter(|&k| given[k].is_none()).collect();
            let close =
                |got: f64, want: Option<f64>| want.is_none_or(|w| (got - w).abs() <= 1e-6 * nan_max(1.0, w.abs()));
            if matches!(r.valid, V::Bool(true)) && !(close(*got_area, area) && close(*got_perimeter, perimeter)) {
                r.valid = V::Bool(false);
            }
        }
        return r;
    }
    solve_parts(given, cell_err)
}

fn solve_parts(given: &Parts, cell_err: Option<V>) -> TriangleResult {
    let done = |values: [V; 6], area: V, perimeter: V, valid: V, solved: Vec<usize>| TriangleResult {
        values,
        area,
        perimeter,
        valid,
        solved,
    };
    if let Some(e) = cell_err {
        return done(std::array::from_fn(|_| e.clone()), e.clone(), e.clone(), e, Vec::new());
    }
    let given_keys: Vec<usize> = (0..6).filter(|&k| given[k].is_some()).collect();
    let unsolved = || (0..6).filter(|&k| given[k].is_none()).collect::<Vec<_>>();
    let as_given = |k: usize| given[k].map_or(V::Null, V::Num);
    if given_keys.len() < 3 {
        return done(std::array::from_fn(as_given), V::Null, V::Null, V::Null, Vec::new());
    }
    if given_keys.len() == 3 {
        return match solve_triangle(given) {
            Err(e) => done(std::array::from_fn(|_| e.clone()), e.clone(), e, V::Bool(false), Vec::new()),
            Ok(r) => done(r.parts.map(V::Num), V::Num(r.area), V::Num(r.perimeter), V::Bool(true), unsolved()),
        };
    }
    let mut subsets: Vec<[usize; 3]> = Vec::new();
    for i in 0..given_keys.len() {
        for j in i + 1..given_keys.len() {
            for k in j + 1..given_keys.len() {
                subsets.push([given_keys[i], given_keys[j], given_keys[k]]);
            }
        }
    }
    let side_count = |sub: &[usize; 3]| sub.iter().filter(|&&k| k < 3).count();
    subsets.sort_by_key(|sub| std::cmp::Reverse(side_count(sub)));
    let solved = subsets.iter().filter(|sub| side_count(sub) > 0).find_map(|sub| {
        let mut g: Parts = [None; 6];
        for &k in sub {
            g[k] = given[k];
        }
        solve_triangle(&g).ok()
    });
    let Some(s) = solved else {
        let e = err(ErrorCode::Solve, "No three of those parts pin down a triangle");
        return done(
            std::array::from_fn(|k| given[k].map_or_else(|| e.clone(), V::Num)),
            e.clone(),
            e,
            V::Bool(false),
            Vec::new(),
        );
    };
    let agrees = |got: f64, want: f64| (got - want).abs() <= 1e-6 * nan_max(1.0, want.abs());
    let valid = given_keys.iter().all(|&k| agrees(s.parts[k], given[k].unwrap_or(f64::NAN)));
    done(
        std::array::from_fn(|k| V::Num(given[k].unwrap_or(s.parts[k]))),
        V::Num(s.area),
        V::Num(s.perimeter),
        V::Bool(valid),
        unsolved(),
    )
}

/// The columns the card reads and writes, in order: the six parts, then what it derives.
/// The keyed table a fresh card holds: one 3-4-5 triangle to solve.
pub(crate) const TRIANGLE_DEFAULT: &str = r#"[{"name":"a","cells":["3"]},{"name":"b","cells":["4"]},{"name":"c","cells":["5"]},{"name":"A","cells":[""]},{"name":"B","cells":[""]},{"name":"C","cells":[""]},{"name":"area","cells":[""]},{"name":"perimeter","cells":[""]}]"#;

/// Triangle Solver: one triangle per row of its frame, the wired one or its own keyed table. Each row's given parts
/// solve the rest; an area or perimeter the parts didn't need is a check that `valid` reads. The output is the same
/// frame with the eight columns filled, other columns kept; `valid` answers per row. Sides share one column unit, which
/// the sides and the perimeter keep and the area squares.
fn triangle_solver(c: &mut Call) -> Answer {
    use Measure::*;
    const SPEC: [(&str, Measure); 8] = [
        ("a", Length),
        ("b", Length),
        ("c", Length),
        ("A", Angle),
        ("B", Angle),
        ("C", Angle),
        ("area", Area),
        ("perimeter", Length),
    ];
    let t = match FigureTable::read(c, "triangles", TRIANGLE_DEFAULT, &SPEC, "The three sides") {
        Ok(t) => t,
        Err(e) => return figure_error(c, &e, true),
    };
    let mut out: Vec<Vec<V>> = (0..8).map(|_| Vec::with_capacity(t.rows)).collect();
    let mut valid: Vec<V> = Vec::with_capacity(t.rows);
    let mut solved_by_row: Vec<V> = Vec::with_capacity(t.rows);
    for i in 0..t.rows {
        let (given, cell_err) = t.row(i);
        let parts: Parts = std::array::from_fn(|k| given[k]);
        let r = solve_given_parts(&parts, given[6], given[7], cell_err);
        for (k, v) in r.values.iter().enumerate() {
            out[k].push(v.clone());
        }
        out[6].push(r.area.clone());
        out[7].push(r.perimeter.clone());
        valid.push(r.valid);
        solved_by_row.push(list(r.solved.iter().map(|&k| V::Str(Rc::from(PART_KEYS[k]))).collect()));
    }
    let frame = t.answer(out);
    figure_answer(c, frame, Some(valid), Some(solved_by_row))
}

// ─── Reading and answering a figure's table ─────────────────────────────────────────────────────────────────────────

/// What a figure card's column measures, which sets the unit it reads and answers in.
#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Measure {
    /// A length: every length column reads in the first united length column's unit and answers in it.
    Length,
    /// An area, in that length unit squared.
    Area,
    /// An angle, in degrees.
    Angle,
    /// A bare number (a count, a slope): no unit.
    Plain,
    /// A volume, in that length unit cubed.
    Volume,
    /// Text the card writes (an equation); it reads none.
    Text,
    /// A logical the card writes (convex or not); it reads none.
    Flag,
}

impl Measure {
    /// A column the card only writes.
    fn written(self) -> bool {
        matches!(self, Measure::Text | Measure::Flag)
    }
}

/// A figure card's input table: the wired frame or the card's own keyed one, each column's factor into the figure's
/// units, and an error that holds for every row (a unit clash, a date column).
pub(crate) struct FigureTable<'s> {
    input: Frame,
    spec: &'s [(&'static str, Measure)],
    pub(crate) rows: usize,
    factors: Vec<f64>,
    table_err: Option<V>,
    length_unit: Option<Json>,
}

impl<'s> FigureTable<'s> {
    /// The table under `key`, or the wired error to answer with. `lengths` names the length columns in the message
    /// for two lengths of different dimensions.
    pub(crate) fn read(
        c: &Call,
        key: &str,
        default: &str,
        spec: &'s [(&'static str, Measure)],
        lengths: &str,
    ) -> Result<Self, V> {
        let input: Frame = match c.wired_card(key) {
            Some([Cv::V(e), ..]) if e.is_sol_error() => return Err(e.clone()),
            Some([Cv::Frame(f), ..]) => (**f).clone(),
            Some([_, ..]) => Frame::default(),
            _ => {
                let source = super::docs::parse_frame_source(c.field_str("frameText", default));
                Frame {
                    columns: source.iter().map(|s| super::docs::derive_column(s, Default::default())).collect(),
                    ..Frame::default()
                }
            }
        };
        let col = |name: &str| input.columns.iter().find(|col| col.name == name);
        let rows = input.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
        let length_unit =
            spec.iter().filter(|(_, m)| *m == Measure::Length).find_map(|(k, _)| col(k).and_then(|c| c.unit.clone()));
        let target = length_unit.as_ref().map(unit_of_json);
        let square = target.as_ref().map(|(dim, to)| (dim_pow(dim, 2.0), to * to));
        let cube = target.as_ref().map(|(dim, to)| (dim_pow(dim, 3.0), to * to * to));
        let deg = unit_of_json(&super::columns::unit_json(&angle_dim(), Some("deg")));
        let factors: Result<Vec<f64>, V> = spec
            .iter()
            .map(|(k, m)| {
                let into = match m {
                    Measure::Angle => Some(&deg),
                    Measure::Area => square.as_ref(),
                    Measure::Volume => cube.as_ref(),
                    Measure::Length => target.as_ref(),
                    Measure::Plain | Measure::Text | Measure::Flag => None,
                };
                match (col(k).and_then(|c| c.unit.as_ref()).map(unit_of_json), into, m) {
                    (Some(_), _, Measure::Plain) => Err(V::err(unit_error(&format!("{k} takes no unit.")))),
                    (None, _, _) | (_, None, _) => Ok(1.0),
                    (Some((dim, scale)), Some((want, to)), _) if dim_equal(&dim, want) => Ok(scale / to),
                    (Some(_), Some(_), Measure::Angle) => Err(V::err(unit_error(&format!("{k} is an angle.")))),
                    (Some(_), Some(_), Measure::Area) => {
                        Err(V::err(unit_error(&format!("{k} must be in the lengths' unit squared."))))
                    }
                    (Some(_), Some(_), Measure::Volume) => {
                        Err(V::err(unit_error(&format!("{k} must be in the lengths' unit cubed."))))
                    }
                    _ => Err(V::err(unit_error(&format!("{lengths} must share one dimension.")))),
                }
            })
            .collect();
        let (factors, unit_err) = match factors {
            Ok(f) => (f, None),
            Err(e) => (vec![1.0; spec.len()], Some(e)),
        };
        // A part is an amount: a date or logical column among them is refused, never read as its serial.
        let kind_err = spec.iter().filter(|(_, m)| !m.written()).find_map(|(k, _)| match col(k).map(|c| c.ty) {
            Some(FrameColType::Date) => Some(err(ErrorCode::Type, format!("{k} is a date column; it takes numbers."))),
            Some(FrameColType::Logical) => {
                Some(err(ErrorCode::Type, format!("{k} is a logical column; it takes numbers.")))
            }
            _ => None,
        });
        Ok(FigureTable { input, spec, rows, factors, table_err: kind_err.or(unit_err), length_unit })
    }

    /// Row `i`'s numbers in the figure's units, by the spec's order, and the first error among them.
    pub(crate) fn row(&self, i: usize) -> (Vec<Option<f64>>, Option<V>) {
        let mut cell_err = self.table_err.clone();
        let given = self
            .spec
            .iter()
            .enumerate()
            .map(|(k, (name, m))| {
                if m.written() {
                    return None;
                }
                let cell = self
                    .input
                    .columns
                    .iter()
                    .find(|col| col.name == *name)
                    .and_then(|col| col.values.get(i).cloned())
                    .unwrap_or(V::Null);
                match cell {
                    e if e.is_sol_error() => {
                        cell_err.get_or_insert(e);
                        None
                    }
                    V::Num(n) if self.factors[k] == 1.0 => Some(n),
                    V::Num(n) => Some(to_precision(n * self.factors[k], 15)),
                    V::Null => None,
                    V::Str(t) if t.trim().is_empty() => None,
                    _ => {
                        cell_err.get_or_insert(err(ErrorCode::Value, format!("{name} must be a number.")));
                        None
                    }
                }
            })
            .collect();
        (given, cell_err)
    }

    /// The length unit raised to `power`, with its display where the catalog names one (`m2`, `cm3`).
    fn unit_power(&self, power: f64) -> Option<Json> {
        let u = self.length_unit.as_ref()?;
        let dim: Dim = serde_json::from_value(u.get("dim")?.clone()).ok()?;
        let raised = dim_pow(&dim, power);
        let id = u.get("display").and_then(Json::as_str).map(|d| format!("{d}{power}"));
        let display = id.filter(|i| fc_unit_to_unit(i).is_some_and(|q| dim_equal(&q.dim, &raised)));
        Some(super::columns::unit_json(&raised, display.as_deref()))
    }

    /// A column of `values` named `name`, in its measure's unit.
    fn column(&self, name: &str, m: Measure, values: Vec<V>) -> Column {
        let base = super::frames::num_column(name, values);
        match m {
            Measure::Length => Column { unit: self.length_unit.clone(), ..base },
            Measure::Area => Column { unit: self.unit_power(2.0), ..base },
            Measure::Volume => Column { unit: self.unit_power(3.0), ..base },
            Measure::Angle => Column { unit: Some(super::columns::unit_json(&angle_dim(), Some("deg"))), ..base },
            Measure::Plain => base,
            Measure::Text => Column { ty: FrameColType::String, ..base },
            Measure::Flag => Column { ty: FrameColType::Logical, ..base },
        }
    }

    /// The input frame with the spec's columns filled from `out` (each in its measure's unit) in place, the rest kept,
    /// and any spec column the input lacked appended in the spec's order.
    pub(crate) fn answer(&self, mut out: Vec<Vec<V>>) -> Cv {
        let mut columns: Vec<Column> = Vec::with_capacity(self.input.columns.len() + self.spec.len());
        let mut placed = vec![false; self.spec.len()];
        for c0 in &self.input.columns {
            match self.spec.iter().position(|(k, _)| *k == c0.name) {
                Some(k) if !placed[k] => {
                    placed[k] = true;
                    columns.push(self.column(self.spec[k].0, self.spec[k].1, std::mem::take(&mut out[k])));
                }
                _ => columns.push(c0.clone()),
            }
        }
        for k in 0..self.spec.len() {
            if !placed[k] {
                columns.push(self.column(self.spec[k].0, self.spec[k].1, std::mem::take(&mut out[k])));
            }
        }
        super::frames::frame_v(columns)
    }

    /// A frame of its own, `spec`'s columns from `out`, in the table's units: a summary beside the answer.
    pub(crate) fn summary(&self, spec: &[(&str, Measure)], out: Vec<Vec<V>>) -> Cv {
        super::frames::frame_v(spec.iter().zip(out).map(|((name, m), values)| self.column(name, *m, values)).collect())
    }
}

/// A column unit (`{dim, display}`) as its dimension and its scale to base SI.
fn unit_of_json(u: &Json) -> (Dim, f64) {
    let dim: Dim = u.get("dim").and_then(|d| serde_json::from_value(d.clone()).ok()).unwrap_or_default();
    let scale = u.get("display").and_then(Json::as_str).and_then(fc_unit_to_unit).map_or(1.0, |f| f.scale);
    (dim, scale)
}

fn angle_dim() -> Dim {
    Dim::from([("angle".to_string(), 1.0)])
}

/// A wired error as the card's every answer.
fn figure_error(c: &mut Call, e: &V, checks: bool) -> Answer {
    c.show("cachedResult", e.clone());
    if checks {
        c.show("cachedValid", e.clone());
        return Ok(vec![("frame".into(), Cv::V(e.clone())), ("valid".into(), Cv::V(e.clone()))]);
    }
    Ok(vec![("frame".into(), Cv::V(e.clone()))])
}

/// The card's answer: the frame, and for a solver its Valid per row and the parts each row solved (for the figure).
fn figure_answer(c: &mut Call, frame: Cv, valid: Option<Vec<V>>, solved: Option<Vec<V>>) -> Answer {
    c.show("cachedResult", frame.clone());
    let mut outs = vec![("frame".to_string(), frame)];
    if let Some(valid) = valid {
        let valid = list(valid);
        c.show("cachedValid", valid.clone());
        outs.push(("valid".into(), Cv::V(valid)));
    }
    if let Some(solved) = solved {
        c.show("solvedByRow", list(solved));
    }
    Ok(outs)
}

// ─── The Unit Circle ────────────────────────────────────────────────────────────────────────────────────────────────

/// The card's columns, one row per angle.
const CIRCLE_COLUMNS: [&str; 12] = [
    "degrees",
    "radians",
    "reference",
    "sin",
    "cos",
    "tan",
    "csc",
    "sec",
    "cot",
    "sin exact",
    "cos exact",
    "tan exact",
];

/// A first-quadrant angle with exact values, every 15°: its sine and cosine, and its sine, cosine and tangent as
/// written (90°'s tangent `undefined`).
fn exact_reference(r: f64) -> Option<(f64, f64, &'static str, &'static str, &'static str)> {
    let (r2, r3, r6) = (std::f64::consts::SQRT_2, 3f64.sqrt(), 6f64.sqrt());
    let (lo, hi) = ((r6 - r2) / 4.0, (r6 + r2) / 4.0);
    Some(match r {
        0.0 => (0.0, 1.0, "0", "1", "0"),
        15.0 => (lo, hi, "(√6-√2)/4", "(√6+√2)/4", "2-√3"),
        30.0 => (0.5, r3 / 2.0, "1/2", "√3/2", "√3/3"),
        45.0 => (r2 / 2.0, r2 / 2.0, "√2/2", "√2/2", "1"),
        60.0 => (r3 / 2.0, 0.5, "√3/2", "1/2", "√3"),
        75.0 => (hi, lo, "(√6+√2)/4", "(√6-√2)/4", "2+√3"),
        90.0 => (1.0, 0.0, "1", "0", "undefined"),
        _ => return None,
    })
}

/// An exact form negated: zero and `undefined` stay themselves, `2-√3` turns round to `√3-2`, anything else takes a
/// minus sign.
fn negated(t: &str) -> String {
    match t {
        "0" | "undefined" => t.to_string(),
        "2-√3" => "√3-2".to_string(),
        "2+√3" => "-2-√3".to_string(),
        t => format!("-{t}"),
    }
}

/// One angle's row: the angle as given in degrees and radians, its reference angle, the six functions (the axes exact,
/// and where one is undefined, tan and sec at 90° and 270°, cot and csc at 0° and 180°, a blank: a dial turned past
/// them lands there often, and nothing downstream should light up for it), and the exact forms at every multiple of
/// 15°, where `tan exact` reads `undefined`.
fn circle_row(deg: f64) -> [V; 12] {
    let standard = match to_precision(deg.rem_euclid(360.0), 12) {
        x if x >= 360.0 => 0.0,
        x => x,
    };
    let reference = match standard {
        x if x <= 90.0 => x,
        x if x <= 180.0 => 180.0 - x,
        x if x <= 270.0 => x - 180.0,
        x => 360.0 - x,
    };
    // The signs by quadrant: sine is negative below the x axis, cosine left of the y axis.
    let (sin_neg, cos_neg) = (standard > 180.0, standard > 90.0 && standard < 270.0);
    let exact = exact_reference(reference);
    let (s, co) = match exact {
        Some((s, co, ..)) => (if sin_neg { -s } else { s }, if cos_neg { -co } else { co }),
        None => (sin(standard * D2R), cos(standard * D2R)),
    };
    let ratio = |num: f64, den: f64| if den == 0.0 { V::Null } else { V::Num(num / den + 0.0) };
    let signed = |t: &str, neg: bool| V::str(&if neg { negated(t) } else { t.to_string() });
    let (st, ct, tt) = match exact {
        Some((_, _, st, ct, tt)) => (signed(st, sin_neg), signed(ct, cos_neg), signed(tt, sin_neg != cos_neg)),
        None => (V::Null, V::Null, V::Null),
    };
    [
        V::Num(deg),
        V::Num(deg * D2R),
        V::Num(reference),
        V::Num(s),
        V::Num(co),
        ratio(s, co),
        ratio(1.0, s),
        ratio(1.0, co),
        ratio(co, s),
        st,
        ct,
        tt,
    ]
}

/// Unit Circle: one row per angle, the wired angles or the card's own. A bare number is degrees; an angle with a unit
/// converts.
fn unit_circle(c: &mut Call) -> Answer {
    let given = c.read("angle");
    let items: Vec<V> = match &given {
        V::List(xs) => xs.to_vec(),
        v => vec![v.clone()],
    };
    let angle: Dim = Dim::from([("angle".to_string(), 1.0)]);
    let mut out: Vec<Vec<V>> = (0..12).map(|_| Vec::with_capacity(items.len())).collect();
    for item in items {
        let row = match item {
            V::Num(d) if d.is_finite() => circle_row(d),
            V::Unit(u) if dim_equal(&u.dim, &angle) => circle_row(to_precision(u.value * R2D, 15)),
            V::Null | V::Undef => std::array::from_fn(|_| V::Null),
            e if e.is_sol_error() => std::array::from_fn(|_| e.clone()),
            other => {
                let e = match other {
                    V::Unit(_) => V::err(unit_error("The angle must be an angle.")),
                    V::Date(_) => err(ErrorCode::Type, "An angle can't be a date."),
                    V::Num(_) => err(ErrorCode::Domain, "The angle must be finite."),
                    _ => err(ErrorCode::Value, "The angle must be a number."),
                };
                std::array::from_fn(|_| e.clone())
            }
        };
        for (k, v) in row.into_iter().enumerate() {
            out[k].push(v);
        }
    }
    let deg = super::columns::unit_json(&angle, Some("deg"));
    let rad = super::columns::unit_json(&angle, Some("rad"));
    let columns = CIRCLE_COLUMNS
        .iter()
        .zip(out)
        .enumerate()
        .map(|(k, (name, values))| match k {
            0 | 2 => Column { unit: Some(deg.clone()), ..super::frames::num_column(name, values) },
            1 => Column { unit: Some(rad.clone()), ..super::frames::num_column(name, values) },
            9..=11 => Column { ty: FrameColType::String, ..super::frames::num_column(name, values) },
            _ => super::frames::num_column(name, values),
        })
        .collect();
    let frame = super::frames::frame_v(columns);
    c.show("cachedResult", frame.clone());
    Ok(vec![("circle".into(), frame)])
}

// ─── The Circle Solver ──────────────────────────────────────────────────────────────────────────────────────────────

/// The keyed table a fresh card holds: a radius-5 circle and a 60° arc.
pub(crate) const CIRCLE_DEFAULT: &str = r#"[{"name":"r","cells":["5"]},{"name":"d","cells":[""]},{"name":"circumference","cells":[""]},{"name":"area","cells":[""]},{"name":"angle","cells":["60"]},{"name":"arc","cells":[""]},{"name":"chord","cells":[""]},{"name":"sector","cells":[""]},{"name":"segment","cells":[""]},{"name":"height","cells":[""]}]"#;

/// A circle part from the radius and the central angle (radians), by its place in the card's columns.
fn circle_part(k: usize, r: f64, t: f64) -> f64 {
    match k {
        0 => r,
        1 => 2.0 * r,
        2 => 2.0 * PI * r,
        3 => PI * r * r,
        4 => t,
        5 => r * t,
        6 => 2.0 * r * sin(t / 2.0),
        7 => r * r * t / 2.0,
        8 => r * r * (t - sin(t)) / 2.0,
        _ => r * (1.0 - cos(t / 2.0)),
    }
}

/// The radius an arc part `k` of size `v` has at central angle `t`: each grows with the radius alone.
fn radius_from(k: usize, v: f64, t: f64) -> f64 {
    match k {
        5 | 6 | 9 => v / circle_part(k, 1.0, t),
        _ => (v / circle_part(k, 1.0, t)).sqrt(),
    }
}

/// Circle Solver: one circle and arc per row. The whole-circle parts (r, d, circumference, area) give the radius, the
/// angle gives the arc; with neither, two arc parts find both, and where two arcs fit (a minor and a major) it says so.
/// Parts the solve didn't need are checks.
fn circle_solver(c: &mut Call) -> Answer {
    use Measure::*;
    const SPEC: [(&str, Measure); 10] = [
        ("r", Length),
        ("d", Length),
        ("circumference", Length),
        ("area", Area),
        ("angle", Angle),
        ("arc", Length),
        ("chord", Length),
        ("sector", Area),
        ("segment", Area),
        ("height", Length),
    ];
    let t = match FigureTable::read(c, "circles", CIRCLE_DEFAULT, &SPEC, "The lengths") {
        Ok(t) => t,
        Err(e) => return figure_error(c, &e, true),
    };
    let mut out: Vec<Vec<V>> = (0..10).map(|_| Vec::with_capacity(t.rows)).collect();
    let mut valid = Vec::with_capacity(t.rows);
    let mut solved = Vec::with_capacity(t.rows);
    for i in 0..t.rows {
        let (mut given, cell_err) = t.row(i);
        if let Some(a) = given[4].as_mut() {
            *a *= D2R;
        }
        let bad_cells = cell_err.is_some();
        let answer = cell_err.map_or_else(|| solve_circle(&given), Err);
        let mut deg = given.clone();
        if let Some(a) = deg[4].as_mut() {
            *a *= R2D;
        }
        match answer {
            Ok(Some((r, theta))) => {
                let got: Vec<f64> = (0..10)
                    .map(|k| match (k, theta) {
                        (4, Some(th)) => th * R2D,
                        (4.., None) => f64::NAN,
                        (_, th) => circle_part(k, r, th.unwrap_or(0.0)),
                    })
                    .collect();
                for k in 0..10 {
                    out[k].push(if got[k].is_nan() {
                        deg[k].map_or(V::Null, V::Num)
                    } else {
                        V::Num(deg[k].unwrap_or(got[k]))
                    });
                }
                let checked: Vec<f64> =
                    got.iter().zip(&deg).map(|(g, d)| if g.is_nan() { d.unwrap_or(0.0) } else { *g }).collect();
                valid.push(V::Bool(all_agree(&deg, &checked)));
                solved.push(solved_names(&SPEC, &given, true));
            }
            Ok(None) => {
                for k in 0..10 {
                    out[k].push(deg[k].map_or(V::Null, V::Num));
                }
                valid.push(V::Null);
                solved.push(solved_names(&SPEC, &given, false));
            }
            Err(e) => {
                for k in 0..10 {
                    out[k].push(if bad_cells { e.clone() } else { deg[k].map_or_else(|| e.clone(), V::Num) });
                }
                valid.push(if bad_cells { e.clone() } else { V::Bool(false) });
                solved.push(solved_names(&SPEC, &given, false));
            }
        }
    }
    let frame = t.answer(out);
    figure_answer(c, frame, Some(valid), Some(solved))
}

/// A row's radius and central angle (radians; none where no arc part was given), `None` where the parts don't fix a
/// circle, or the error that says why none fits.
fn solve_circle(g: &[Option<f64>]) -> Result<Option<(f64, Option<f64>)>, V> {
    for (k, v) in g.iter().enumerate() {
        match v {
            Some(x) if k == 4 && !(*x > 0.0 && *x <= 2.0 * PI + 1e-12) => {
                return Err(err(ErrorCode::Domain, "The angle must be more than 0° and at most 360°"))
            }
            Some(x) if !(*x > 0.0) => {
                return Err(err(
                    ErrorCode::Domain,
                    format!(
                        "{} must be positive",
                        ["r", "d", "circumference", "area", "angle", "arc", "chord", "sector", "segment", "height"][k]
                    ),
                ))
            }
            _ => {}
        }
    }
    let r_direct = (0..4).find_map(|k| g[k].map(|v| radius_from_whole(k, v)));
    let arcs: Vec<usize> = (5..10).filter(|&k| g[k].is_some()).collect();
    let theta = g[4];
    let one_root = |roots: Vec<f64>| match roots.len() {
        0 => Err(err(ErrorCode::Domain, "No circle fits those parts")),
        1 => Ok(roots[0]),
        _ => Err(err(ErrorCode::Solve, "Ambiguous: a minor and a major arc both fit. Give the angle")),
    };
    Ok(match (r_direct, theta) {
        (Some(r), Some(th)) => Some((r, Some(th))),
        (Some(r), None) => match arcs.first() {
            None => Some((r, None)),
            Some(&p) => {
                let v = g[p].unwrap_or(f64::NAN);
                let th = one_root(roots_on(&|th| circle_part(p, r, th) - v, 0.0, 2.0 * PI, v))?;
                Some((r, Some(th)))
            }
        },
        (None, Some(th)) => arcs.first().map(|&p| (radius_from(p, g[p].unwrap_or(f64::NAN), th), Some(th))),
        (None, None) if arcs.len() >= 2 => {
            let (p, q) = (arcs[0], arcs[1]);
            let (vp, vq) = (g[p].unwrap_or(f64::NAN), g[q].unwrap_or(f64::NAN));
            let th = one_root(roots_on(&|th| circle_part(q, radius_from(p, vp, th), th) - vq, 0.0, 2.0 * PI, vq))?;
            Some((radius_from(p, vp, th), Some(th)))
        }
        _ => None,
    })
}

/// The radius from a whole-circle part: r, d, circumference or area.
fn radius_from_whole(k: usize, v: f64) -> f64 {
    match k {
        0 => v,
        1 => v / 2.0,
        2 => v / (2.0 * PI),
        _ => (v / PI).sqrt(),
    }
}

// ─── The Regular Polygon ────────────────────────────────────────────────────────────────────────────────────────────

/// The keyed table a fresh card holds: a hexagon of side 4.
pub(crate) const POLYGON_DEFAULT: &str = r#"[{"name":"n","cells":["6"]},{"name":"side","cells":["4"]},{"name":"circumradius","cells":[""]},{"name":"apothem","cells":[""]},{"name":"perimeter","cells":[""]},{"name":"area","cells":[""]},{"name":"interior","cells":[""]},{"name":"exterior","cells":[""]}]"#;

/// A regular polygon's part from its side count and side, by its place in the card's columns (angles in degrees).
fn polygon_part(k: usize, n: f64, s: f64) -> f64 {
    let half = PI / n;
    match k {
        0 => n,
        1 => s,
        2 => s / (2.0 * sin(half)),
        3 => s / (2.0 * libm::tan(half)),
        4 => n * s,
        5 => n * s * s / (4.0 * libm::tan(half)),
        6 => 180.0 * (n - 2.0) / n,
        _ => 360.0 / n,
    }
}

/// The side a size part `k` of value `v` gives an n-gon: each grows with the side alone.
fn side_from(k: usize, v: f64, n: f64) -> f64 {
    match k {
        5 => (v / polygon_part(5, n, 1.0)).sqrt(),
        _ => v / polygon_part(k, n, 1.0),
    }
}

/// Regular Polygon: one per row. The side count comes from n or an angle and must be a whole number of at least 3;
/// a size (side, circumradius, apothem, perimeter, area) scales it; with no count, two sizes find it.
fn regular_polygon(c: &mut Call) -> Answer {
    use Measure::*;
    const SPEC: [(&str, Measure); 8] = [
        ("n", Plain),
        ("side", Length),
        ("circumradius", Length),
        ("apothem", Length),
        ("perimeter", Length),
        ("area", Area),
        ("interior", Angle),
        ("exterior", Angle),
    ];
    let t = match FigureTable::read(c, "polygons", POLYGON_DEFAULT, &SPEC, "The lengths") {
        Ok(t) => t,
        Err(e) => return figure_error(c, &e, true),
    };
    let mut out: Vec<Vec<V>> = (0..8).map(|_| Vec::with_capacity(t.rows)).collect();
    let mut valid = Vec::with_capacity(t.rows);
    let mut solved = Vec::with_capacity(t.rows);
    for i in 0..t.rows {
        let (given, cell_err) = t.row(i);
        let bad_cells = cell_err.is_some();
        match cell_err.map_or_else(|| solve_polygon(&given), Err) {
            Ok(Some((n, s))) => {
                let got: Vec<f64> = (0..8)
                    .map(|k| {
                        if s.is_none() && (1..6).contains(&k) {
                            f64::NAN
                        } else {
                            polygon_part(k, n, s.unwrap_or(0.0))
                        }
                    })
                    .collect();
                for k in 0..8 {
                    out[k].push(if got[k].is_nan() {
                        given[k].map_or(V::Null, V::Num)
                    } else {
                        V::Num(given[k].unwrap_or(got[k]))
                    });
                }
                let checked: Vec<f64> =
                    got.iter().zip(&given).map(|(g, d)| if g.is_nan() { d.unwrap_or(0.0) } else { *g }).collect();
                valid.push(V::Bool(all_agree(&given, &checked)));
                solved.push(solved_names(&SPEC, &given, true));
            }
            Ok(None) => {
                for k in 0..8 {
                    out[k].push(given[k].map_or(V::Null, V::Num));
                }
                valid.push(V::Null);
                solved.push(solved_names(&SPEC, &given, false));
            }
            Err(e) => {
                for k in 0..8 {
                    out[k].push(if bad_cells { e.clone() } else { given[k].map_or_else(|| e.clone(), V::Num) });
                }
                valid.push(if bad_cells { e.clone() } else { V::Bool(false) });
                solved.push(solved_names(&SPEC, &given, false));
            }
        }
    }
    let frame = t.answer(out);
    figure_answer(c, frame, Some(valid), Some(solved))
}

/// A row's side count and side (none where no size was given), `None` where the parts don't fix a polygon, or the
/// error that says why none fits.
fn solve_polygon(g: &[Option<f64>]) -> Result<Option<(f64, Option<f64>)>, V> {
    for (k, v) in g.iter().enumerate().skip(1) {
        if let Some(x) = v
            && !(*x > 0.0)
        {
            return Err(err(
                ErrorCode::Domain,
                format!(
                    "{} must be positive",
                    ["n", "side", "circumradius", "apothem", "perimeter", "area", "interior", "exterior"][k]
                ),
            ));
        }
    }
    let whole = |n: f64, what: &str| {
        let r = n.round();
        if (n - r).abs() <= 1e-9 * r.max(1.0) && r >= 3.0 {
            Ok(r)
        } else {
            Err(err(ErrorCode::Domain, format!("{what} gives no whole number of sides of at least 3")))
        }
    };
    let n = match (g[0], g[6], g[7]) {
        (Some(n), ..) => Some(whole(n, "n")?),
        (None, Some(int), _) if int < 180.0 => Some(whole(360.0 / (180.0 - int), "The interior angle")?),
        (None, Some(_), _) => return Err(err(ErrorCode::Domain, "The interior angle must be under 180°")),
        (None, None, Some(ext)) => Some(whole(360.0 / ext, "The exterior angle")?),
        _ => None,
    };
    let sizes: Vec<usize> = (1..6).filter(|&k| g[k].is_some()).collect();
    Ok(match (n, sizes.as_slice()) {
        (Some(n), []) => Some((n, None)),
        (Some(n), [p, ..]) => Some((n, Some(side_from(*p, g[*p].unwrap_or(f64::NAN), n)))),
        (None, [p, q, ..]) => {
            // Two sizes: the count where their ratio holds, searched over whole counts.
            let (vp, vq) = (g[*p].unwrap_or(f64::NAN), g[*q].unwrap_or(f64::NAN));
            let fits: Vec<f64> = (3..=100_000)
                .map(f64::from)
                .filter(|&n| {
                    let got = polygon_part(*q, n, side_from(*p, vp, n));
                    (got - vq).abs() <= 1e-9 * vq.abs().max(1.0)
                })
                .collect();
            match fits.as_slice() {
                [n] => Some((*n, Some(side_from(*p, vp, *n)))),
                [] => return Err(err(ErrorCode::Domain, "No regular polygon fits those parts")),
                _ => return Err(err(ErrorCode::Solve, "Ambiguous: more than one polygon fits. Give n")),
            }
        }
        _ => None,
    })
}

// ─── Two Points ─────────────────────────────────────────────────────────────────────────────────────────────────────

/// The keyed table a fresh card holds.
pub(crate) const POINTS_DEFAULT: &str = r#"[{"name":"x1","cells":["1"]},{"name":"y1","cells":["2"]},{"name":"x2","cells":["5"]},{"name":"y2","cells":["5"]}]"#;

/// A number for the line's equation, to six significant digits: the equation is for reading, the slope and
/// intercept columns hold the full values.
fn eq_num(x: f64) -> String {
    number_to_string(to_precision(x, 6) + 0.0)
}

/// The line through two points as an equation: `y = mx + b`, or `x = c` for a vertical one.
fn line_equation(m: Option<f64>, b: f64, x: f64) -> String {
    let Some(m) = m else { return format!("x = {}", eq_num(x)) };
    let slope = match to_precision(m, 10) {
        0.0 => String::new(),
        1.0 => "x".into(),
        -1.0 => "-x".into(),
        m => format!("{}x", eq_num(m)),
    };
    let b = to_precision(b, 10);
    match (slope.is_empty(), b) {
        (true, b) => format!("y = {}", eq_num(b)),
        (false, 0.0) => format!("y = {slope}"),
        (false, b) if b < 0.0 => format!("y = {slope} - {}", eq_num(-b)),
        (false, b) => format!("y = {slope} + {}", eq_num(b)),
    }
}

/// Two Points: per row, the segment between (x1, y1) and (x2, y2) and the line through them: distance, the run and
/// rise, the midpoint, slope, direction, both intercepts and the equation. What the line leaves undefined (a vertical
/// slope, a horizontal line's x-intercept, two equal points) is `#DIV/0!`.
fn two_points(c: &mut Call) -> Answer {
    use Measure::*;
    const SPEC: [(&str, Measure); 14] = [
        ("x1", Length),
        ("y1", Length),
        ("x2", Length),
        ("y2", Length),
        ("distance", Length),
        ("dx", Length),
        ("dy", Length),
        ("mid x", Length),
        ("mid y", Length),
        ("slope", Plain),
        ("angle", Angle),
        ("y-intercept", Length),
        ("x-intercept", Length),
        ("equation", Text),
    ];
    let t = match FigureTable::read(c, "points", POINTS_DEFAULT, &SPEC, "The coordinates") {
        Ok(t) => t,
        Err(e) => return figure_error(c, &e, false),
    };
    let mut out: Vec<Vec<V>> = (0..14).map(|_| Vec::with_capacity(t.rows)).collect();
    for i in 0..t.rows {
        let (g, cell_err) = t.row(i);
        let row: Vec<V> = match (cell_err, g[0], g[1], g[2], g[3]) {
            (Some(e), ..) => vec![e; 14],
            (None, Some(x1), Some(y1), Some(x2), Some(y2)) => {
                let (dx, dy) = (x2 - x1, y2 - y1);
                let same = dx == 0.0 && dy == 0.0;
                let undefined = |why: &str| err(ErrorCode::DivZero, why.to_string());
                let m = (dx != 0.0).then(|| dy / dx);
                let b = m.map(|m| y1 - m * x1);
                let line = |v: V| if same { undefined("The two points are the same") } else { v };
                vec![
                    V::Num(x1),
                    V::Num(y1),
                    V::Num(x2),
                    V::Num(y2),
                    V::Num(crate::excel_functions::hypot_all(&[dx, dy])),
                    V::Num(dx),
                    V::Num(dy),
                    V::Num((x1 + x2) / 2.0),
                    V::Num((y1 + y2) / 2.0),
                    line(m.map_or_else(|| undefined("The line is vertical"), V::Num)),
                    line(V::Num(libm::atan2(dy, dx) * R2D)),
                    line(b.map_or_else(|| undefined("The line is vertical"), V::Num)),
                    line(match m {
                        None => V::Num(x1),
                        Some(0.0) => undefined("The line is horizontal"),
                        Some(m) => V::Num(x1 - y1 / m),
                    }),
                    line(V::str(&line_equation(m, b.unwrap_or(0.0), x1))),
                ]
            }
            _ => (0..14).map(|k| g[k].map_or(V::Null, V::Num)).collect(),
        };
        for (k, v) in row.into_iter().enumerate() {
            out[k].push(v);
        }
    }
    let frame = t.answer(out);
    figure_answer(c, frame, None, None)
}

// ─── Shared by the solvers ──────────────────────────────────────────────────────────────────────────────────────────

/// The names of the parts a row didn't give, for the figure to mark as solved; none where nothing was solved.
fn solved_names(spec: &[(&str, Measure)], given: &[Option<f64>], solved: bool) -> V {
    if !solved {
        return list(Vec::new());
    }
    list(spec.iter().zip(given).filter(|(_, g)| g.is_none()).map(|((k, _), _)| V::str(k)).collect())
}

/// Every given part agrees with its solved value, to the solvers' relative 1e-6.
fn all_agree(given: &[Option<f64>], got: &[f64]) -> bool {
    given.iter().zip(got).all(|(g, x)| g.is_none_or(|w| (x - w).abs() <= 1e-6 * nan_max(1.0, w.abs())))
}

/// The roots of `g` on (lo, hi]: sign changes on a fine scan refined by bisection, and zeros the curve only touches,
/// found as local minima of |g| that a golden-section search takes to zero. Roots closer than 1e-7 are one.
fn roots_on(g: &dyn Fn(f64) -> f64, lo: f64, hi: f64, scale: f64) -> Vec<f64> {
    const N: usize = 4000;
    let tol = 1e-9 * scale.abs().max(1.0);
    let xs: Vec<f64> = (1..=N).map(|i| lo + (hi - lo) * i as f64 / N as f64).collect();
    let ys: Vec<f64> = xs.iter().map(|&x| g(x)).collect();
    let mut roots: Vec<f64> = Vec::new();
    let push = |r: f64, roots: &mut Vec<f64>| {
        if !roots.iter().any(|&q| (q - r).abs() < 1e-7) {
            roots.push(r);
        }
    };
    for i in 0..N {
        if ys[i].abs() <= tol {
            push(xs[i], &mut roots);
            continue;
        }
        if i + 1 < N && ys[i].is_finite() && ys[i + 1].is_finite() && ys[i].signum() != ys[i + 1].signum() {
            let (mut a, mut b, mut fa) = (xs[i], xs[i + 1], ys[i]);
            for _ in 0..80 {
                let m = 0.5 * (a + b);
                let fm = g(m);
                if fm.signum() == fa.signum() {
                    a = m;
                    fa = fm;
                } else {
                    b = m;
                }
            }
            push(0.5 * (a + b), &mut roots);
        }
        if i > 0 && i + 1 < N && ys[i].abs() < ys[i - 1].abs() && ys[i].abs() < ys[i + 1].abs() {
            let (mut a, mut b) = (xs[i - 1], xs[i + 1]);
            let phi = 0.5 * (5f64.sqrt() - 1.0);
            for _ in 0..100 {
                let (m1, m2) = (b - phi * (b - a), a + phi * (b - a));
                if g(m1).abs() < g(m2).abs() {
                    b = m2;
                } else {
                    a = m1;
                }
            }
            let m = 0.5 * (a + b);
            if g(m).abs() <= tol {
                push(m, &mut roots);
            }
        }
    }
    roots
}

// ─── Polygon from Points ────────────────────────────────────────────────────────────────────────────────────────────

/// The keyed table a fresh card holds: an irregular pentagon, one vertex per row.
pub(crate) const VERTICES_DEFAULT: &str =
    r#"[{"name":"x","cells":["0","4","5","2","-1"]},{"name":"y","cells":["0","0","3","5","3"]}]"#;

/// The polygon's summary row.
const POLYGON_SUMMARY: [(&str, Measure); 7] = [
    ("vertices", Measure::Plain),
    ("area", Measure::Area),
    ("perimeter", Measure::Length),
    ("centroid x", Measure::Length),
    ("centroid y", Measure::Length),
    ("convex", Measure::Flag),
    ("orientation", Measure::Text),
];

/// Do segments ab and cd cross (touching counts)?
fn segments_cross(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> bool {
    let orient = |p: (f64, f64), q: (f64, f64), r: (f64, f64)| (q.0 - p.0) * (r.1 - p.1) - (q.1 - p.1) * (r.0 - p.0);
    let on = |p: (f64, f64), q: (f64, f64), r: (f64, f64)| {
        r.0 >= p.0.min(q.0) && r.0 <= p.0.max(q.0) && r.1 >= p.1.min(q.1) && r.1 <= p.1.max(q.1)
    };
    let (d1, d2, d3, d4) = (orient(c, d, a), orient(c, d, b), orient(a, b, c), orient(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0)) {
        return true;
    }
    (d1 == 0.0 && on(c, d, a)) || (d2 == 0.0 && on(c, d, b)) || (d3 == 0.0 && on(a, b, c)) || (d4 == 0.0 && on(a, b, d))
}

/// Polygon from Points: the vertices in order, one per row (a row with neither coordinate is skipped), closed back to
/// the first. Each vertex gets its edge to the next and its interior angle; the polygon row has the count, the
/// shoelace area, the perimeter, the centroid, whether it is convex and which way it winds. Edges that cross make
/// the area and centroid `#DOMAIN!`.
fn polygon_points(c: &mut Call) -> Answer {
    use Measure::*;
    const SPEC: [(&str, Measure); 4] = [("x", Length), ("y", Length), ("edge", Length), ("angle", Angle)];
    let t = match FigureTable::read(c, "vertices", VERTICES_DEFAULT, &SPEC, "The coordinates") {
        Ok(t) => t,
        Err(e) => {
            c.show("cachedResult", e.clone());
            c.show("cachedPolygon", e.clone());
            return Ok(vec![("vertices".into(), Cv::V(e.clone())), ("polygon".into(), Cv::V(e))]);
        }
    };
    let mut out: Vec<Vec<V>> = (0..4).map(|_| vec![V::Null; t.rows]).collect();
    // The vertices in order, with the row each came from; the first bad row stops the polygon.
    let mut pts: Vec<(f64, f64)> = Vec::new();
    let mut at: Vec<usize> = Vec::new();
    let mut bad: Option<V> = None;
    for i in 0..t.rows {
        let (g, cell_err) = t.row(i);
        match (cell_err, g[0], g[1]) {
            (Some(e), ..) => {
                bad.get_or_insert(e);
            }
            (None, Some(x), Some(y)) => {
                out[0][i] = V::Num(x);
                out[1][i] = V::Num(y);
                pts.push((x, y));
                at.push(i);
            }
            (None, None, None) => {}
            (None, x, y) => {
                out[0][i] = x.map_or(V::Null, V::Num);
                out[1][i] = y.map_or(V::Null, V::Num);
                bad.get_or_insert(err(ErrorCode::Value, format!("Row {} has one coordinate", i + 1)));
            }
        }
    }
    let n = pts.len();
    let summary: Vec<V> = if let Some(e) = bad {
        for col in out.iter_mut().skip(2) {
            for v in col.iter_mut() {
                *v = e.clone();
            }
        }
        vec![e; 7]
    } else if n < 3 {
        vec![V::Num(n as f64), V::Null, V::Null, V::Null, V::Null, V::Null, V::Null]
    } else {
        let next = |k: usize| pts[(k + 1) % n];
        let prev = |k: usize| pts[(k + n - 1) % n];
        let twice: f64 = (0..n).map(|k| pts[k].0 * next(k).1 - next(k).0 * pts[k].1).sum();
        let ccw = twice >= 0.0;
        let mut turns = (0, 0);
        let mut perimeter = 0.0;
        for k in 0..n {
            let (p, q, r) = (prev(k), pts[k], next(k));
            let edge = crate::excel_functions::hypot_all(&[r.0 - q.0, r.1 - q.1]);
            perimeter += edge;
            out[2][at[k]] = V::Num(edge);
            let (u, v) = ((q.0 - p.0, q.1 - p.1), (r.0 - q.0, r.1 - q.1));
            let cross = u.0 * v.1 - u.1 * v.0;
            let dot = u.0 * v.0 + u.1 * v.1;
            out[3][at[k]] = if (u.0 == 0.0 && u.1 == 0.0) || (v.0 == 0.0 && v.1 == 0.0) {
                err(ErrorCode::DivZero, format!("Row {} repeats a neighbor", at[k] + 1))
            } else {
                // The turn at the vertex, counted the way the polygon winds; the interior angle is what it leaves.
                let turn = libm::atan2(if ccw { cross } else { -cross }, dot) * R2D;
                V::Num(180.0 - turn)
            };
            if cross > 0.0 {
                turns.0 += 1;
            } else if cross < 0.0 {
                turns.1 += 1;
            }
        }
        let simple = !(0..n)
            .any(|a| (a + 2..n).any(|b| (a != 0 || b != n - 1) && segments_cross(pts[a], next(a), pts[b], next(b))));
        let convex = simple && (turns.0 == 0 || turns.1 == 0);
        let (area, cx, cy) = if simple && twice != 0.0 {
            let (mut sx, mut sy) = (0.0, 0.0);
            for k in 0..n {
                let w = pts[k].0 * next(k).1 - next(k).0 * pts[k].1;
                sx += (pts[k].0 + next(k).0) * w;
                sy += (pts[k].1 + next(k).1) * w;
            }
            (V::Num(twice.abs() / 2.0), V::Num(sx / (3.0 * twice)), V::Num(sy / (3.0 * twice)))
        } else if simple {
            let e = err(ErrorCode::DivZero, "The vertices lie on one line");
            (V::Num(0.0), e.clone(), e)
        } else {
            let e = err(ErrorCode::Domain, "The edges cross, so the polygon has no one area");
            (e.clone(), e.clone(), e)
        };
        vec![
            V::Num(n as f64),
            area,
            V::Num(perimeter),
            cx,
            cy,
            V::Bool(convex),
            V::str(if ccw { "counterclockwise" } else { "clockwise" }),
        ]
    };
    let frame = t.answer(out);
    let polygon = t.summary(&POLYGON_SUMMARY, summary.into_iter().map(|v| vec![v]).collect());
    c.show("cachedResult", frame.clone());
    c.show("cachedPolygon", polygon.clone());
    Ok(vec![("vertices".into(), frame), ("polygon".into(), polygon)])
}

// ─── Solids ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/// A solid the card solves: its columns (its dimensions first) and each part from the dimensions.
struct Solid {
    spec: &'static [(&'static str, Measure)],
    /// How many of the leading columns are the dimensions the rest are worked from.
    dims: usize,
    part: fn(usize, &[f64]) -> f64,
    default: &'static str,
}

fn sphere_part(k: usize, d: &[f64]) -> f64 {
    let r = d[0];
    [r, 2.0 * r, 4.0 / 3.0 * PI * r * r * r, 4.0 * PI * r * r][k]
}
fn cube_part(k: usize, d: &[f64]) -> f64 {
    let s = d[0];
    [s, s * std::f64::consts::SQRT_2, s * 3f64.sqrt(), s * s * s, 6.0 * s * s][k]
}
fn box_part(k: usize, d: &[f64]) -> f64 {
    let (l, w, h) = (d[0], d[1], d[2]);
    [l, w, h, crate::excel_functions::hypot_all(&[l, w, h]), l * w * h, 2.0 * (l * w + l * h + w * h)][k]
}
fn cylinder_part(k: usize, d: &[f64]) -> f64 {
    let (r, h) = (d[0], d[1]);
    [r, h, 2.0 * r, PI * r * r * h, 2.0 * PI * r * h, 2.0 * PI * r * (r + h)][k]
}
fn cone_part(k: usize, d: &[f64]) -> f64 {
    let (r, h) = (d[0], d[1]);
    let l = crate::excel_functions::hypot_all(&[r, h]);
    [r, h, 2.0 * r, l, PI * r * r * h / 3.0, PI * r * l, PI * r * (r + l)][k]
}
fn pyramid_part(k: usize, d: &[f64]) -> f64 {
    let (b, h) = (d[0], d[1]);
    let slant = crate::excel_functions::hypot_all(&[h, b / 2.0]);
    let edge = (h * h + b * b / 2.0).sqrt();
    [b, h, slant, edge, b * b * h / 3.0, 2.0 * b * slant, b * b + 2.0 * b * slant][k]
}

/// The solid each shape names, by the card's `op`.
fn solid_of(op: &str) -> Solid {
    use Measure::*;
    match op {
        "cube" => Solid {
            spec: &[
                ("side", Length),
                ("face diagonal", Length),
                ("diagonal", Length),
                ("volume", Volume),
                ("surface", Area),
            ],
            dims: 1,
            part: cube_part,
            default: r#"[{"name":"side","cells":["3"]},{"name":"face diagonal","cells":[""]},{"name":"diagonal","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
        "box" => Solid {
            spec: &[
                ("length", Length),
                ("width", Length),
                ("height", Length),
                ("diagonal", Length),
                ("volume", Volume),
                ("surface", Area),
            ],
            dims: 3,
            part: box_part,
            default: r#"[{"name":"length","cells":["4"]},{"name":"width","cells":["3"]},{"name":"height","cells":["2"]},{"name":"diagonal","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
        "cylinder" => Solid {
            spec: &[
                ("r", Length),
                ("h", Length),
                ("d", Length),
                ("volume", Volume),
                ("lateral", Area),
                ("surface", Area),
            ],
            dims: 2,
            part: cylinder_part,
            default: r#"[{"name":"r","cells":["2"]},{"name":"h","cells":["5"]},{"name":"d","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
        "cone" => Solid {
            spec: &[
                ("r", Length),
                ("h", Length),
                ("d", Length),
                ("slant", Length),
                ("volume", Volume),
                ("lateral", Area),
                ("surface", Area),
            ],
            dims: 2,
            part: cone_part,
            default: r#"[{"name":"r","cells":["3"]},{"name":"h","cells":["4"]},{"name":"d","cells":[""]},{"name":"slant","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
        "pyramid" => Solid {
            spec: &[
                ("base", Length),
                ("h", Length),
                ("slant", Length),
                ("edge", Length),
                ("volume", Volume),
                ("lateral", Area),
                ("surface", Area),
            ],
            dims: 2,
            part: pyramid_part,
            default: r#"[{"name":"base","cells":["4"]},{"name":"h","cells":["3"]},{"name":"slant","cells":[""]},{"name":"edge","cells":[""]},{"name":"volume","cells":[""]},{"name":"lateral","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
        _ => Solid {
            spec: &[("r", Length), ("d", Length), ("volume", Volume), ("surface", Area)],
            dims: 1,
            part: sphere_part,
            default: r#"[{"name":"r","cells":["3"]},{"name":"d","cells":[""]},{"name":"volume","cells":[""]},{"name":"surface","cells":[""]}]"#,
        },
    }
}

/// The value of dimension `which` (the others as in `dims`) at which part `k` is `want`: every part grows with every
/// dimension, so a bisection in log space over a wide bracket finds the one there is, or none.
fn dim_for(solid: &Solid, dims: &[f64], which: usize, k: usize, want: f64) -> Option<f64> {
    let at = |x: f64| {
        let mut d = dims.to_vec();
        d[which] = x;
        (solid.part)(k, &d) - want
    };
    let (mut lo, mut hi) = (-60f64, 60f64);
    if !(at(libm::exp(lo)) <= 0.0 && at(libm::exp(hi)) >= 0.0) {
        return None;
    }
    for _ in 0..200 {
        let m = 0.5 * (lo + hi);
        if at(libm::exp(m)) < 0.0 {
            lo = m;
        } else {
            hi = m;
        }
    }
    Some(libm::exp(0.5 * (lo + hi)))
}

/// Does part `k` move with dimension `which`? (Every part grows with what it depends on, so a doubling shows it.)
fn depends(solid: &Solid, k: usize, which: usize) -> bool {
    let one = vec![1.0; solid.dims];
    let mut two = one.clone();
    two[which] = 2.0;
    (solid.part)(k, &one) != (solid.part)(k, &two)
}

/// A row's dimensions from its given parts, `None` where they don't fix the solid, or the error that says why none
/// fits or more than one does. Given dimensions are taken as they are; each one missing takes a given part: one
/// missing is found directly, two by scanning the first and finding the second from one part, the other part's
/// residual picking the fits.
fn solve_solid(solid: &Solid, g: &[Option<f64>]) -> Result<Option<Vec<f64>>, V> {
    for (k, v) in g.iter().enumerate() {
        if let Some(x) = v
            && !(*x > 0.0)
        {
            return Err(err(ErrorCode::Domain, format!("{} must be positive", solid.spec[k].0)));
        }
    }
    let mut dims: Vec<f64> = (0..solid.dims).map(|k| g[k].unwrap_or(1.0)).collect();
    let missing: Vec<usize> = (0..solid.dims).filter(|&k| g[k].is_none()).collect();
    let parts: Vec<usize> = (solid.dims..solid.spec.len()).filter(|&k| g[k].is_some()).collect();
    let no_fit = || Err(err(ErrorCode::Domain, format!("No {} fits those parts", solid.spec[0].0)));
    let two_fit = || Err(err(ErrorCode::Solve, "Ambiguous: more than one solid fits. Give a dimension"));
    if parts.len() < missing.len() {
        return Ok(None);
    }
    match missing.as_slice() {
        [] => {}
        [m] => {
            let Some(&p) = parts.iter().find(|&&p| depends(solid, p, *m)) else { return Ok(None) };
            match dim_for(solid, &dims, *m, p, g[p].unwrap_or(f64::NAN)) {
                Some(x) => dims[*m] = x,
                None => return no_fit(),
            }
        }
        [a, b] => {
            // The second missing dimension comes from a part that moves with it; the other part judges each fit.
            let Some(&p) = parts.iter().find(|&&p| depends(solid, p, *b)) else { return Ok(None) };
            let Some(&q) = parts.iter().find(|&&q| q != p && depends(solid, q, *a)) else { return Ok(None) };
            let (vp, vq) = (g[p].unwrap_or(f64::NAN), g[q].unwrap_or(f64::NAN));
            // Scan the first missing dimension in log space; the second is the one that makes part p hold.
            let with = |t: f64| {
                let mut d = dims.clone();
                d[*a] = libm::exp(t);
                dim_for(solid, &d, *b, p, vp).map(|y| {
                    d[*b] = y;
                    d
                })
            };
            let resid = |t: f64| with(t).map_or(f64::NAN, |d| (solid.part)(q, &d) / vq - 1.0);
            let roots = roots_on(&resid, -30.0, 30.0, 1.0);
            match roots.as_slice() {
                [t] => dims = with(*t).unwrap_or(dims),
                [] => return no_fit(),
                _ => return two_fit(),
            }
        }
        _ => return two_fit(),
    }
    Ok(Some(dims))
}

/// Solid: one solid of the card's shape per row (sphere, cube, box, cylinder, cone, square pyramid), its dimensions
/// and every measure, from any parts that fix them; parts the solve didn't need are checks.
fn solid_solver(c: &mut Call) -> Answer {
    let solid = solid_of(c.field_str("op", "sphere"));
    let t = match FigureTable::read(c, "solids", solid.default, solid.spec, "The lengths") {
        Ok(t) => t,
        Err(e) => return figure_error(c, &e, true),
    };
    let cols = solid.spec.len();
    let mut out: Vec<Vec<V>> = (0..cols).map(|_| Vec::with_capacity(t.rows)).collect();
    let mut valid = Vec::with_capacity(t.rows);
    let mut solved = Vec::with_capacity(t.rows);
    for i in 0..t.rows {
        let (given, cell_err) = t.row(i);
        let bad_cells = cell_err.is_some();
        match cell_err.map_or_else(|| solve_solid(&solid, &given), Err) {
            Ok(Some(dims)) => {
                let got: Vec<f64> = (0..cols).map(|k| (solid.part)(k, &dims)).collect();
                for k in 0..cols {
                    out[k].push(V::Num(given[k].unwrap_or(got[k])));
                }
                valid.push(V::Bool(all_agree(&given, &got)));
                solved.push(solved_names(solid.spec, &given, true));
            }
            Ok(None) => {
                for k in 0..cols {
                    out[k].push(given[k].map_or(V::Null, V::Num));
                }
                valid.push(V::Null);
                solved.push(solved_names(solid.spec, &given, false));
            }
            Err(e) => {
                for k in 0..cols {
                    out[k].push(if bad_cells { e.clone() } else { given[k].map_or_else(|| e.clone(), V::Num) });
                }
                valid.push(if bad_cells { e.clone() } else { V::Bool(false) });
                solved.push(solved_names(solid.spec, &given, false));
            }
        }
    }
    let frame = t.answer(out);
    figure_answer(c, frame, Some(valid), Some(solved))
}

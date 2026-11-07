//! Cable geometry, ported from `src/graph/cablePaths.ts` (`getCablePath`): the spline, and the diagonal and straight
//! walks on an 8- and 4-heading compass. A renderer reroutes a cable with this when a card moves; until then it draws
//! the path the app exported.

use crate::geom::Point;
use crate::path::{Path, Seg};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    #[default]
    Spline,
    Diagonal,
    Straight,
}

/// Where a cable leaves its source and enters its target, in flow coordinates, with the socket directions as unit
/// vectors (a right-hand output leaves along +x; a left-hand input is entered along +x).
#[derive(Clone, Copy, Debug)]
pub struct Ends {
    pub source: Point,
    pub target: Point,
    pub exit: Point,
    pub entry: Point,
}

impl Ends {
    /// Output on a card's right, input on a card's left: the usual layout.
    pub fn left_to_right(source: Point, target: Point) -> Ends {
        Ends {
            source,
            target,
            exit: Point::new(1.0, 0.0),
            entry: Point::new(1.0, 0.0),
        }
    }
}

const STRAIGHT_THRESHOLD: f32 = 15.0;
const ARM_MIN: f32 = 40.0;
const DIR_LEAD: f32 = 14.0;
const SOLVE_EPS: f32 = 0.01;
const DEDUP_EPS: f32 = 0.01;
const CORNER_RADIUS: f32 = 8.0;

pub fn route(shape: Shape, e: &Ends) -> Path {
    match shape {
        Shape::Spline => spline(e),
        Shape::Diagonal => polyline(&walk(e, 8)),
        Shape::Straight => rounded(&walk(e, 4), CORNER_RADIUS),
    }
}

fn spline(e: &Ends) -> Path {
    let d = e.target.minus(e.source);
    let dist = d.len();
    if dist < STRAIGHT_THRESHOLD {
        return Path::from_points(&[e.source, e.target]);
    }
    let travel = (d.x * e.exit.x + d.y * e.exit.y)
        .abs()
        .max((d.x * e.entry.x + d.y * e.entry.y).abs());
    let arm = ARM_MIN.max((dist * 0.4).min(travel + ARM_MIN));
    let c1 = e.source.plus(e.exit.scale(arm));
    let c2 = e.target.minus(e.entry.scale(arm));
    Path(vec![
        Seg::Move { to: e.source },
        Seg::Cubic {
            c1,
            c2,
            to: e.target,
        },
    ])
}

fn dir_of(k: i32, div: i32) -> Point {
    let a = (k.rem_euclid(div)) as f32 * (std::f32::consts::TAU / div as f32);
    Point::new(a.cos(), a.sin())
}

fn compass(d: Point, div: i32) -> i32 {
    let step = std::f32::consts::TAU / div as f32;
    ((d.y.atan2(d.x) / step).round() as i32).rem_euclid(div)
}

fn build_heads(ks: i32, sigma: i32, b: i32, r: i32, e: i32) -> Vec<i32> {
    let mut heads = vec![ks];
    let mut h = ks;
    for _ in 0..b {
        h -= sigma;
        heads.push(h);
    }
    for _ in 0..(b + r + e) {
        h += sigma;
        heads.push(h);
    }
    for _ in 0..e {
        h -= sigma;
        heads.push(h);
    }
    heads
}

fn add_to_heading(heads: &[i32], lens: &mut [f32], head: i32, amount: f32) {
    let n = heads.iter().filter(|&&h| h == head).count() as f32;
    for (i, &h) in heads.iter().enumerate() {
        if h == head {
            lens[i] += amount / n;
        }
    }
}

fn solve(
    heads: &[i32],
    d: Point,
    min_leg: f32,
    div: i32,
    min_first: f32,
    min_last: f32,
) -> Option<Vec<f32>> {
    let m = heads.len();
    let mut lens = vec![0.0f32; m];
    if m > 1 {
        lens[0] = min_first;
        lens[m - 1] = min_last;
    }
    for i in 1..m.saturating_sub(1) {
        if heads[i] - heads[i - 1] == heads[i + 1] - heads[i] {
            lens[i] = min_leg;
        }
    }
    let (mut rx, mut ry) = (d.x, d.y);
    for i in 0..m {
        if lens[i] == 0.0 {
            continue;
        }
        let v = dir_of(heads[i], div);
        rx -= v.x * lens[i];
        ry -= v.y * lens[i];
    }
    if (rx * rx + ry * ry).sqrt() < SOLVE_EPS {
        return Some(lens);
    }
    let lo = *heads.iter().min()?;
    let hi = *heads.iter().max()?;
    if lo == hi {
        let v = dir_of(lo, div);
        let along = rx * v.x + ry * v.y;
        if (rx * v.y - ry * v.x).abs() > SOLVE_EPS || along < -SOLVE_EPS {
            return None;
        }
        add_to_heading(heads, &mut lens, lo, along.max(0.0));
        return Some(lens);
    }
    let det = (std::f32::consts::TAU / div as f32).sin();
    for j in lo..hi {
        let g = dir_of(j + 1, div);
        let alpha = (rx * g.y - ry * g.x) / det;
        if alpha < -SOLVE_EPS {
            continue;
        }
        let f = dir_of(j, div);
        let beta = (f.x * ry - f.y * rx) / det;
        if beta < -SOLVE_EPS {
            continue;
        }
        add_to_heading(heads, &mut lens, j, alpha.max(0.0));
        add_to_heading(heads, &mut lens, j + 1, beta.max(0.0));
        return Some(lens);
    }
    None
}

fn walk(e: &Ends, div: i32) -> Vec<Point> {
    let (s, t) = (e.source, e.target);
    let dx = t.x - s.x;
    let dy = t.y - s.y;
    let dist = (dx * dx + dy * dy).sqrt();
    if dist < STRAIGHT_THRESHOLD {
        return vec![s, t];
    }
    let (ds, dt) = (e.exit, e.entry);
    let lead = DIR_LEAD.min(dist / 4.0);
    let min_leg = DIR_LEAD.min(dist / 8.0);
    let a = s.plus(ds.scale(lead));
    let b = t.minus(dt.scale(lead));
    let ks = compass(ds, div);
    let kt = compass(dt, div);
    let gs = dir_of(ks, div);
    let gt = dir_of(kt, div);
    let off_s = (ds.x * gs.y - ds.y * gs.x).abs() > 0.02;
    let off_t = (dt.x * gt.y - dt.y * gt.x).abs() > 0.02;
    let d = b.minus(a);
    let pref = if ds.x * dy - ds.y * dx + (dx * dt.y - dy * dt.x) >= 0.0 {
        1
    } else {
        -1
    };
    let mut cands: Vec<(i32, i32, i32, i32, i32)> = Vec::new();
    for sigma in [pref, -pref] {
        let r = ((kt - ks) * sigma).rem_euclid(div);
        let mut bb = 0;
        while bb + r <= div {
            let mut ee = 0;
            while bb + r + ee <= div {
                cands.push((r + 2 * (bb + ee), sigma, r, bb, ee));
                ee += 1;
            }
            bb += 1;
        }
    }
    // A stable sort by turns, as the TypeScript's.
    cands.sort_by_key(|c| c.0);
    let mut m = min_leg;
    while m >= 0.25 {
        let mut best: Option<(Vec<i32>, Vec<f32>, f32)> = None;
        for &(_, sigma, r, bb, ee) in &cands {
            let heads = build_heads(ks, sigma, bb, r, ee);
            let Some(lens) = solve(
                &heads,
                d,
                m,
                div,
                if off_s { m } else { 0.0 },
                if off_t { m } else { 0.0 },
            ) else {
                continue;
            };
            let total: f32 = lens.iter().sum();
            if best.as_ref().is_none_or(|b| total < b.2 - SOLVE_EPS) {
                best = Some((heads, lens, total));
            }
        }
        if let Some((heads, lens, _)) = best {
            let mut pts = vec![s, a];
            let mut p = a;
            for (h, l) in heads.iter().zip(&lens) {
                p = p.plus(dir_of(*h, div).scale(*l));
                pts.push(p);
            }
            pts.push(t);
            return pts;
        }
        m /= 2.0;
    }
    vec![s, t]
}

fn dedup(pts: &[Point]) -> Vec<Point> {
    let mut clean: Vec<Point> = Vec::with_capacity(pts.len());
    for &p in pts {
        if clean.last().is_none_or(|l| p.dist(*l) > DEDUP_EPS) {
            clean.push(p);
        }
    }
    clean
}

fn polyline(pts: &[Point]) -> Path {
    Path::from_points(&dedup(pts))
}

fn rounded(pts: &[Point], radius: f32) -> Path {
    let mut clean: Vec<Point> = Vec::new();
    for &p in pts {
        if clean.last().is_some_and(|l| p.dist(*l) <= DEDUP_EPS) {
            continue;
        }
        while clean.len() >= 2 {
            let a = clean[clean.len() - 2];
            let b = clean[clean.len() - 1];
            let u = b.minus(a);
            let v = p.minus(b);
            let sin_turn = (u.x * v.y - u.y * v.x) / (u.len() * v.len());
            if sin_turn.abs() > 0.005 || u.x * v.x + u.y * v.y < 0.0 {
                break;
            }
            clean.pop();
        }
        clean.push(p);
    }
    if clean.len() < 2 {
        return Path::from_points(&clean);
    }
    let mut segs = vec![Seg::Move { to: clean[0] }];
    for i in 1..clean.len() - 1 {
        let (a, v, b) = (clean[i - 1], clean[i], clean[i + 1]);
        let la = v.dist(a);
        let lb = b.dist(v);
        let r = radius.min(la / 2.0).min(lb / 2.0);
        let inn = v.minus(v.minus(a).scale(r / la));
        let out = v.plus(b.minus(v).scale(r / lb));
        segs.push(Seg::Line { to: inn });
        segs.push(Seg::Quad { c: v, to: out });
    }
    segs.push(Seg::Line {
        to: *clean.last().unwrap(),
    });
    Path(segs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(p: &Path) -> Vec<(f32, f32)> {
        p.0.iter().map(|s| (s.end().x, s.end().y)).collect()
    }

    #[test]
    fn diagonal_matches_the_app() {
        // personal-finance's first cable as the app drew it: a 14px lead, a 45° run, a vertical, a 45° run, a lead.
        let e = Ends::left_to_right(Point::new(291.5, 801.5), Point::new(3594.0, 5965.0));
        let got = pts(&route(Shape::Diagonal, &e));
        let want = [
            (291.5, 801.5),
            (305.5, 801.5),
            (1942.75, 2438.75),
            (1942.75, 4327.75),
            (3580.0, 5965.0),
            (3594.0, 5965.0),
        ];
        assert_eq!(got.len(), want.len(), "{got:?}");
        for (g, w) in got.iter().zip(want) {
            assert!(
                (g.0 - w.0).abs() < 0.5 && (g.1 - w.1).abs() < 0.5,
                "{got:?}"
            );
        }
    }

    #[test]
    fn spline_is_one_cubic() {
        let e = Ends::left_to_right(Point::new(0.0, 0.0), Point::new(200.0, 100.0));
        let p = route(Shape::Spline, &e);
        assert_eq!(p.0.len(), 2);
        let Seg::Cubic { c1, c2, .. } = p.0[1] else {
            panic!()
        };
        assert!((c1.x - 89.44).abs() < 0.1 && c1.y == 0.0);
        assert!((c2.x - 110.56).abs() < 0.1 && c2.y == 100.0);
    }

    #[test]
    fn straight_rounds_its_corners_and_close_ends_are_a_line() {
        let e = Ends::left_to_right(Point::new(0.0, 0.0), Point::new(200.0, 100.0));
        let p = route(Shape::Straight, &e);
        assert!(p.0.iter().any(|s| matches!(s, Seg::Quad { .. })));
        assert_eq!(p.0.last().unwrap().end(), Point::new(200.0, 100.0));
        let near = Ends::left_to_right(Point::new(0.0, 0.0), Point::new(5.0, 5.0));
        assert_eq!(route(Shape::Diagonal, &near).0.len(), 2);
    }

    #[test]
    fn backwards_cable_loops_round() {
        let e = Ends::left_to_right(Point::new(300.0, 0.0), Point::new(0.0, 200.0));
        let got = pts(&route(Shape::Diagonal, &e));
        assert!(got.len() > 3);
        assert!(
            got.iter().any(|p| p.0 > 300.0),
            "leaves rightward first: {got:?}"
        );
    }
}

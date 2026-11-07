//! Cable paths: SVG path data in, a list of segments out, flattened to polylines for renderers that draw lines only.

use crate::geom::{Point, Rect};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Seg {
    Move { to: Point },
    Line { to: Point },
    Quad { c: Point, to: Point },
    Cubic { c1: Point, c2: Point, to: Point },
}

impl Seg {
    pub fn end(&self) -> Point {
        match *self {
            Seg::Move { to } | Seg::Line { to } | Seg::Quad { to, .. } | Seg::Cubic { to, .. } => {
                to
            }
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Path(pub Vec<Seg>);

impl Path {
    pub fn from_points(pts: &[Point]) -> Path {
        let mut segs = Vec::with_capacity(pts.len());
        for (i, &p) in pts.iter().enumerate() {
            segs.push(if i == 0 {
                Seg::Move { to: p }
            } else {
                Seg::Line { to: p }
            });
        }
        Path(segs)
    }

    /// Absolute and relative `M L H V Q C Z` (what React Flow and the app's cable shapes write). Unknown commands stop
    /// the parse; what was read so far is kept.
    pub fn parse_svg(d: &str) -> Path {
        let mut toks = Tokens::new(d);
        let mut segs = Vec::new();
        let mut cur = Point::default();
        let mut start = Point::default();
        let mut cmd = b'M';
        loop {
            match toks.peek() {
                None => break,
                Some(Tok::Cmd(c)) => {
                    cmd = c;
                    toks.next();
                }
                Some(Tok::Num(_)) => {}
            }
            let rel = cmd.is_ascii_lowercase();
            let base = if rel { cur } else { Point::default() };
            let pt = |t: &mut Tokens, base: Point| -> Option<Point> {
                Some(Point::new(t.num()? + base.x, t.num()? + base.y))
            };
            match cmd.to_ascii_uppercase() {
                b'M' => {
                    let Some(p) = pt(&mut toks, base) else { break };
                    segs.push(Seg::Move { to: p });
                    cur = p;
                    start = p;
                    // Extra pairs after a move are lines.
                    cmd = if rel { b'l' } else { b'L' };
                }
                b'L' => {
                    let Some(p) = pt(&mut toks, base) else { break };
                    segs.push(Seg::Line { to: p });
                    cur = p;
                }
                b'H' => {
                    let Some(x) = toks.num() else { break };
                    let p = Point::new(if rel { cur.x + x } else { x }, cur.y);
                    segs.push(Seg::Line { to: p });
                    cur = p;
                }
                b'V' => {
                    let Some(y) = toks.num() else { break };
                    let p = Point::new(cur.x, if rel { cur.y + y } else { y });
                    segs.push(Seg::Line { to: p });
                    cur = p;
                }
                b'Q' => {
                    let (Some(c), Some(p)) = (pt(&mut toks, base), pt(&mut toks, base)) else {
                        break;
                    };
                    segs.push(Seg::Quad { c, to: p });
                    cur = p;
                }
                b'C' => {
                    let (Some(c1), Some(c2), Some(p)) = (
                        pt(&mut toks, base),
                        pt(&mut toks, base),
                        pt(&mut toks, base),
                    ) else {
                        break;
                    };
                    segs.push(Seg::Cubic { c1, c2, to: p });
                    cur = p;
                }
                b'Z' => {
                    segs.push(Seg::Line { to: start });
                    cur = start;
                    if matches!(toks.peek(), Some(Tok::Num(_))) {
                        break;
                    }
                }
                _ => break,
            }
        }
        Path(segs)
    }

    /// SVG path data (`M L Q C`, absolute), for putting a rerouted cable back into a DOM.
    pub fn to_svg(&self) -> String {
        let mut out = String::new();
        for s in &self.0 {
            let part = match *s {
                Seg::Move { to } => format!("M {},{} ", to.x, to.y),
                Seg::Line { to } => format!("L {},{} ", to.x, to.y),
                Seg::Quad { c, to } => format!("Q {},{} {},{} ", c.x, c.y, to.x, to.y),
                Seg::Cubic { c1, c2, to } => {
                    format!("C {},{} {},{} {},{} ", c1.x, c1.y, c2.x, c2.y, to.x, to.y)
                }
            };
            out.push_str(&part);
        }
        out.trim_end().to_string()
    }

    pub fn translate(&self, d: Point) -> Path {
        Path(
            self.0
                .iter()
                .map(|s| match *s {
                    Seg::Move { to } => Seg::Move { to: to.plus(d) },
                    Seg::Line { to } => Seg::Line { to: to.plus(d) },
                    Seg::Quad { c, to } => Seg::Quad {
                        c: c.plus(d),
                        to: to.plus(d),
                    },
                    Seg::Cubic { c1, c2, to } => Seg::Cubic {
                        c1: c1.plus(d),
                        c2: c2.plus(d),
                        to: to.plus(d),
                    },
                })
                .collect(),
        )
    }

    /// The polyline through the path, curves cut into pieces of about `tol` pixels of error.
    pub fn flatten(&self, tol: f32) -> Vec<Vec<Point>> {
        let mut out: Vec<Vec<Point>> = Vec::new();
        let mut cur = Point::default();
        for s in &self.0 {
            match *s {
                Seg::Move { to } => {
                    out.push(vec![to]);
                    cur = to;
                }
                Seg::Line { to } => {
                    if out.is_empty() {
                        out.push(vec![cur]);
                    }
                    out.last_mut().unwrap().push(to);
                    cur = to;
                }
                Seg::Quad { c, to } => {
                    if out.is_empty() {
                        out.push(vec![cur]);
                    }
                    let n = steps(cur.dist(c) + c.dist(to), tol);
                    let line = out.last_mut().unwrap();
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        let u = 1.0 - t;
                        line.push(
                            cur.scale(u * u)
                                .plus(c.scale(2.0 * u * t))
                                .plus(to.scale(t * t)),
                        );
                    }
                    cur = to;
                }
                Seg::Cubic { c1, c2, to } => {
                    if out.is_empty() {
                        out.push(vec![cur]);
                    }
                    let n = steps(cur.dist(c1) + c1.dist(c2) + c2.dist(to), tol);
                    let line = out.last_mut().unwrap();
                    for i in 1..=n {
                        let t = i as f32 / n as f32;
                        let u = 1.0 - t;
                        line.push(
                            cur.scale(u * u * u)
                                .plus(c1.scale(3.0 * u * u * t))
                                .plus(c2.scale(3.0 * u * t * t))
                                .plus(to.scale(t * t * t)),
                        );
                    }
                    cur = to;
                }
            }
        }
        out
    }

    /// A box holding every point and control point.
    pub fn bounds(&self) -> Option<Rect> {
        let mut it = self.0.iter().flat_map(|s| match *s {
            Seg::Move { to } | Seg::Line { to } => vec![to],
            Seg::Quad { c, to } => vec![c, to],
            Seg::Cubic { c1, c2, to } => vec![c1, c2, to],
        });
        let first = it.next()?;
        let (mut x0, mut y0, mut x1, mut y1) = (first.x, first.y, first.x, first.y);
        for p in it {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        }
        Some(Rect::new(x0, y0, x1 - x0, y1 - y0))
    }

    /// The distance from `p` to the nearest point of the path, for hit-testing a cable.
    pub fn distance_to(&self, p: Point) -> f32 {
        let mut best = f32::INFINITY;
        for line in self.flatten(1.0) {
            for w in line.windows(2) {
                best = best.min(dist_to_segment(p, w[0], w[1]));
            }
            if line.len() == 1 {
                best = best.min(p.dist(line[0]));
            }
        }
        best
    }
}

fn steps(len: f32, tol: f32) -> usize {
    ((len / tol.max(0.05)).sqrt().ceil() as usize).clamp(2, 64)
}

fn dist_to_segment(p: Point, a: Point, b: Point) -> f32 {
    let ab = b.minus(a);
    let l2 = ab.x * ab.x + ab.y * ab.y;
    if l2 == 0.0 {
        return p.dist(a);
    }
    let t = (((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2).clamp(0.0, 1.0);
    p.dist(a.plus(ab.scale(t)))
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Tok {
    Cmd(u8),
    Num(f32),
}

struct Tokens<'a> {
    s: &'a [u8],
    i: usize,
}

impl<'a> Tokens<'a> {
    fn new(s: &'a str) -> Self {
        Tokens {
            s: s.as_bytes(),
            i: 0,
        }
    }
    fn skip(&mut self) {
        while self.i < self.s.len()
            && (self.s[self.i].is_ascii_whitespace() || self.s[self.i] == b',')
        {
            self.i += 1;
        }
    }
    fn peek(&mut self) -> Option<Tok> {
        self.skip();
        let c = *self.s.get(self.i)?;
        if c.is_ascii_alphabetic() && c != b'e' && c != b'E' {
            return Some(Tok::Cmd(c));
        }
        let save = self.i;
        let n = self.num();
        self.i = save;
        n.map(Tok::Num)
    }
    fn next(&mut self) {
        self.skip();
        self.i += 1;
    }
    fn num(&mut self) -> Option<f32> {
        self.skip();
        let start = self.i;
        let s = self.s;
        let mut j = self.i;
        if j < s.len() && (s[j] == b'-' || s[j] == b'+') {
            j += 1;
        }
        let mut dot = false;
        while j < s.len() && (s[j].is_ascii_digit() || (s[j] == b'.' && !dot)) {
            dot |= s[j] == b'.';
            j += 1;
        }
        if j < s.len() && (s[j] == b'e' || s[j] == b'E') {
            j += 1;
            if j < s.len() && (s[j] == b'-' || s[j] == b'+') {
                j += 1;
            }
            while j < s.len() && s[j].is_ascii_digit() {
                j += 1;
            }
        }
        let v = std::str::from_utf8(&s[start..j])
            .ok()?
            .parse::<f32>()
            .ok()?;
        self.i = j;
        Some(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_react_flow_cable_data() {
        let p = Path::parse_svg(
            "M 291.49993896484375,801.5003051757812 L 305.5,801.5 L 1942.75,2438.75",
        );
        assert_eq!(p.0.len(), 3);
        assert_eq!(p.0[2].end(), Point::new(1942.75, 2438.75));
        let c = Path::parse_svg("M0,0 C 10,0 20,10 30,10 Q 40,10 40,20");
        assert!(matches!(c.0[1], Seg::Cubic { .. }));
        assert!(matches!(c.0[2], Seg::Quad { .. }));
        assert_eq!(Path::parse_svg(&c.to_svg()), c);
        let r = Path::parse_svg("m 10 10 l 5 0 h 5 v 5 z");
        assert_eq!(r.0.last().unwrap().end(), Point::new(10.0, 10.0));
        assert_eq!(r.0[2].end(), Point::new(20.0, 10.0));
    }

    #[test]
    fn flattens_and_measures() {
        let p = Path::parse_svg("M0,0 C 0,100 100,100 100,0");
        let lines = p.flatten(0.5);
        assert_eq!(lines.len(), 1);
        assert_eq!(*lines[0].last().unwrap(), Point::new(100.0, 0.0));
        assert!(p.distance_to(Point::new(50.0, 75.0)) < 1.0);
        assert!(p.distance_to(Point::new(50.0, -20.0)) > 19.0);
    }
}

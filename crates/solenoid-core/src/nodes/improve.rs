//! [[A1]] visualGraphCalculator. The Local Search card: the improvement half of a run-optimization model
//! (`tree/specs/computation/frame-verbs.md` § Local Search). A plan is each group's items in sequence; the card walks
//! each sequence adding up a Cost per item (its last_ the item before), a Penalty read at the running total, and counts
//! the items Allowed refuses, then makes the textbook moves (relocate an item, swap two, reverse a run: 2-opt) while one
//! lowers the plan's answer. As with Greedy Queue the formulas are LAMBDA cards in the graph; the card only runs the
//! moves, which a graph of table cards can't do in any useful time.

use super::frames::{frame_in, frame_v, num_column, str_input, trimmed};
use super::matrix::{wired_lambda, Body};
use super::measure::Measure;
use super::queue::{allowed, cell_number, key, keys, position, setting, taken, text};
use super::{err, Answer, Call, Column, Cv, Frame};
use crate::error_value::ErrorCode;
use crate::eval::Eval;
use crate::excel_functions::V;
use crate::frame::FrameColType;
use std::collections::HashMap;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    match kind {
        "LocalSearchNode" => Some(local_search(c)),
        _ => None,
    }
}

/// A formula's answer kept by group, item, the item before, and the cost so far, through it, and the place in line.
type Placed = (usize, usize, Spot, (u64, u64, usize));
/// The most answers kept for formulas that read where an item stands, before the store starts over.
const MAX_PLACED: usize = 400_000;
/// Guided search stops after this many dead ends in a row that find no better plan.
const DRY: usize = 2000;
/// Looking past dead ends takes at most this many times the plain search's work, with a floor for a quick one.
const GUIDED: u64 = 10;
const GUIDED_FLOOR: u64 = 200_000;
/// Guided search: a mark on a link adds this share of the average link's cost (Voudouris & Tsang's alpha; OR-Tools'
/// default is 0.1).
const LAMBDA: f64 = 0.1;
/// The longest run of neighbors moved together (Or-opt's 1, 2 and 3).
const MAX_RUN: usize = 3;
/// A search runs at most this many passes over every item.
const MAX_PASSES: f64 = 1000.0;
/// A search stops, keeping its best plan, after this many item walks: a time limit that answers the same everywhere.
const MAX_WORK: u64 = 20_000_000;
/// The columns the plan adds after the items' own, replacing an item column of the same name.
const ADDED: [&str; 5] = ["Position", "Cost", "So Far", "Penalty", "Allowed"];

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Spot {
    None,
    Item(usize),
    Start(usize),
}

/// A group's walk so far: the cost before the next item, the answer, and the items Allowed refused.
#[derive(Clone, Copy, Default)]
struct Acc {
    before: f64,
    total: f64,
    bad: u32,
}

#[derive(Clone, Copy)]
struct Score {
    bad: u32,
    total: f64,
}

impl Score {
    fn add(self, o: Score) -> Score {
        Score { bad: self.bad + o.bad, total: self.total + o.total }
    }
}

/// Where an item stands in its group's walk: the cost before it, the cost through it, and its place in line.
type Where = (f64, f64, usize);

/// One item's figures in the plan.
#[derive(Clone, Copy)]
struct Leg {
    cost: f64,
    at: f64,
    penalty: f64,
    ok: bool,
}

struct Model<'a> {
    items: &'a Frame,
    start: Option<&'a Frame>,
    start_cols: Vec<Option<usize>>,
    start_row: Vec<Option<usize>>,
    cost: Option<Body>,
    penalty: Option<Body>,
    allow: Option<Body>,
    /// Whether each formula reads before, at or position, so its answer for an item and its last can't be kept.
    moving: [bool; 3],
    back: bool,
    /// The Cost column, its number added to the Cost formula's.
    cost_col: Option<(usize, String)>,
    ev: Eval<'a>,
    memo: [HashMap<(usize, usize, Spot), f64>; 3],
    placed: [HashMap<Placed, f64>; 3],
    work: u64,
    /// The plan's total as it came, the size a move must beat rounding by.
    scale: f64,
    /// Guided search: what one mark on a link adds to the total the moves see, and each link's marks.
    lambda: f64,
    marked: HashMap<(Spot, usize), u32>,
    /// Whether any formula reads position, so the same item after the same one at another place can cost otherwise.
    reads_pos: bool,
}

impl Model<'_> {
    fn cell(&self, i: usize, at: Spot) -> V {
        match at {
            Spot::None => V::Null,
            Spot::Item(r) => self.items.columns[i].values.get(r).cloned().unwrap_or(V::Null),
            Spot::Start(r) => self.start_cols[i]
                .and_then(|j| self.start.and_then(|s| s.columns[j].values.get(r).cloned()))
                .unwrap_or(V::Null),
        }
    }

    /// Variable `i` of the names the formulas see, for item `this` after `last` in group `k`, at `at` in its walk.
    fn var(&self, i: usize, k: usize, this: Spot, last: Spot, (before, at, pos): Where) -> V {
        let n = self.items.columns.len();
        if i < n {
            return self.cell(i, this);
        }
        if i < 2 * n {
            return self.cell(i - n, last);
        }
        let s_len = self.start.map_or(0, |s| s.columns.len());
        if i < 2 * n + s_len {
            let s = self.start.expect("a Start frame");
            return self.start_row[k].and_then(|r| s.columns[i - 2 * n].values.get(r).cloned()).unwrap_or(V::Null);
        }
        V::Num([before, at, pos as f64].get(i - 2 * n - s_len).copied().unwrap_or(0.0))
    }

    /// Formula `f` (0 cost, 1 penalty, 2 allowed) for an item after its last, kept when it reads nothing that moves.
    fn ask(&mut self, f: usize, k: usize, this: Spot, last: Spot, at: Where) -> Result<f64, V> {
        let row = match this {
            Spot::Item(r) => r,
            Spot::Start(r) => usize::MAX - r,
            Spot::None => usize::MAX,
        };
        // A formula that reads where the item stands is kept by that too: the same item after the same one at the same
        // cost so far comes up again and again as moves are tried.
        let place = (at.0.to_bits(), at.1.to_bits(), if self.reads_pos { at.2 } else { 0 });
        if !self.moving[f]
            && let Some(&v) = self.memo[f].get(&(k, row, last))
        {
            return Ok(v);
        }
        if self.moving[f]
            && let Some(&v) = self.placed[f].get(&(k, row, last, place))
        {
            return Ok(v);
        }
        let args = |i| self.var(i, k, this, last, at);
        let shown = if let Spot::Item(r) = this { r } else { 0 };
        let v = match f {
            0 => keys(self.cost.as_ref(), &self.ev, &args, "cost", shown)?.first().copied().unwrap_or(0.0),
            1 => keys(self.penalty.as_ref(), &self.ev, &args, "penalty", shown)?.first().copied().unwrap_or(0.0),
            _ => f64::from(u8::from(allowed(self.allow.as_ref(), &self.ev, &args, shown)?)),
        };
        if !self.moving[f] {
            self.memo[f].insert((k, row, last), v);
        } else {
            if self.placed[f].len() >= MAX_PLACED {
                self.placed[f].clear();
            }
            self.placed[f].insert((k, row, last, place), v);
        }
        Ok(v)
    }

    fn own(&self, row: usize) -> Result<f64, V> {
        match &self.cost_col {
            Some((i, name)) => Ok(cell_number(self.items, *i, row, name)?.unwrap_or(0.0)),
            None => Ok(0.0),
        }
    }

    /// What a link's marks add while guided search is looking past a dead end; 0 otherwise.
    fn mark(&self, from: Spot, to: usize) -> f64 {
        if self.lambda == 0.0 {
            return 0.0;
        }
        self.lambda * f64::from(self.marked.get(&(from, to)).copied().unwrap_or(0))
    }

    fn begin(&self, k: usize) -> Spot {
        self.start_row[k].map_or(Spot::None, Spot::Start)
    }

    /// The link from `from` to item `to` in group `k` (or, `to` None, to the end: the way back to Start when the walk
    /// returns there), as its refusal and its cost plus penalty. Only for formulas that read nothing that moves.
    fn link(&mut self, k: usize, from: Spot, to: Option<usize>) -> Result<Delta, V> {
        self.work += 1;
        match to {
            Some(r) => {
                let this = Spot::Item(r);
                let cost = self.own(r)? + self.ask(0, k, this, from, (0.0, 0.0, 0))?;
                let pen = if self.penalty.is_some() { self.ask(1, k, this, from, (0.0, 0.0, 0))? } else { 0.0 };
                let ok = self.allow.is_none() || self.ask(2, k, this, from, (0.0, 0.0, 0))? != 0.0;
                Ok((i64::from(!ok), cost + pen + self.mark(from, r)))
            }
            None => match (self.back, self.start_row[k], from) {
                (true, Some(home), Spot::Item(_)) => Ok((0, self.ask(0, k, Spot::Start(home), from, (0.0, 0.0, 0))?)),
                _ => Ok((0, 0.0)),
            },
        }
    }

    /// The best move of item `i` of group `a`, each scored by the links it breaks and makes.
    fn best_by_links(&mut self, seqs: &[Vec<usize>], a: usize, i: usize, across: bool) -> Result<Option<Move>, V> {
        let s = &seqs[a];
        let n = s.len();
        let item = s[i];
        let spot = |k: usize, q: &[usize], p: usize, m: &Self| if p == 0 { m.begin(k) } else { Spot::Item(q[p - 1]) };
        let next = |q: &[usize], p: usize| q.get(p + 1).copied();
        let scale = self.scale;
        let mut best: Option<(Delta, Move)> = None;
        let offer = |d: Delta, mv: Move, best: &mut Option<(Delta, Move)>| {
            if better(d, best.map(|b| b.0), scale) {
                *best = Some((d, mv));
            }
        };
        // Taking out the run of 1 to 3 items from i joins its neighbors; putting it between two items parts them. The
        // run's own links stay, though in another group they are that group's.
        for len in 1..=MAX_RUN.min(n - i) {
            let (first, last) = (s[i], s[i + len - 1]);
            let (before, after) = (spot(a, s, i, self), s.get(i + len).copied());
            let out = minus(
                self.link(a, before, after)?,
                plus(self.link(a, before, Some(first))?, self.link(a, Spot::Item(last), after)?),
            );
            let without: Vec<usize> = s[..i].iter().chain(&s[i + len..]).copied().collect();
            for b in 0..seqs.len() {
                if !across && b != a {
                    continue;
                }
                let inner = if b == a {
                    (0, 0.0)
                } else {
                    let mut d = (0, 0.0);
                    for p in i + 1..i + len {
                        let (from, to) = (Spot::Item(s[p - 1]), Some(s[p]));
                        d = plus(d, minus(self.link(b, from, to)?, self.link(a, from, to)?));
                    }
                    d
                };
                let q: &[usize] = if b == a { &without } else { &seqs[b] };
                for j in 0..=q.len() {
                    if b == a && j == i {
                        continue;
                    }
                    let (u, v) = (spot(b, q, j, self), q.get(j).copied());
                    let put = minus(
                        plus(self.link(b, u, Some(first))?, self.link(b, Spot::Item(last), v)?),
                        self.link(b, u, v)?,
                    );
                    offer(plus(plus(out, put), inner), Move::Relocate(b, j, len), &mut best);
                }
            }
        }
        // Trading places: the links on both sides of each item, the pair's own link once when they are neighbors.
        for b in 0..seqs.len() {
            if !across && b != a {
                continue;
            }
            let q = &seqs[b];
            let from = if b == a { i + 1 } else { 0 };
            for j in from..q.len() {
                let other = q[j];
                let d = if b == a && j == i + 1 {
                    let (p, nx) = (spot(a, s, i, self), next(s, j));
                    let old = plus(
                        plus(self.link(a, p, Some(item))?, self.link(a, Spot::Item(item), Some(other))?),
                        self.link(a, Spot::Item(other), nx)?,
                    );
                    let new = plus(
                        plus(self.link(a, p, Some(other))?, self.link(a, Spot::Item(other), Some(item))?),
                        self.link(a, Spot::Item(item), nx)?,
                    );
                    minus(new, old)
                } else {
                    let (pa, na) = (spot(a, s, i, self), next(s, i));
                    let (pb, nb) = (spot(b, q, j, self), next(q, j));
                    let old = plus(
                        plus(self.link(a, pa, Some(item))?, self.link(a, Spot::Item(item), na)?),
                        plus(self.link(b, pb, Some(other))?, self.link(b, Spot::Item(other), nb)?),
                    );
                    let new = plus(
                        plus(self.link(a, pa, Some(other))?, self.link(a, Spot::Item(other), na)?),
                        plus(self.link(b, pb, Some(item))?, self.link(b, Spot::Item(item), nb)?),
                    );
                    minus(new, old)
                };
                offer(d, Move::Swap(b, j), &mut best);
            }
        }
        // Reversing i..=j: the run's links turn round, kept as two running sums as j grows.
        let p = spot(a, s, i, self);
        let (mut fwd, mut rev) = ((0, 0.0), (0, 0.0));
        for j in i + 1..n {
            fwd = plus(fwd, self.link(a, Spot::Item(s[j - 1]), Some(s[j]))?);
            rev = plus(rev, self.link(a, Spot::Item(s[j]), Some(s[j - 1]))?);
            if j < i + 2 {
                continue;
            }
            let nx = next(s, j);
            let old = plus(plus(self.link(a, p, Some(item))?, fwd), self.link(a, Spot::Item(s[j]), nx)?);
            let new = plus(plus(self.link(a, p, Some(s[j]))?, rev), self.link(a, Spot::Item(item), nx)?);
            offer(minus(new, old), Move::Reverse(j), &mut best);
        }
        Ok(best.map(|b| b.1))
    }

    /// The best move of item `i` of group `a`, each scored by walking the sequences it changes from where they change.
    fn best_by_walks(
        &mut self,
        seqs: &[Vec<usize>],
        marks: &[Vec<Acc>],
        scores: &[Score],
        a: usize,
        i: usize,
        across: bool,
    ) -> Result<Option<Move>, V> {
        let n = seqs[a].len();
        let mut moves: Vec<Move> = Vec::new();
        for b in 0..seqs.len() {
            if !across && b != a {
                continue;
            }
            if b == a {
                for len in 1..=MAX_RUN.min(n - i) {
                    moves.extend((0..=n - len).filter(|&j| j != i).map(|j| Move::Relocate(a, j, len)));
                }
                moves.extend((i + 1..n).map(|j| Move::Swap(a, j)));
                moves.extend((i + 2..n).map(Move::Reverse));
            } else {
                for len in 1..=MAX_RUN.min(n - i) {
                    moves.extend((0..=seqs[b].len()).map(|j| Move::Relocate(b, j, len)));
                }
                moves.extend((0..seqs[b].len()).map(|j| Move::Swap(b, j)));
            }
        }
        let mut best: Option<(Delta, Move)> = None;
        for mv in moves {
            let mut d: Delta = (0, 0.0);
            for (k, seq, from) in changes(seqs, a, i, mv) {
                let then = self.rewalk(k, &seq, from, marks[k][from], (&seqs[k], &marks[k], scores[k]))?;
                d = plus(d, (i64::from(then.bad) - i64::from(scores[k].bad), then.total - scores[k].total));
            }
            if better(d, best.map(|b| b.0), self.scale) {
                best = Some((d, mv));
            }
        }
        Ok(best.map(|b| b.1))
    }

    fn leg(&mut self, k: usize, seq: &[usize], p: usize, before: f64) -> Result<Leg, V> {
        let last = if p == 0 { self.begin(k) } else { Spot::Item(seq[p - 1]) };
        let this = Spot::Item(seq[p]);
        let cost = self.own(seq[p])? + self.ask(0, k, this, last, (before, 0.0, p + 1))?;
        let at = before + cost;
        let penalty = if self.penalty.is_some() { self.ask(1, k, this, last, (before, at, p + 1))? } else { 0.0 };
        let ok = self.allow.is_none() || self.ask(2, k, this, last, (before, at, p + 1))? != 0.0;
        Ok(Leg { cost, at, penalty, ok })
    }

    /// Group `k`'s sequence walked from position `from`, `acc` the walk up to there; with `marks`, the walk before
    /// each position and at the end is written down. With Ends set to return, the leg from the last item back to the Start row.
    /// A changed sequence walked from `from` as `walk` does, until it is back where the old one was: past the change, the
    /// same item after the same item at the same cost so far (and the same place in line, where a formula reads it). From
    /// there on it is the old walk, so its score is the old one's rest added on.
    fn rewalk(
        &mut self,
        k: usize,
        seq: &[usize],
        from: usize,
        mut acc: Acc,
        old: (&[usize], &[Acc], Score),
    ) -> Result<Score, V> {
        let (old_seq, old_marks, old_score) = old;
        let same_tail = seq.iter().rev().zip(old_seq.iter().rev()).take_while(|(a, b)| a == b).count();
        let shift = old_seq.len() as isize - seq.len() as isize;
        for p in from..seq.len() {
            let q = (p as isize + shift) as usize;
            if p > from
                && p >= seq.len() - same_tail
                && q > 0
                && seq[p - 1] == old_seq[q - 1]
                && acc.before.to_bits() == old_marks[q].before.to_bits()
                && (!self.reads_pos || p == q)
            {
                self.work += (p - from) as u64 + 1;
                let rest = old_score.total - old_marks[q].total;
                return Ok(Score { bad: acc.bad + (old_score.bad - old_marks[q].bad), total: acc.total + rest });
            }
            let leg = self.leg(k, seq, p, acc.before)?;
            let last = if p == 0 { self.begin(k) } else { Spot::Item(seq[p - 1]) };
            let total = acc.total + leg.cost + leg.penalty + self.mark(last, seq[p]);
            acc = Acc { before: leg.at, total, bad: acc.bad + u32::from(!leg.ok) };
        }
        self.walk(k, seq, seq.len(), acc, None)
    }

    fn walk(
        &mut self,
        k: usize,
        seq: &[usize],
        from: usize,
        mut acc: Acc,
        mut marks: Option<&mut Vec<Acc>>,
    ) -> Result<Score, V> {
        for p in from..seq.len() {
            if let Some(m) = marks.as_deref_mut() {
                m.push(acc);
            }
            let leg = self.leg(k, seq, p, acc.before)?;
            let last = if p == 0 { self.begin(k) } else { Spot::Item(seq[p - 1]) };
            let total = acc.total + leg.cost + leg.penalty + self.mark(last, seq[p]);
            acc = Acc { before: leg.at, total, bad: acc.bad + u32::from(!leg.ok) };
        }
        if let Some(m) = marks {
            m.push(acc);
        }
        self.work += (seq.len() - from) as u64 + 1;
        if self.back
            && let (Some(home), Some(&lastr)) = (self.start_row[k], seq.last())
        {
            acc.total += self.ask(0, k, Spot::Start(home), Spot::Item(lastr), (acc.before, 0.0, seq.len() + 1))?;
        }
        Ok(Score { bad: acc.bad, total: acc.total })
    }
}

/// A move of the item at position i of group a: to position j of group b (counted with the item taken out, when b is
/// a), trading places with the item at j of b, or reversing a's run from i through j.
#[derive(Clone, Copy)]
enum Move {
    /// The run of this many items from i, to position j of group b.
    Relocate(usize, usize, usize),
    Swap(usize, usize),
    Reverse(usize),
}

impl Move {
    fn kind(self) -> &'static str {
        match self {
            Move::Relocate(_, _, 1) => "move",
            Move::Relocate(_, _, 2) => "move 2 together",
            Move::Relocate(..) => "move 3 together",
            Move::Swap(..) => "swap",
            Move::Reverse(_) => "flip",
        }
    }
}

/// The sequences a move changes, each with its first position that differs.
fn changes(seqs: &[Vec<usize>], a: usize, i: usize, mv: Move) -> Vec<(usize, Vec<usize>, usize)> {
    let mut sa = seqs[a].clone();
    match mv {
        Move::Relocate(b, j, len) if b == a => {
            let run: Vec<usize> = sa.drain(i..i + len).collect();
            sa.splice(j..j, run);
            vec![(a, sa, i.min(j))]
        }
        Move::Relocate(b, j, len) => {
            let run: Vec<usize> = sa.drain(i..i + len).collect();
            let mut sb = seqs[b].clone();
            sb.splice(j..j, run);
            vec![(a, sa, i), (b, sb, j)]
        }
        Move::Swap(b, j) if b == a => {
            sa.swap(i, j);
            vec![(a, sa, i.min(j))]
        }
        Move::Swap(b, j) => {
            let mut sb = seqs[b].clone();
            std::mem::swap(&mut sa[i], &mut sb[j]);
            vec![(a, sa, i), (b, sb, j)]
        }
        Move::Reverse(j) => {
            sa[i..=j].reverse();
            vec![(a, sa, i)]
        }
    }
}

fn build(seqs: &[Vec<usize>], a: usize, i: usize, mv: Move) -> Vec<(usize, Vec<usize>)> {
    changes(seqs, a, i, mv).into_iter().map(|(k, s, _)| (k, s)).collect()
}

/// A change in refusals and in the total, compared refusals first.
type Delta = (i64, f64);

fn plus(x: Delta, y: Delta) -> Delta {
    (x.0 + y.0, x.1 + y.1)
}

fn minus(x: Delta, y: Delta) -> Delta {
    (x.0 - y.0, x.1 - y.1)
}

/// Whether `d` lowers the plan, and by more than `best` does.
fn better(d: Delta, best: Option<Delta>, scale: f64) -> bool {
    let lowers = d.0 < 0 || (d.0 == 0 && d.1 < -1e-9 * scale.abs().max(1.0));
    lowers && best.is_none_or(|b| d.0 < b.0 || (d.0 == b.0 && d.1 < b.1))
}

/// A search under way: each group's sequence, its walk position by position, its score, which items still look for a
/// move, the passes left, and whether the work limit stopped it.
struct Search {
    seqs: Vec<Vec<usize>>,
    marks: Vec<Vec<Acc>>,
    scores: Vec<Score>,
    active: Vec<bool>,
    passes: usize,
    stopped: bool,
}

/// Passes until one changes nothing (each item that finds no move goes quiet until a link beside it changes), a pass
/// costing one of the passes left. Each move made is written down while no marks are on.
fn descend(
    m: &mut Model,
    st: &mut Search,
    links: bool,
    across: bool,
    history: &mut Vec<(&str, Score)>,
) -> Result<(), V> {
    let total = |scores: &[Score]| scores.iter().fold(Score { bad: 0, total: 0.0 }, |a, s| a.add(*s));
    while st.passes > 0 {
        st.passes -= 1;
        let mut changed = false;
        for a in 0..st.seqs.len() {
            let mut i = 0;
            while i < st.seqs[a].len() {
                if m.work > MAX_WORK {
                    st.stopped = true;
                    return Ok(());
                }
                let row = st.seqs[a][i];
                if !st.active[row] {
                    i += 1;
                    continue;
                }
                let found = if links {
                    m.best_by_links(&st.seqs, a, i, across)?
                } else {
                    m.best_by_walks(&st.seqs, &st.marks, &st.scores, a, i, across)?
                };
                let Some(mv) = found else {
                    st.active[row] = false;
                    i += 1;
                    continue;
                };
                for (k, seq) in build(&st.seqs, a, i, mv) {
                    // Every item whose neighbor changed looks again.
                    let old = &st.seqs[k];
                    let next_of = |q: &[usize]| -> HashMap<usize, (Option<usize>, Option<usize>)> {
                        q.iter()
                            .enumerate()
                            .map(|(p, &r)| (r, (p.checked_sub(1).map(|x| q[x]), q.get(p + 1).copied())))
                            .collect()
                    };
                    let before = next_of(old);
                    for (r, around) in next_of(&seq) {
                        if before.get(&r) != Some(&around) {
                            st.active[r] = true;
                        }
                    }
                    let mut mk = Vec::new();
                    st.scores[k] = m.walk(k, &seq, 0, Acc::default(), Some(&mut mk))?;
                    st.marks[k] = mk;
                    st.seqs[k] = seq;
                }
                if m.lambda == 0.0 {
                    history.push((mv.kind(), total(&st.scores)));
                }
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    Ok(())
}

fn local_search(c: &mut Call) -> Answer {
    let out = |c: &mut Call, plan: Cv, total: V, history: Cv| {
        c.show("cachedResult", plan.clone());
        c.show("cachedTotal", total.clone());
        c.show("cachedHistory", history.clone());
        Ok(vec![("plan".into(), plan), ("total".into(), Cv::from(total)), ("history".into(), history)])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), e.clone(), Cv::V(e));
    let Some(f) = frame_in(c, "items") else { return out(c, Cv::NULL, V::Null, Cv::NULL) };
    let start = frame_in(c, "start");
    let group_name = match trimmed(&str_input(c, "group", ""), "The group column") {
        Ok(g) => g,
        Err(e) => return fail(c, e),
    };
    let cost_col = match trimmed(&str_input(c, "costColumn", ""), "The cost column") {
        Ok(n) if n.is_empty() => None,
        Ok(n) => match position(&f, &n) {
            Some(i) => Some((i, n)),
            None => return fail(c, err(ErrorCode::Ref, format!("The items have no cost column \"{n}\""))),
        },
        Err(e) => return fail(c, e),
    };
    let cost_col_m = cost_col.as_ref().map_or_else(Measure::none, |(i, _)| Measure::of_column(&f.columns[*i]));
    let across = c.field_str("reach", "across") == "across";
    let back = c.field_str("ends", "open") == "return";
    let guided = c.field_str("stuck", "stop") == "look";
    let passes = match setting(c, "passes", 0.0) {
        Ok(p) => p.unwrap_or(MAX_PASSES).min(MAX_PASSES).floor() as usize,
        Err(e) => return fail(c, e),
    };
    let gi = if group_name.is_empty() {
        None
    } else {
        match position(&f, &group_name) {
            Some(i) => Some(i),
            None => return fail(c, err(ErrorCode::Ref, format!("The items have no group column \"{group_name}\""))),
        }
    };
    let start_group = match (&start, gi) {
        (Some(s), Some(_)) => match position(s, &group_name) {
            Some(j) => Some(j),
            None => return fail(c, err(ErrorCode::Ref, format!("Start has no group column \"{group_name}\""))),
        },
        _ => None,
    };

    let mut vars: Vec<String> = f.columns.iter().map(|c| c.name.clone()).collect();
    vars.extend(f.columns.iter().map(|c| format!("last_{}", c.name)));
    if let Some(s) = start.as_deref() {
        vars.extend(s.columns.iter().map(|c| format!("group_{}", c.name)));
    }
    vars.extend(["before", "at", "position"].map(String::from));
    let [before_i, at_i, pos_i] = [vars.len() - 3, vars.len() - 2, vars.len() - 1];
    let var_refs: Vec<&str> = vars.iter().map(String::as_str).collect();
    let bodies = (|| -> Result<_, crate::error_value::SolError> {
        Ok((
            wired_lambda(c, "cost", &var_refs)?,
            wired_lambda(c, "penalty", &var_refs)?,
            wired_lambda(c, "allowed", &var_refs)?,
        ))
    })();
    let (cost, penalty, allow) = match bodies {
        Ok(b) => b,
        Err(e) => return fail(c, V::Err(e.into())),
    };
    if cost.as_ref().is_some_and(|b| b.reads(at_i)) {
        return fail(
            c,
            err(
                ErrorCode::Value,
                "Cost can't use at: at is the cost so far including this item, so it depends on Cost itself",
            ),
        );
    }
    let moves = |b: &Option<Body>| b.as_ref().is_some_and(|b| b.reads(before_i) || b.reads(at_i) || b.reads(pos_i));

    // The groups: Start's rows first, then each new name among the items, the items in their row order.
    let mut groups: Vec<String> = Vec::new();
    let mut group_at: HashMap<String, usize> = HashMap::new();
    let mut start_row: Vec<Option<usize>> = Vec::new();
    let mut add_group = |g: String, groups: &mut Vec<String>, start_row: &mut Vec<Option<usize>>| -> usize {
        *group_at.entry(key(&g)).or_insert_with(|| {
            groups.push(g);
            start_row.push(None);
            groups.len() - 1
        })
    };
    if let Some(s) = start.as_deref() {
        match start_group {
            Some(j) => {
                for r in 0..s.columns[j].values.len() {
                    let g = text(s.columns[j].values.get(r));
                    if !g.is_empty() {
                        let k = add_group(g, &mut groups, &mut start_row);
                        start_row[k].get_or_insert(r);
                    }
                }
            }
            None if s.columns.first().is_some_and(|c| !c.values.is_empty()) => {
                let k = add_group(String::new(), &mut groups, &mut start_row);
                start_row[k] = Some(0);
            }
            None => {}
        }
    }
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let mut seqs: Vec<Vec<usize>> = vec![Vec::new(); groups.len()];
    for r in 0..rows {
        let g = gi.map_or_else(String::new, |i| text(f.columns[i].values.get(r)));
        let k = add_group(g, &mut groups, &mut start_row);
        if seqs.len() <= k {
            seqs.resize(k + 1, Vec::new());
        }
        seqs[k].push(r);
    }
    let gcount = groups.len();

    let mut m = Model {
        items: &f,
        start: start.as_deref(),
        start_cols: f.columns.iter().map(|col| start.as_deref().and_then(|s| position(s, &col.name))).collect(),
        start_row,
        moving: [moves(&cost), moves(&penalty), moves(&allow)],
        cost,
        penalty,
        allow,
        back,
        cost_col,
        ev: Eval::default(),
        memo: Default::default(),
        placed: Default::default(),
        work: 0,
        scale: 0.0,
        lambda: 0.0,
        marked: HashMap::new(),
        reads_pos: false,
    };
    m.reads_pos = [&m.cost, &m.penalty, &m.allow].iter().any(|b| b.as_ref().is_some_and(|b| b.reads(pos_i)));

    // Each group's walk, position by position, so a move walks only from where it changes a sequence.
    let mut marks: Vec<Vec<Acc>> = Vec::with_capacity(gcount);
    let mut scores: Vec<Score> = Vec::with_capacity(gcount);
    for k in 0..gcount {
        let mut mk = Vec::new();
        match m.walk(k, &seqs[k], 0, Acc::default(), Some(&mut mk)) {
            Ok(s) => scores.push(s),
            Err(e) => return fail(c, e),
        }
        marks.push(mk);
    }
    let sum = |scores: &[Score]| scores.iter().fold(Score { bad: 0, total: 0.0 }, |a, s| a.add(*s));
    let mut history: Vec<(&str, Score)> = vec![("start", sum(&scores))];
    m.scale = sum(&scores).total;

    // A pass takes each item in turn and makes the best of its moves that lowers the answer: move it, or a run of up to
    // three from it, to another place in its group or another's (relocate, Or-opt), trade places with another item
    // (swap), or reverse the run from it to a later item of its group (2-opt). An item that finds no move is passed over
    // until a link beside it changes (don't-look bits); passes repeat until none changes anything. When no formula reads
    // before, at or position, an item's figures depend only on the item before it, so a move is scored by the few links
    // it changes; otherwise by walking each changed sequence from where it changes.
    let links = !m.moving.iter().any(|&x| x);
    let mut st = Search { seqs, marks, scores, active: vec![true; rows], passes, stopped: false };
    let truth = |m: &mut Model, seqs: &[Vec<usize>]| -> Result<Score, V> {
        let lambda = std::mem::replace(&mut m.lambda, 0.0);
        let mut t = Score { bad: 0, total: 0.0 };
        for (k, seq) in seqs.iter().enumerate() {
            t = t.add(m.walk(k, seq, 0, Acc::default(), None)?);
        }
        m.lambda = lambda;
        Ok(t)
    };
    if let Err(e) = descend(&mut m, &mut st, links, across, &mut history) {
        return fail(c, e);
    }
    // Guided local search (Voudouris & Tsang): at a dead end, mark the links of the plan whose cost is highest for
    // the marks they already carry, so the moves see them as dearer and leave them, and search on, keeping the best plan
    // found. It stops once DRY dead ends in a row find nothing better, at Rounds, or at the work limit.
    if guided {
        let mut best = (sum(&st.scores), st.seqs.clone());
        let mut dry = 0;
        // Looking past dead ends may take at most GUIDED times the work the plain search took (and some floor for a
        // plan it finished at once), so the extra time stays a known share of the first.
        let until = m.work + (m.work * GUIDED).max(GUIDED_FLOOR);
        while !st.stopped && st.passes > 0 && dry < DRY && m.work < until {
            let mut worth: Vec<((Spot, usize), f64)> = Vec::new();
            for (k, seq) in st.seqs.iter().enumerate() {
                for p in 0..seq.len() {
                    let last = if p == 0 { m.begin(k) } else { Spot::Item(seq[p - 1]) };
                    let leg = match m.leg(k, seq, p, st.marks[k][p].before) {
                        Ok(l) => l,
                        Err(e) => return fail(c, e),
                    };
                    let marks = f64::from(m.marked.get(&(last, seq[p])).copied().unwrap_or(0));
                    worth.push(((last, seq[p]), (leg.cost + leg.penalty) / (1.0 + marks)));
                }
            }
            let top = worth.iter().map(|w| w.1).fold(0.0, f64::max);
            if top <= 0.0 {
                break;
            }
            if m.lambda == 0.0 {
                m.lambda = LAMBDA * best.0.total.max(top) / worth.len().max(1) as f64;
            }
            for (link, _) in worth.into_iter().filter(|w| w.1 == top) {
                *m.marked.entry(link).or_insert(0) += 1;
                for r in [Some(link.1), if let Spot::Item(r) = link.0 { Some(r) } else { None }].into_iter().flatten() {
                    st.active[r] = true;
                }
            }
            for k in 0..gcount {
                let mut mk = Vec::new();
                match m.walk(k, &st.seqs[k], 0, Acc::default(), Some(&mut mk)) {
                    Ok(s) => st.scores[k] = s,
                    Err(e) => return fail(c, e),
                }
                st.marks[k] = mk;
            }
            if let Err(e) = descend(&mut m, &mut st, links, across, &mut history) {
                return fail(c, e);
            }
            let now = match truth(&mut m, &st.seqs) {
                Ok(t) => t,
                Err(e) => return fail(c, e),
            };
            if now.bad < best.0.bad
                || (now.bad == best.0.bad && now.total < best.0.total - 1e-9 * best.0.total.abs().max(1.0))
            {
                best = (now, st.seqs.clone());
                history.push(("kept looking", now));
                dry = 0;
            } else {
                dry += 1;
            }
        }
        m.lambda = 0.0;
        st.seqs = best.1;
        st.scores = vec![Score { bad: 0, total: 0.0 }; gcount];
        for k in 0..gcount {
            match m.walk(k, &st.seqs[k], 0, Acc::default(), None) {
                Ok(s) => st.scores[k] = s,
                Err(e) => return fail(c, e),
            }
        }
    }
    if st.stopped {
        history.push(("time limit", sum(&st.scores)));
    }
    let (seqs, scores) = (st.seqs, st.scores);

    // The plan: each group's items in sequence, in group order, with their figures.
    let base = Frame {
        columns: f.columns.iter().filter(|c| !ADDED.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let mut order: Vec<usize> = Vec::with_capacity(rows);
    let mut owner: Vec<usize> = Vec::with_capacity(rows);
    let mut legs: Vec<(usize, Leg)> = Vec::with_capacity(rows);
    for (k, seq) in seqs.iter().enumerate() {
        let mut before = 0.0;
        for p in 0..seq.len() {
            let leg = match m.leg(k, seq, p, before) {
                Ok(l) => l,
                Err(e) => return fail(c, e),
            };
            before = leg.at;
            order.push(seq[p]);
            owner.push(k);
            legs.push((p + 1, leg));
        }
    }
    let mut cols = taken(&base, &order);
    if let Some(gc) = cols.iter_mut().find(|c| gi.is_some() && key(&c.name) == key(&group_name)) {
        gc.values = owner.iter().map(|&k| V::str(&groups[k])).collect();
    }
    let column =
        |name: &str, f: &dyn Fn(&(usize, Leg)) -> f64| num_column(name, legs.iter().map(|l| V::Num(f(l))).collect());
    cols.push(column("Position", &|l| l.0 as f64));
    // The plan's costs, running sums and penalties carry the Cost column's unit; a formula's plain number is read in it.
    let cost_m = cost_col_m;
    cols.push(cost_m.column("Cost", legs.iter().map(|l| Some(cost_m.base(l.1.cost)))));
    cols.push(cost_m.column("So Far", legs.iter().map(|l| Some(cost_m.base(l.1.at)))));
    cols.push(cost_m.column("Penalty", legs.iter().map(|l| Some(cost_m.base(l.1.penalty)))));
    cols.push(Column {
        name: "Allowed".into(),
        ty: FrameColType::Logical,
        values: legs.iter().map(|l| V::Bool(l.1.ok)).collect(),
        unit: None,
        format: None,
        raw: None,
    });
    let total = sum(&scores).total;
    let hist = vec![
        num_column("Change", (0..history.len()).map(|i| V::Num(i as f64)).collect()),
        Column {
            name: "Kind".into(),
            ty: FrameColType::String,
            values: history.iter().map(|h| V::str(h.0)).collect(),
            unit: None,
            format: None,
            raw: None,
        },
        cost_m.column("Total", history.iter().map(|h| Some(cost_m.base(h.1.total)))),
        num_column("Not Allowed", history.iter().map(|h| V::Num(f64::from(h.1.bad))).collect()),
    ];
    out(c, frame_v(cols), cost_m.value(cost_m.base(total)), frame_v(hist))
}

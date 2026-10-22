// [[C122]] choiceLadder, [[D99]] rustIsSpec
//! Port of `ladderOps.ts` (the ladder's branch and bound) and `frameVerbs.ts`' `choiceLadder` (the card's reading of
//! its tables). The search order, tie-breaks and budget are the TS's, so a search that runs out runs out here too.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use crate::decision::{self, sort_by_num, Normalize};
use crate::error_value::{sol_error, SolError};
use crate::excel_functions::V;
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::frame_verbs::format_frame_cell;
use crate::jsnum::{js_trim, math_max, math_min, math_round, number_to_string};

type Res<T> = Result<T, SolError>;

const MAX_OPTIONS: usize = 40;
const SEARCH_BUDGET: u32 = 2_000_000;
const MAX_ENDS: usize = 6;
const EPS: f64 = 1e-9;

pub struct Opt {
    score: f64,
    costs: Vec<f64>,
    requires: Vec<usize>,
    excludes: Vec<usize>,
    must: bool,
}

#[derive(Clone, Copy)]
pub struct Resource {
    limit: Option<f64>,
    floor: Option<f64>,
}

fn is_rough(r: &Resource) -> bool {
    r.limit.is_none() && r.floor.is_none()
}

#[derive(Clone, Copy)]
struct Pri {
    tier: u8,
    p: f64,
}

fn priorities(opts: &[Opt], res: &[Resource]) -> Vec<Pri> {
    let rough: Vec<usize> = (0..res.len()).filter(|&k| is_rough(&res[k])).collect();
    let scale: Vec<f64> = rough.iter().map(|&k| opts.iter().fold(EPS, |m, o| math_max(m, o.costs[k].abs()))).collect();
    opts.iter()
        .map(|o| {
            if rough.is_empty() {
                return Pri { tier: 1, p: o.score };
            }
            let mut share = 0.0;
            for (i, &k) in rough.iter().enumerate() {
                share += o.costs[k] / scale[i];
            }
            if share <= EPS { Pri { tier: 0, p: o.score } } else { Pri { tier: 1, p: o.score / share } }
        })
        .collect()
}

fn ahead(a: Pri, b: Pri) -> bool {
    if a.tier != b.tier { a.tier < b.tier } else { a.p > b.p + EPS }
}

fn is_close(a: Pri, b: Pri, gap: f64) -> bool {
    if a.tier != b.tier {
        return false;
    }
    let hi = math_max(a.p.abs(), b.p.abs());
    hi <= EPS || (a.p - b.p).abs() / hi <= gap + EPS
}

fn fits(o: &Opt, left: &[Option<f64>]) -> bool {
    o.costs.iter().enumerate().all(|(r, &c)| match left.get(r).copied().flatten() {
        None => true,
        Some(l) => c <= l + EPS,
    })
}

fn spend(left: &[Option<f64>], o: &Opt) -> Vec<Option<f64>> {
    left.iter().enumerate().map(|(r, l)| l.map(|l| l - o.costs[r])).collect()
}

fn meet(need: &[f64], o: &Opt) -> Vec<f64> {
    need.iter().enumerate().map(|(r, &x)| math_max(0.0, x - o.costs[r])).collect()
}

fn clash(opts: &[Opt], i: usize, taken: impl IntoIterator<Item = usize>) -> bool {
    taken.into_iter().any(|t| opts[i].excludes.contains(&t) || opts[t].excludes.contains(&i))
}

fn with(xs: &[usize], x: usize) -> Vec<usize> {
    let mut v = xs.to_vec();
    v.push(x);
    v
}

/// `bestPlan`: null (None) when no plan meets the floors.
fn best_plan(opts: &[Opt], open: &[usize], taken: &[usize], left: &[Option<f64>], need: &[f64], exact: bool) -> Res<Option<Vec<usize>>> {
    let countable = exact || need.iter().any(|&x| x > EPS) || left.iter().any(|l| l.is_some());
    if !countable {
        let mut banned: HashSet<usize> = HashSet::new();
        loop {
            let mut ids: Vec<usize> = Vec::new();
            for &o in open {
                if banned.contains(&o) || ids.contains(&o) || opts[o].score < 0.0 {
                    continue;
                }
                let mut group: Vec<usize> = Vec::new();
                pull(opts, o, &mut group, &ids, taken, open, &banned);
                let worth = group.iter().fold(0.0, |s, &g| s + opts[g].score);
                if worth < 0.0 {
                    continue;
                }
                let ok = group.iter().enumerate().all(|(k, &g)| !clash(opts, g, taken.iter().chain(ids.iter()).chain(group[..k].iter()).copied()));
                if ok {
                    ids.extend(group);
                }
            }
            let have: HashSet<usize> = taken.iter().chain(ids.iter()).copied().collect();
            let unmet: Vec<usize> = ids.iter().copied().filter(|&i| opts[i].requires.iter().any(|r| !have.contains(r))).collect();
            if unmet.is_empty() {
                return Ok(Some(open.iter().copied().filter(|o| ids.contains(o)).collect()));
            }
            banned.extend(unmet);
        }
    }
    let n = open.len();
    let mut tail = vec![0.0; n + 1];
    for i in (0..n).rev() {
        tail[i] = tail[i + 1] + math_max(0.0, opts[open[i]].score);
    }
    let need0: Vec<f64> = if need.is_empty() { vec![0.0; left.len()] } else { need.to_vec() };
    let reach: Vec<Vec<f64>> = (0..need0.len())
        .map(|r| {
            let mut t = vec![0.0; n + 1];
            for i in (0..n).rev() {
                t[i] = t[i + 1] + math_max(0.0, opts[open[i]].costs[r]);
            }
            t
        })
        .collect();
    let capped: Vec<usize> = (0..left.len()).filter(|&r| left[r].is_some()).collect();
    let by_ratio: Vec<Vec<usize>> = capped
        .iter()
        .map(|&r| {
            let mut ks: Vec<usize> = (0..n).filter(|&k| opts[open[k]].score > 0.0).collect();
            let ratio = |k: usize| opts[open[k]].score / math_max(EPS, opts[open[k]].costs[r]);
            sort_by_num(&mut ks, |&x, &y| ratio(y) - ratio(x));
            ks
        })
        .collect();
    let mut s = Search { opts, open, taken, have: taken.iter().copied().collect(), tail, reach, capped, by_ratio, best: None, ids: Vec::new(), visits: 0 };
    s.dfs(0, left.to_vec(), need0, 0.0)?;
    Ok(s.best.map(|b| b.1))
}

fn pull(opts: &[Opt], i: usize, group: &mut Vec<usize>, ids: &[usize], taken: &[usize], open: &[usize], banned: &HashSet<usize>) {
    if group.contains(&i) || ids.contains(&i) || taken.contains(&i) {
        return;
    }
    group.push(i);
    for &r in &opts[i].requires {
        if open.contains(&r) && !banned.contains(&r) {
            pull(opts, r, group, ids, taken, open, banned);
        }
    }
}

struct Search<'a> {
    opts: &'a [Opt],
    open: &'a [usize],
    taken: &'a [usize],
    have: HashSet<usize>,
    tail: Vec<f64>,
    reach: Vec<Vec<f64>>,
    capped: Vec<usize>,
    by_ratio: Vec<Vec<usize>>,
    best: Option<(f64, Vec<usize>)>,
    ids: Vec<usize>,
    visits: u32,
}

impl Search<'_> {
    fn bound(&self, i: usize, l: &[Option<f64>]) -> f64 {
        let mut b = self.tail[i];
        for (ci, &r) in self.capped.iter().enumerate() {
            let mut room = l[r].unwrap_or(0.0);
            let mut sum = 0.0;
            for &k in &self.by_ratio[ci] {
                if k < i {
                    continue;
                }
                let o = &self.opts[self.open[k]];
                let c = o.costs[r];
                if c <= EPS {
                    sum += o.score;
                    continue;
                }
                if room <= EPS {
                    continue;
                }
                let f = math_min(1.0, room / c);
                sum += o.score * f;
                room -= c * f;
            }
            b = math_min(b, sum);
        }
        b
    }

    fn valid(&self) -> bool {
        self.ids.iter().all(|&i| self.opts[i].requires.iter().all(|r| self.have.contains(r) || self.ids.contains(r)))
    }

    fn dfs(&mut self, i: usize, l: Vec<Option<f64>>, nd: Vec<f64>, total: f64) -> Res<()> {
        self.visits += 1;
        if self.visits > SEARCH_BUDGET {
            return Err(sol_error("#VALUE!", "Choice Ladder: too many combinations to search; narrow the options"));
        }
        // On a tie in score the plan taking more wins, so a worthless option that fits rides along.
        let better = match &self.best {
            None => true,
            Some((bt, bids)) => total > bt + EPS || (total > bt - EPS && self.ids.len() > bids.len()),
        };
        if better && nd.iter().all(|&x| x <= EPS) && self.valid() {
            self.best = Some((total, self.ids.clone()));
        }
        if i >= self.open.len() {
            return Ok(());
        }
        if let Some((bt, _)) = &self.best {
            if total + self.bound(i, &l) < bt - EPS {
                return Ok(());
            }
        }
        if nd.iter().enumerate().any(|(r, &x)| x > self.reach[r][i] + EPS) {
            return Ok(());
        }
        let o = self.open[i];
        if self.opts[o].score >= 0.0 {
            self.take(i, o, &l, &nd, total)?;
            self.dfs(i + 1, l, nd, total)
        } else {
            self.dfs(i + 1, l.clone(), nd.clone(), total)?;
            self.take(i, o, &l, &nd, total)
        }
    }

    fn take(&mut self, i: usize, o: usize, l: &[Option<f64>], nd: &[f64], total: f64) -> Res<()> {
        let opts = self.opts;
        if !fits(&opts[o], l) || clash(opts, o, self.taken.iter().chain(self.ids.iter()).copied()) {
            return Ok(());
        }
        self.ids.push(o);
        let r = self.dfs(i + 1, spend(l, &opts[o]), meet(nd, &opts[o]), total + opts[o].score);
        self.ids.pop();
        r
    }
}

enum MustClash {
    Clash(usize, usize),
    Over(usize),
}

fn must_clash(opts: &[Opt], res: &[Resource]) -> Option<MustClash> {
    fn pull(opts: &[Opt], i: usize, need: &mut Vec<usize>) {
        if need.contains(&i) {
            return;
        }
        need.push(i);
        for &r in &opts[i].requires {
            pull(opts, r, need);
        }
    }
    let mut need = Vec::new();
    for (i, o) in opts.iter().enumerate() {
        if o.must {
            pull(opts, i, &mut need);
        }
    }
    need.sort_unstable();
    for &a in &need {
        for &b in &need {
            if a < b && clash(opts, a, [b]) {
                return Some(MustClash::Clash(a, b));
            }
        }
    }
    for (r, res) in res.iter().enumerate() {
        if let Some(lim) = res.limit {
            if need.iter().fold(0.0, |s, &i| s + opts[i].costs[r]) > lim + EPS {
                return Some(MustClash::Over(r));
            }
        }
    }
    None
}

#[derive(Clone)]
struct State {
    id: usize,
    taken: Vec<usize>,
    out: HashSet<usize>,
    left: Vec<Option<f64>>,
    need: Vec<f64>,
    share: f64,
    depth: usize,
    no_fork: bool,
    forced: bool,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Clear,
    Close,
    Chosen,
    Passed,
    Must,
    Required,
    Quota,
}

impl Kind {
    fn tag(self) -> &'static str {
        match self {
            Kind::Clear => "clear",
            Kind::Close => "close",
            Kind::Chosen => "chosen",
            Kind::Passed => "passed",
            Kind::Must => "must",
            Kind::Required => "required",
            Kind::Quota => "quota",
        }
    }

    fn text(self) -> &'static str {
        match self {
            Kind::Clear => "Clear pick",
            Kind::Close => "Close",
            Kind::Chosen => "Your pick",
            Kind::Passed => "Passed",
            Kind::Must => "Must",
            Kind::Required | Kind::Quota => "Needed",
        }
    }
}

struct Edge {
    from: usize,
    to: usize,
    pick: usize,
    share: f64,
    kind: Kind,
    struck: Vec<usize>,
    conflicts: Vec<usize>,
}

struct Ladder {
    states: Vec<State>,
    edges: Vec<Edge>,
    main: Vec<usize>,
}

fn same_set(opts: &[Opt], open: &[usize], s: &State, a: usize, b: usize, exact: bool) -> Res<bool> {
    let after = |x: usize| -> Res<HashSet<usize>> {
        let taken = with(&s.taken, x);
        let rest: Vec<usize> = open.iter().copied().filter(|&i| i != x && !clash(opts, i, taken.iter().copied())).collect();
        let mut set: HashSet<usize> = HashSet::from([x]);
        set.extend(best_plan(opts, &rest, &taken, &spend(&s.left, &opts[x]), &meet(&s.need, &opts[x]), exact)?.unwrap_or_default());
        Ok(set)
    };
    let (sa, sb) = (after(a)?, after(b)?);
    Ok(sa == sb)
}

/// `buildLadder`.
fn build_ladder(opts: &[Opt], res: &[Resource], gap: f64, chosen: &[usize]) -> Res<Ladder> {
    if opts.len() > MAX_OPTIONS {
        return Err(sol_error("#VALUE!", format!("Choice Ladder takes at most {MAX_OPTIONS} options")));
    }
    let pri = priorities(opts, res);
    let mut order: Vec<usize> = (0..opts.len()).collect();
    sort_by_num(&mut order, |&a, &b| if ahead(pri[a], pri[b]) { -1.0 } else if ahead(pri[b], pri[a]) { 1.0 } else { a as f64 - b as f64 });
    let mut rank = vec![0; opts.len()];
    for (k, &o) in order.iter().enumerate() {
        rank[o] = k;
    }

    let future_key = |taken: &[usize], out: &HashSet<usize>, left: &[Option<f64>], need: &[f64]| -> String {
        let has: HashSet<usize> = taken.iter().copied().collect();
        let open: Vec<usize> = order.iter().copied().filter(|&i| !has.contains(&i) && !out.contains(&i) && !clash(opts, i, taken.iter().copied())).collect();
        let met: String = open.iter().map(|&i| if opts[i].requires.iter().all(|r| has.contains(r) || open.contains(r)) { '1' } else { '0' }).collect();
        let num = |v: Option<f64>| v.map_or(String::new(), |v| number_to_string(math_round(v * 1e6)));
        let join = |xs: Vec<String>| xs.join(",");
        format!(
            "{}|{}|{}|{}",
            join(open.iter().map(|i| i.to_string()).collect()),
            met,
            join(left.iter().map(|&l| num(l)).collect()),
            join(need.iter().map(|&x| num(Some(x))).collect())
        )
    };
    let root = State {
        id: 0,
        taken: Vec::new(),
        out: HashSet::new(),
        left: res.iter().map(|r| r.limit).collect(),
        need: res.iter().map(|r| r.floor.unwrap_or(0.0)).collect(),
        share: 1.0,
        depth: 0,
        no_fork: false,
        forced: true,
    };
    let floored = root.need.iter().any(|&x| x > EPS);
    let exact = res.iter().any(|r| !is_rough(r));
    let mut states = vec![root];
    let mut edges: Vec<Edge> = Vec::new();
    let mut level: Vec<usize> = vec![0];
    let mut ends = 0;

    while !level.is_empty() {
        let mut next: Vec<usize> = Vec::new();
        let mut next_at: HashMap<String, usize> = HashMap::new();
        for li in 0..level.len() {
            let s = states[level[li]].clone();
            let has: HashSet<usize> = s.taken.iter().copied().collect();
            let open: Vec<usize> = order.iter().copied().filter(|&i| !has.contains(&i) && !s.out.contains(&i) && !clash(opts, i, s.taken.iter().copied())).collect();
            // Musts come before anything else, in order, and strike nothing.
            let must = order.iter().copied().find(|&i| opts[i].must && !has.contains(&i));
            let found = if must.is_some() { Some(Vec::new()) } else { best_plan(opts, &open, &s.taken, &s.left, &s.need, exact)? };
            if found.is_none() && s.forced {
                return Err(sol_error("#VALUE!", "Choice Ladder: no plan meets every At least"));
            }
            let plan: HashSet<usize> = found.unwrap_or_default().into_iter().collect();
            let Some(mut a) = must.or_else(|| order.iter().copied().find(|&i| plan.contains(&i) && !has.contains(&i))) else {
                ends += 1;
                continue;
            };
            let struck: Vec<usize> = if must.is_some() { Vec::new() } else { open.iter().copied().filter(|&i| rank[i] < rank[a] && !plan.contains(&i)).collect() };

            let mut kind = if must.is_some() { Kind::Must } else { Kind::Clear };
            if kind == Kind::Clear
                && s.need.iter().any(|&x| x > EPS)
                && !best_plan(opts, &open, &s.taken, &s.left, &[], exact)?.unwrap_or_default().contains(&a)
            {
                kind = Kind::Quota;
            }
            let needs = |i: usize| -> Option<usize> { opts[i].requires.iter().copied().filter(|r| !has.contains(r)).min_by_key(|&r| rank[r]) };
            for _ in 0..opts.len() {
                let Some(nd) = needs(a) else { break };
                a = nd;
                kind = Kind::Required;
            }

            let mut b: Option<usize> = None;
            if kind == Kind::Clear && !s.no_fork {
                let mut best_gap = f64::INFINITY;
                for &i in &open {
                    if i == a || struck.contains(&i) || needs(i).is_some() || !fits(&opts[i], &s.left) {
                        continue;
                    }
                    if !is_close(pri[a], pri[i], gap) {
                        continue;
                    }
                    if floored {
                        let t = with(&s.taken, i);
                        let rest: Vec<usize> = open.iter().copied().filter(|&k| k != i && !clash(opts, k, t.iter().copied())).collect();
                        if best_plan(opts, &rest, &t, &spend(&s.left, &opts[i]), &meet(&s.need, &opts[i]), exact)?.is_none() {
                            continue;
                        }
                    }
                    let g = (pri[a].p - pri[i].p).abs();
                    if g < best_gap - EPS {
                        best_gap = g;
                        b = Some(i);
                    }
                }
            }
            if let Some(bb) = b {
                let kept: Vec<usize> = open.iter().copied().filter(|i| !struck.contains(i)).collect();
                if same_set(opts, &kept, &s, a, bb, exact)? {
                    b = None;
                }
            }
            let last = |x: usize| chosen.iter().rposition(|&c| c == x).map_or(-1, |p| p as i64);
            let mut picks: Vec<(usize, f64, Kind)> = Vec::new();
            match b {
                Some(b) if last(a) >= 0 || last(b) >= 0 => {
                    let win = if last(b) > last(a) { b } else { a };
                    let other = if win == a { b } else { a };
                    picks.push((win, s.share, Kind::Chosen));
                    let id = states.len();
                    states.push(State { id, taken: with(&s.taken, other), share: 0.0, depth: s.depth + 1, no_fork: true, forced: false, ..s.clone() });
                    edges.push(Edge { from: s.id, to: id, pick: other, share: 0.0, kind: Kind::Passed, struck: Vec::new(), conflicts: Vec::new() });
                }
                Some(b) if ends + next.len() + (level.len() - li) < MAX_ENDS => {
                    let (pa, pb) = (math_max(EPS, opts[a].score), math_max(EPS, opts[b].score));
                    picks.push((a, (s.share * pa) / (pa + pb), Kind::Close));
                    picks.push((b, (s.share * pb) / (pa + pb), Kind::Close));
                }
                _ => picks.push((a, s.share, kind)),
            }

            for (take, share, pk_kind) in picks {
                let own: Vec<usize> = if take == a {
                    struck.iter().copied().filter(|&i| !clash(opts, i, [take])).collect()
                } else {
                    let t = with(&s.taken, take);
                    let rest: Vec<usize> = open.iter().copied().filter(|&i| i != take && !clash(opts, i, t.iter().copied())).collect();
                    let plan: HashSet<usize> =
                        best_plan(opts, &rest, &t, &spend(&s.left, &opts[take]), &meet(&s.need, &opts[take]), exact)?.unwrap_or_default().into_iter().collect();
                    open.iter().copied().filter(|&i| rank[i] < rank[take] && i != take && !plan.contains(&i) && !clash(opts, i, [take])).collect()
                };
                let ruled: Vec<usize> = open.iter().copied().filter(|&i| i != take && !own.contains(&i) && clash(opts, i, [take])).collect();
                let taken = with(&s.taken, take);
                let mut out = s.out.clone();
                out.extend(own.iter().copied());
                let left = spend(&s.left, &opts[take]);
                let need = meet(&s.need, &opts[take]);
                let key = future_key(&taken, &out, &left, &need);
                let tid = match next_at.get(&key) {
                    Some(&tid) => {
                        states[tid].out.extend(own.iter().copied());
                        states[tid].no_fork = false;
                        tid
                    }
                    None => {
                        let tid = states.len();
                        states.push(State { id: tid, taken, out, left, need, share: 0.0, depth: s.depth + 1, no_fork: pk_kind == Kind::Close, forced: s.forced && must.is_some() });
                        next_at.insert(key, tid);
                        next.push(tid);
                        tid
                    }
                };
                states[tid].share += share;
                edges.push(Edge { from: s.id, to: tid, pick: take, share, kind: pk_kind, struck: own, conflicts: ruled });
            }
        }
        level = next;
    }

    // The main line: from the top, at each fork the side with more of the flow.
    let mut main = Vec::new();
    let mut at = 0;
    loop {
        let outs: Vec<usize> = (0..edges.len()).filter(|&e| edges[e].from == at).collect();
        let Some(&first) = outs.first() else { break };
        let e = outs[1..].iter().fold(first, |x, &y| if edges[y].share > edges[x].share + EPS { y } else { x });
        main.push(e);
        at = edges[e].to;
    }
    Ok(Ladder { states, edges, main })
}

// ─── The card's reading (`choiceLadder` in frameVerbs.ts) ───────────────────────

enum Fail {
    Sol(SolError),
    /// A table the TS reads past its end on (a column longer than every scored one): left to it.
    Bail,
}

impl From<SolError> for Fail {
    fn from(e: SolError) -> Fail {
        Fail::Sol(e)
    }
}

struct LimitRow {
    name: String,
    limit: Option<f64>,
    floor: Option<f64>,
    col: usize,
}

fn crit_key(s: &str) -> String {
    decision::crit_key(s)
}

fn finite(v: &FrameCell) -> Option<f64> {
    match v {
        FrameCell::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// `ladderResources`.
fn ladder_resources(f: &FrameValue, limits: Option<&FrameValue>) -> Res<Vec<LimitRow>> {
    let Some(limits) = limits else { return Ok(Vec::new()) };
    let name_col = limits.columns.iter().find(|c| c.ty == FrameColType::String);
    let nums: Vec<&FrameColumn> = limits.columns.iter().filter(|c| c.ty == FrameColType::Number).collect();
    let named = |k: &str| nums.iter().copied().find(|c| crit_key(&c.name) == k);
    let lo_col = named("at least");
    let hi_col = named("at most").or_else(|| nums.iter().copied().find(|c| lo_col.is_none_or(|lo| !std::ptr::eq(*c, lo))));
    let Some(name_col) = name_col else { return Err(sol_error("#VALUE!", "Limits needs a text column naming each resource")) };
    let num = |c: Option<&FrameColumn>, i: usize| -> Res<Option<f64>> {
        let cell = c.map_or(&FrameCell::Null, |c| c.cell_at(i));
        if let FrameCell::Err(e) = cell {
            return Err((**e).clone());
        }
        Ok(finite(cell))
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (i, v) in name_col.values.iter().enumerate() {
        let FrameCell::Str(v) = v else { continue };
        if js_trim(v).is_empty() || seen.contains(&crit_key(v)) {
            continue;
        }
        seen.insert(crit_key(v));
        let Some(col) = f.columns.iter().position(|c| matches!(c.ty, FrameColType::Number | FrameColType::Logical) && crit_key(&c.name) == crit_key(v)) else {
            return Err(sol_error("#VALUE!", format!("Choice Ladder: no Options number column is named {}", js_trim(v))));
        };
        let limit = num(hi_col, i)?;
        let floor = num(lo_col, i)?;
        out.push(LimitRow { name: f.columns[col].name.clone(), limit, floor, col });
    }
    Ok(out)
}

fn rel_col(f: &FrameValue, ty: FrameColType, names: &[&str]) -> Option<usize> {
    f.columns.iter().position(|c| c.ty == ty && names.contains(&crit_key(&c.name).as_str()))
}

fn nums_v(xs: impl IntoIterator<Item = f64>) -> V {
    V::List(Rc::new(xs.into_iter().map(V::Num).collect()))
}

fn ids_v(xs: &[usize]) -> V {
    nums_v(xs.iter().map(|&x| x as f64))
}

fn list_v(xs: Vec<V>) -> V {
    V::List(Rc::new(xs))
}

/// The Choice Ladder: the plan along its main line, and the ladder as `ladderWire` lays it out. None leaves the call to
/// the TS.
pub fn choice_ladder(
    f: &FrameValue, wf: Option<&FrameValue>, lf: Option<&FrameValue>, normalize: Normalize, close: f64, choices: &[String],
) -> Option<Res<(FrameValue, V)>> {
    match ladder_inner(f, wf, lf, normalize, close, choices) {
        Ok(r) => Some(Ok(r)),
        Err(Fail::Sol(e)) => Some(Err(e)),
        Err(Fail::Bail) => None,
    }
}

fn ladder_inner(
    f: &FrameValue, wf: Option<&FrameValue>, lf: Option<&FrameValue>, normalize: Normalize, close: f64, choices: &[String],
) -> Result<(FrameValue, V), Fail> {
    let resources = ladder_resources(f, lf)?;
    let requires_col = rel_col(f, FrameColType::String, &["requires", "needs", "prerequisites", "depends on"]);
    let excludes_col = rel_col(f, FrameColType::String, &["excludes", "conflicts", "conflicts with"]);
    let one_of_col = rel_col(f, FrameColType::String, &["one of"]);
    let must_col = rel_col(f, FrameColType::Logical, &["must", "must have"]);
    let never_col = rel_col(f, FrameColType::Logical, &["never"]);
    let weighted = wf.map(decision::criterion_row_index).unwrap_or_default();
    let not_scored = [requires_col, excludes_col, one_of_col, must_col, never_col];
    let scoring = FrameValue {
        columns: f
            .columns
            .iter()
            .enumerate()
            .filter(|&(j, c)| !not_scored.contains(&Some(j)) && (!resources.iter().any(|r| r.col == j) || weighted.contains_key(&crit_key(&c.name))))
            .map(|(_, c)| c.clone())
            .collect(),
    };
    let resolved = decision::resolve_weights(wf, &decision::criteria_names(&scoring))?;
    let weights = resolved.weights.as_deref();

    let rows = frame_row_count(f);
    let all_labels = decision::decision_scores(&scoring, weights, normalize, &resolved.overrides)?.labels;
    let name_of = |i: usize| match all_labels.get(i) {
        None | Some(FrameCell::Null) => format!("Option {}", i + 1),
        Some(FrameCell::Str(s)) if s.is_empty() => format!("Option {}", i + 1),
        Some(v) => format_frame_cell(FrameColType::String, v),
    };
    let mut row_of: HashMap<String, usize> = HashMap::new();
    for i in 0..rows {
        row_of.entry(crit_key(&name_of(i))).or_insert(i);
    }
    let cell = |col: Option<usize>, i: usize| col.map_or(&FrameCell::Null, |c| f.columns[c].cell_at(i));
    let names_in = |col: Option<usize>, i: usize| -> Vec<usize> {
        let FrameCell::Str(v) = cell(col, i) else { return Vec::new() };
        v.split([',', ';']).filter_map(|t| row_of.get(&crit_key(t)).copied()).filter(|&k| k != i).collect()
    };
    let failed = decision::decision_screen(&scoring, resolved.bounds.as_deref());
    if failed.len() < rows {
        return Err(Fail::Bail);
    }
    let is_true = |col: Option<usize>, i: usize| matches!(cell(col, i), FrameCell::Bool(true));
    let mut out: HashSet<usize> = (0..rows).filter(|&i| !failed[i].is_empty() || is_true(never_col, i)).collect();
    let mut grew = true;
    while grew {
        grew = false;
        for i in 0..rows {
            if !out.contains(&i) && names_in(requires_col, i).iter().any(|r| out.contains(r)) {
                out.insert(i);
                grew = true;
            }
        }
    }
    for i in 0..rows {
        if !is_true(must_col, i) || !out.contains(&i) {
            continue;
        }
        let why = if is_true(never_col, i) {
            "is also marked Never".to_string()
        } else if !failed[i].is_empty() {
            format!("is ruled out by {}", failed[i].join(", "))
        } else {
            "needs an option that is ruled out".to_string()
        };
        return Err(sol_error("#VALUE!", format!("Choice Ladder: Must option {} {why}", name_of(i))).into());
    }
    let kept: Vec<usize> = (0..rows).filter(|i| !out.contains(i)).collect();
    let ds = decision::decision_scores(&decision::frame_rows(&scoring, &kept), weights, normalize, &resolved.overrides)?;

    let mut order: Vec<usize> = (0..ds.scores.len()).collect();
    sort_by_num(&mut order, |&a, &b| ds.scores[b] - ds.scores[a]);
    let row_at: Vec<usize> = order.iter().map(|&k| kept[k]).collect();
    let names: Vec<String> = row_at.iter().map(|&i| name_of(i)).collect();
    let index_of = |name: &str| names.iter().position(|n| crit_key(n) == crit_key(name));
    let listed = |col: Option<usize>, i: usize| -> Vec<usize> { names_in(col, i).iter().filter_map(|r| row_at.iter().position(|x| x == r)).collect() };
    let cost_median: Vec<f64> = resources
        .iter()
        .map(|r| {
            let c = &f.columns[r.col];
            let mut known: Vec<f64> = kept.iter().filter_map(|&i| finite(c.cell_at(i))).collect();
            known.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let mid = known.len() >> 1;
            if known.is_empty() { 0.0 } else if known.len() % 2 == 1 { known[mid] } else { (known[mid - 1] + known[mid]) / 2.0 }
        })
        .collect();
    let cost_filled = |k: usize, i: usize| {
        let c = &f.columns[resources[k].col];
        c.ty == FrameColType::Number && finite(c.cell_at(i)).is_none()
    };
    let cost_of = |k: usize, i: usize| -> Res<f64> {
        let c = &f.columns[resources[k].col];
        let v = c.cell_at(i);
        if let FrameCell::Err(e) = v {
            return Err((**e).clone());
        }
        if c.ty == FrameColType::Logical {
            return Ok(if matches!(v, FrameCell::Bool(true)) { 1.0 } else { 0.0 });
        }
        Ok(finite(v).unwrap_or(cost_median[k]))
    };
    let group_of = |i: usize| match cell(one_of_col, i) {
        FrameCell::Str(v) if !js_trim(v).is_empty() => Some(crit_key(v)),
        _ => None,
    };
    let res: Vec<Resource> = resources.iter().map(|r| Resource { limit: r.limit, floor: r.floor }).collect();
    let mut opts: Vec<Opt> = Vec::with_capacity(order.len());
    let mut values: Vec<Vec<f64>> = Vec::with_capacity(order.len());
    for (n, &k) in order.iter().enumerate() {
        let i = row_at[n];
        values.push(
            (0..ds.criteria.len())
                .map(|j| {
                    let ws = ds.weight_share[j];
                    math_max(0.0, if ws >= 0.0 { ds.contrib[j][k] } else { -ws + ds.contrib[j][k] })
                })
                .collect(),
        );
        let costs = (0..resources.len())
            .map(|r| cost_of(r, i).map(|c| if is_rough(&res[r]) { c } else { math_max(0.0, c) }))
            .collect::<Res<Vec<f64>>>()?;
        let mut excludes = listed(excludes_col, i);
        if let Some(g) = group_of(i) {
            excludes.extend(row_at.iter().enumerate().filter(|&(_, &r)| r != i && group_of(r).as_deref() == Some(g.as_str())).map(|(k, _)| k));
        }
        opts.push(Opt { score: ds.scores[k], costs, requires: listed(requires_col, i), excludes, must: is_true(must_col, i) });
    }
    match must_clash(&opts, &res) {
        Some(MustClash::Clash(a, b)) => {
            return Err(sol_error("#VALUE!", format!("Choice Ladder: Must options {} and {} exclude each other", names[a], names[b])).into())
        }
        Some(MustClash::Over(r)) => {
            return Err(sol_error("#VALUE!", format!("Choice Ladder: the Must options need more {} than its limit", resources[r].name)).into())
        }
        None => {}
    }
    for (k, r) in resources.iter().enumerate() {
        if let Some(floor) = r.floor {
            if opts.iter().fold(0.0, |s, o| s + math_max(0.0, o.costs[k])) < floor - 1e-9 {
                return Err(sol_error("#VALUE!", format!("Choice Ladder: the options can't reach {}'s At least", r.name)).into());
            }
        }
    }
    let gap = if !close.is_finite() || close < 0.0 { 0.0 } else if close >= 1.0 { close / 100.0 } else { close };
    let chosen: Vec<usize> = choices.iter().filter_map(|c| index_of(c)).collect();
    let ladder = build_ladder(&opts, &res, gap, &chosen)?;

    let path: Vec<&Edge> = ladder.main.iter().map(|&e| &ladder.edges[e]).collect();
    let num_col = |name: String, xs: Vec<f64>| FrameColumn::new(name, FrameColType::Number, xs.into_iter().map(FrameCell::Num).collect());
    let str_col = |name: String, xs: Vec<String>| FrameColumn::new(name, FrameColType::String, xs.iter().map(|s| FrameCell::str(s)).collect());
    let mut cols: Vec<FrameColumn> = vec![
        num_col("Rung".into(), (1..=path.len()).map(|k| k as f64).collect()),
        str_col(ds.label_name.clone(), path.iter().map(|e| names[e.pick].clone()).collect()),
        str_col("Choice".into(), path.iter().map(|e| e.kind.text().to_string()).collect()),
        num_col("Score".into(), path.iter().map(|e| opts[e.pick].score).collect()),
    ];
    for (k, r) in resources.iter().enumerate() {
        cols.push(num_col(r.name.clone(), path.iter().map(|e| opts[e.pick].costs[k]).collect()));
    }
    for (k, r) in resources.iter().enumerate() {
        let mut run = 0.0;
        cols.push(num_col(format!("{} so far", r.name), path.iter().map(|e| {
            run += opts[e.pick].costs[k];
            run
        }).collect()));
    }
    let score_fills = decision::filled_in(&scoring, &[]);
    let fills_of = |i: usize| -> Vec<String> {
        let mut v = score_fills[i].clone();
        for (k, r) in resources.iter().enumerate() {
            if cost_filled(k, i) && !score_fills[i].contains(&r.name) {
                v.push(r.name.clone());
            }
        }
        v
    };
    if path.iter().any(|e| !fills_of(row_at[e.pick]).is_empty()) {
        cols.push(FrameColumn::new(
            "Filled in",
            FrameColType::String,
            path.iter().map(|e| {
                let v = fills_of(row_at[e.pick]);
                if v.is_empty() { FrameCell::Null } else { FrameCell::str(&v.join(", ")) }
            }).collect(),
        ));
    }
    let headers = make_headers(&cols.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), cols.len());
    let plan = FrameValue { columns: cols.into_iter().zip(headers).map(|(c, name)| FrameColumn { name, ..c }).collect() };

    let settled: HashSet<&str> = ladder.edges.iter().filter(|e| e.kind == Kind::Chosen).map(|e| names[e.pick].as_str()).collect();
    let mut ruled_out: Vec<usize> = out.into_iter().collect();
    ruled_out.sort_unstable();
    let wire = list_v(vec![
        list_v(opts.iter().enumerate().map(|(k, o)| list_v(vec![V::str(&names[k]), V::Num(o.score), nums_v(o.costs.iter().copied()), nums_v(values[k].iter().copied())])).collect()),
        list_v(ds.criteria.iter().map(|c| V::str(c)).collect()),
        list_v(resources.iter().map(|r| {
            let opt = |x: Option<f64>| x.map_or(V::Null, V::Num);
            list_v(vec![V::str(&r.name), opt(r.limit), opt(r.floor), V::Bool(f.columns[r.col].ty == FrameColType::Logical)])
        }).collect()),
        list_v(ladder.states.iter().map(|s| {
            let end = !ladder.edges.iter().any(|e| e.from == s.id);
            list_v(vec![V::Num(s.id as f64), V::Num(s.depth as f64), V::Num(s.share), ids_v(&s.taken), V::Bool(end)])
        }).collect()),
        list_v(ladder.edges.iter().map(|e| list_v(vec![
            V::Num(e.from as f64), V::Num(e.to as f64), V::Num(e.pick as f64), V::Num(e.share), V::str(e.kind.tag()), ids_v(&e.struck), ids_v(&e.conflicts),
        ])).collect()),
        ids_v(&ladder.main),
        list_v(choices.iter().filter(|c| settled.contains(index_of(c).map_or("", |k| names[k].as_str()))).map(|c| V::str(c)).collect()),
        list_v(ruled_out.iter().map(|&i| V::str(&name_of(i))).collect()),
    ]);
    Ok((plan, wire))
}

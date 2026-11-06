//! [[C130]] rustCore, [[B11]] maximalMerge, [[C17]] shareImpl.
//! The stats cards' bodies: order statistics, correlation and regression, the hypothesis tests, interpolation and the
//! fits, most sharing their kernel with a formula function.

use super::kit::{broadcast_err, core_call, num};
use super::Cv;
use super::{err, list, Answer, Call};
use crate::dists::{ln_combin, regularized_gamma, std_norm_cdf};
use crate::error_value::ErrorCode;
use crate::excel_functions::{num_blank_zero, V};
use crate::jsnum::round_half_up;
use libm::{exp, log};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "RankPercentileNode" => rank_percentile(c),
        "DistributionsNode" => distributions(c),
        "CorrelNode" => correl(c),
        "StandardizeNode" => standardize(c),
        "FisherNode" => fisher(c),
        "ForecastNode" => forecast(c),
        "ModeNode" => mode(c),
        "TrimMeanNode" => trim_mean(c),
        "FrequencyNode" => frequency(c),
        "ConfidenceNode" => confidence(c),
        "HypothesisTestNode" => hypothesis_test(c),
        "InterpolateNode" => interpolate(c),
        "LinestNode" => linest(c),
        "BinomDistRangeNode" => binom_dist_range(c),
        "ProbNode" => prob(c),
        _ => return None,
    })
}

// ─── What the bodies share ─────────────────────────────────────────────────────

/// `inputs[key]?.[0] ?? null`.
pub(crate) fn first(c: &Call, key: &str) -> V {
    c.value_of(key, &c.read_card(key))
}

/// `inputs[key]?.[0]`: `undefined` with no cable or an empty one.
pub(crate) fn first_raw(c: &Call, key: &str) -> V {
    c.value_of(key, &c.raw_card(key))
}

/// `x == null`.
pub(crate) fn nullish(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

/// Blank: nothing wired or typed, or empty text. A 0 or a FALSE is a value.
pub(crate) fn blank(v: &V) -> bool {
    matches!(v, V::Null | V::Undef) || matches!(v, V::Str(s) if s.is_empty())
}

/// Blank, or an empty list.
pub(crate) fn no_list(v: &V) -> bool {
    blank(v) || matches!(v, V::List(l) if l.is_empty())
}

pub(crate) fn items(v: &V) -> &[V] {
    match v {
        V::List(l) => l.as_slice(),
        _ => &[],
    }
}

/// JS `+v`.
pub(crate) fn js_num(v: &V) -> f64 {
    num_blank_zero(v)
}

/// `Number.isFinite(v)`, which doesn't coerce.
pub(crate) fn finite_num(v: &V) -> Option<f64> {
    match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// What a blank means for a card input ([[D86]] blankRoles), as `inputRoles.ts` declares it.
pub(crate) enum Role {
    /// A blank reads as this (`Undef` for the function's own default).
    Setting(V),
    Required,
}

/// Unwired, the typed literal; wired, the cable's; a blank as the role reads it.
pub(crate) fn read_role(c: &Call, key: &str, role: Role) -> V {
    let literal = c.unwired(key);
    let v = match c.wired(key) {
        None | Some([]) => literal,
        Some([first, ..]) => first.clone(),
    };
    let v = if matches!(v, V::Undef) { V::Null } else { v };
    if v.is_sol_error() {
        return v;
    }
    fn fill(v: &V, blank: &V) -> V {
        match v {
            V::List(l) => list(l.iter().map(|x| fill(x, blank)).collect()),
            V::Null | V::Undef => blank.clone(),
            other => other.clone(),
        }
    }
    fn required(v: &V, label: &str) -> V {
        match v {
            V::Err(_) => v.clone(),
            V::List(l) => list(l.iter().map(|x| required(x, label)).collect()),
            V::Null | V::Undef => err(ErrorCode::Syntax, format!("{label} is blank, and it has no default")),
            other => other.clone(),
        }
    }
    match role {
        Role::Setting(blank) => fill(&v, &blank),
        Role::Required => required(&v, &c.label(key)),
    }
}

/// `x ?? dflt`.
pub(crate) fn or(v: V, dflt: V) -> V {
    if nullish(&v) {
        dflt
    } else {
        v
    }
}

/// The first error, else the number cells.
fn for_aggregate(v: &V) -> Result<Vec<V>, V> {
    let xs = items(v);
    if let Some(e) = xs.iter().find(|x| x.is_sol_error()) {
        return Err(e.clone());
    }
    Ok(xs.iter().filter(|x| matches!(x, V::Num(_))).cloned().collect())
}

/// The first error in either list, else the pairs with neither side blank, the tail cut to the shorter.
fn pair_present(x: &V, y: &V) -> Result<(V, V), V> {
    let (xs, ys) = (items(x), items(y));
    if let Some(e) = xs.iter().chain(ys.iter()).find(|v| v.is_sol_error()) {
        return Err(e.clone());
    }
    let (mut ox, mut oy) = (Vec::new(), Vec::new());
    for (a, b) in xs.iter().zip(ys.iter()) {
        if matches!(a, V::Null) || matches!(b, V::Null) {
            continue;
        }
        ox.push(a.clone());
        oy.push(b.clone());
    }
    Ok((list(ox), list(oy)))
}

fn len(v: &V) -> usize {
    items(v).len()
}

/// One output, `result`, shown on the card as `cachedResult`.
fn answer(c: &mut Call, result: V) -> Answer {
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), Cv::from(result))])
}

/// Values in numeric order (as `js_num` reads them), NaN last.
pub(crate) fn sort_numeric(v: &mut Vec<V>) {
    crate::sort::stable_sort_by(v, |a, b| crate::sort::num_order(js_num(a), js_num(b)));
}

// ─── Order statistics ──────────────────────────────────────────────────────────

fn rank_percentile(c: &mut Call) -> Answer {
    let op = c.field_str("op", "large").to_string();
    let exc = op.ends_with("-exc");
    let family = match op.as_str() {
        "large" | "small" => "nth",
        "rank-eq" | "rank-avg" => "rank",
        "percentile-inc" | "percentile-exc" => "percentile",
        "quartile-inc" | "quartile-exc" => "quartile",
        _ => "percentrank",
    };
    if family == "rank" || family == "percentrank" {
        let arr = first(c, "list");
        let v = c.read_input("value", or(c.unwired("value"), V::Null));
        if family == "percentrank" {
            let sig = or(read_role(c, "significance", Role::Setting(V::Undef)), V::Num(3.0));
            if no_list(&arr) || matches!(v, V::Null) {
                return answer(c, V::Null);
            }
            let r = core_call(if exc { "PERCENTRANK.EXC" } else { "PERCENTRANK.INC" }, &[arr, v, sig]);
            return answer(c, r);
        }
        let order = or(read_role(c, "order", Role::Setting(V::Undef)), V::Num(0.0));
        if no_list(&arr) || matches!(v, V::Null) {
            return answer(c, V::Null);
        }
        let r = core_call(if op == "rank-avg" { "RANK.AVG" } else { "RANK.EQ" }, &[v, arr, order]);
        return answer(c, r);
    }
    let name = match family {
        "nth" if op == "large" => "LARGE",
        "nth" => "SMALL",
        "percentile" if exc => "PERCENTILE.EXC",
        "percentile" => "PERCENTILE.INC",
        _ if exc => "QUARTILE.EXC",
        _ => "QUARTILE.INC",
    };
    let raw = first(c, "list");
    let arr = match for_aggregate(&raw) {
        Ok(nums) => list(nums),
        Err(e) => return answer(c, e),
    };
    // Text in the list, after any error, answers the formula's error ([[C17]] shareImpl, [[D109]]
    // aggregatesRefuseText).
    if let Some(e) = crate::excel_functions::text_refusal(name, std::slice::from_ref(&raw)) {
        return answer(c, e);
    }
    let result = match family {
        "nth" => {
            let k = read_role(c, "k", Role::Required);
            if k.is_sol_error() {
                return answer(c, k);
            }
            core_call(name, &[arr, k])
        }
        "percentile" => {
            let p = read_role(c, "p", Role::Required);
            if p.is_sol_error() {
                return answer(c, p);
            }
            core_call(name, &[arr, p])
        }
        _ => {
            let q = read_role(c, "q", Role::Setting(V::Num(0.0)));
            core_call(name, &[arr, q])
        }
    };
    answer(c, result)
}

// ─── Two lists ─────────────────────────────────────────────────────────────────

fn correl(c: &mut Call) -> Answer {
    let op = c.field_str("op", "correl").to_string();
    let (xs, ys) = match pair_present(&first(c, "x"), &first(c, "y")) {
        Ok(p) => p,
        Err(e) => return answer(c, e),
    };
    let r = match op.as_str() {
        "covariance-p" => core_call("COVARIANCE.P", &[xs, ys]),
        "covariance-s" => core_call("COVARIANCE.S", &[xs, ys]),
        "rsq" | "slope" | "intercept" | "steyx" => core_call(&op.to_uppercase(), &[ys, xs]),
        _ => core_call(&op.to_uppercase(), &[xs, ys]),
    };
    answer(c, r)
}

fn forecast(c: &mut Call) -> Answer {
    let exponential = c.field_str("op", "linear") == "exponential";
    let (xs, ys) = match pair_present(&first(c, "xs"), &first(c, "ys")) {
        Ok(p) => p,
        Err(e) => return answer(c, e),
    };
    let q = c.read_input("x", V::Null);
    if q.is_sol_error() {
        return answer(c, q);
    }
    let mut predicted: Option<Rc<Vec<V>>> = None;
    if len(&xs) >= 2 && len(&ys) >= 2 {
        let targets: Vec<V> = match &q {
            V::List(l) => l.iter().filter(|v| !matches!(v, V::Null) && !v.is_sol_error()).cloned().collect(),
            V::Num(_) => vec![q.clone()],
            _ => Vec::new(),
        };
        let targets = if targets.is_empty() { vec![V::Num(0.0)] } else { targets };
        let r = core_call(if exponential { "GROWTH" } else { "TREND" }, &[ys, xs, list(targets)]);
        if r.is_sol_error() {
            return answer(c, r);
        }
        match r {
            V::List(l) if !l.is_empty() => predicted = Some(l),
            _ => return answer(c, err(ErrorCode::DivZero, "Known Xs have zero variance")),
        }
    }
    if let V::List(qs) = &q {
        if let Some(e) = qs.iter().find(|v| v.is_sol_error()) {
            let e = e.clone();
            return answer(c, e);
        }
        let Some(p) = predicted.filter(|_| !qs.is_empty()) else { return answer(c, list(Vec::new())) };
        let mut i = 0;
        let out = qs
            .iter()
            .map(|v| {
                if matches!(v, V::Null) {
                    V::Null
                } else {
                    i += 1;
                    p.get(i - 1).cloned().unwrap_or(V::Undef)
                }
            })
            .collect();
        return answer(c, list(out));
    }
    match predicted {
        Some(p) if !matches!(q, V::Null) => answer(c, p[0].clone()),
        _ => answer(c, V::Null),
    }
}

// ─── One list ──────────────────────────────────────────────────────────────────

fn mode(c: &mut Call) -> Answer {
    let nums = match for_aggregate(&first(c, "list")) {
        Ok(n) => n,
        Err(e) => return answer(c, e),
    };
    if nums.is_empty() {
        return answer(c, V::Null);
    }
    let r = match core_call("MODE.MULT", &[list(nums)]) {
        V::List(l) if l.len() == 1 => l[0].clone(),
        V::List(l) => {
            let mut sorted = l.as_ref().clone();
            sort_numeric(&mut sorted);
            list(sorted)
        }
        other => other,
    };
    answer(c, r)
}

fn trim_mean(c: &mut Call) -> Answer {
    let arr = first(c, "list");
    let percent = read_role(c, "percent", Role::Setting(V::Num(0.0)));
    if no_list(&arr) {
        return answer(c, V::Null);
    }
    let r = core_call("TRIMMEAN", &[arr, percent]);
    answer(c, r)
}

fn frequency(c: &mut Call) -> Answer {
    let data = first(c, "data");
    let bins = first(c, "bins");
    // The FREQUENCY formula's body, so the card and the formula agree: counts in the bins' own order, blanks and text
    // skipped.
    let result = if !blank(&data) && len(&bins) > 0 { core_call("FREQUENCY", &[data, bins]) } else { list(Vec::new()) };
    c.show("cachedList", result.clone());
    Ok(vec![("result".into(), Cv::from(result))])
}

// ─── Scalars ───────────────────────────────────────────────────────────────────

fn standardize(c: &mut Call) -> Answer {
    let v = c.read_input("value", or(c.unwired("value"), V::Null));
    let m = c.read_input("mean", or(c.unwired("mean"), V::Null));
    let s = c.read_input("stdev", or(c.unwired("stdev"), V::Null));
    let result = if [&v, &m, &s].iter().any(|x| matches!(x, V::Null)) {
        V::Null
    } else {
        broadcast_err(&[v, m, s], |o| core_call("STANDARDIZE", &[o[0].clone(), o[1].clone(), o[2].clone()]))
    };
    answer(c, result)
}

fn fisher(c: &mut Call) -> Answer {
    let op = c.field_str("op", "fisher").to_uppercase();
    let v = c.read_input("value", or(c.unwired("value"), V::Null));
    let result = if matches!(v, V::Null) { V::Null } else { broadcast_err(&[v], |o| core_call(&op, &[o[0].clone()])) };
    answer(c, result)
}

fn confidence(c: &mut Call) -> Answer {
    let t = c.field_str("op", "norm") == "t";
    let alpha = c.read("alpha");
    let stdev = c.read("stdev");
    let n_raw = c.read("n");
    if [&alpha, &stdev, &n_raw].iter().any(|x| matches!(x, V::Null)) {
        return answer(c, V::Null);
    }
    // The card is CONFIDENCE.NORM and CONFIDENCE.T, so it answers as they do, errors included ([[C17]] shareImpl).
    let result = core_call(if t { "CONFIDENCE.T" } else { "CONFIDENCE.NORM" }, &[alpha, stdev, n_raw]);
    answer(c, result)
}

fn binom_pmf(k: f64, n: f64, p: &V) -> Option<f64> {
    let pn = js_num(p);
    if matches!(p, V::Num(x) if *x == 0.0) {
        return Some(if k == 0.0 { 1.0 } else { 0.0 });
    }
    if matches!(p, V::Num(x) if *x == 1.0) {
        return Some(if k == n { 1.0 } else { 0.0 });
    }
    let r = exp(ln_combin(n, k) + k * log(pn) + (n - k) * log(1.0 - pn));
    r.is_finite().then_some(r)
}

fn binom_dist_range(c: &mut Call) -> Answer {
    let n_raw = c.read("n");
    let p = c.read("p");
    if matches!(n_raw, V::Null) || matches!(p, V::Null) {
        return answer(c, V::Null);
    }
    let n = js_num(&n_raw).floor();
    let lo_raw = c.read("lo");
    let hi_raw = c.read_input("hi", or(c.unwired("hi"), V::Num(n)));
    if matches!(lo_raw, V::Null) || matches!(hi_raw, V::Null) {
        return answer(c, V::Null);
    }
    let (lo, hi) = (js_num(&lo_raw).floor(), js_num(&hi_raw).floor());
    let pn = js_num(&p);
    let mut result = V::Null;
    if n >= 0.0 && (0.0..=1.0).contains(&pn) && lo >= 0.0 && hi >= lo && hi <= n {
        let mut sum = 0.0;
        let mut k = lo;
        while k <= hi {
            match binom_pmf(k, n, &p) {
                Some(x) => sum += x,
                None => {
                    sum = f64::NAN;
                    break;
                }
            }
            k += 1.0;
        }
        if sum.is_finite() {
            result = V::Num(crate::jsnum::nan_min(1.0, crate::jsnum::nan_max(0.0, sum)));
        }
    }
    answer(c, result)
}

fn prob(c: &mut Call) -> Answer {
    let range = first(c, "range");
    let probs = first(c, "probs");
    let lo = c.read("lo");
    let hi = c.read("hi");
    if matches!(lo, V::Null) || matches!(hi, V::Null) {
        return answer(c, V::Null);
    }
    let r = core_call("PROB", &[range, probs, lo, hi]);
    answer(c, r)
}

// ─── Hypothesis tests ──────────────────────────────────────────────────────────

/// Each column of a table, its finite numbers only.
fn groups_of(m: &V) -> Option<Vec<V>> {
    if no_list(m) {
        return None;
    }
    let rows = items(m);
    let cols = len(rows.first()?);
    Some(
        (0..cols)
            .map(|j| {
                list(rows.iter().filter_map(|r| items(r).get(j)).filter(|v| finite_num(v).is_some()).cloned().collect())
            })
            .collect(),
    )
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().fold(0.0, |a, b| a + b) / xs.len() as f64
}

fn sample_var(xs: &[f64]) -> f64 {
    let m = mean(xs);
    xs.iter().fold(0.0, |s, v| s + libm::pow(v - m, 2.0)) / (xs.len() as f64 - 1.0)
}

fn hypothesis_test(c: &mut Call) -> Answer {
    let op = c.field_str("op", "z").to_string();
    let a = first(c, "a");
    let present = |v: &V| !blank(v);
    let result = match op.as_str() {
        "anova" | "kruskal" => match groups_of(&first(c, "groups")) {
            Some(g) => core_call(if op == "anova" { "ANOVA" } else { "KRUSKAL" }, &g),
            None => V::Null,
        },
        "mannwhitney" | "wilcoxon" | "ks" => {
            let b = first(c, "b");
            if present(&a) && present(&b) {
                let name = match op.as_str() {
                    "mannwhitney" => "MANNWHITNEY",
                    "wilcoxon" => "WILCOXON",
                    _ => "KSTEST",
                };
                let mut env = crate::eval::Env::default();
                env.insert("a".into(), a);
                env.insert("b".into(), b);
                crate::eval::formula(&format!("{name}(a, b)"), env).unwrap_or(V::Null)
            } else {
                V::Null
            }
        }
        "fisher" => {
            let t = first(c, "table");
            let cell = |r: usize, k: usize| match items(&t).get(r).map(|row| items(row).get(k)) {
                Some(Some(V::Num(n))) => Some(V::Num(*n)),
                _ => None,
            };
            match (cell(0, 0), cell(0, 1), cell(1, 0), cell(1, 1)) {
                (Some(a), Some(b), Some(cc), Some(d)) => core_call("FISHEREXACT", &[a, b, cc, d]),
                _ => V::Null,
            }
        }
        "proptest" => {
            let args = [c.read("x1"), c.read("n1"), c.read("x2"), c.read("n2")];
            if args.iter().any(|v| matches!(v, V::Null)) {
                V::Null
            } else {
                core_call("PROPTEST", &args)
            }
        }
        "binomtest" => {
            let args = [c.read("k"), c.read("n"), c.read("p0")];
            if args.iter().any(|v| matches!(v, V::Null)) {
                V::Null
            } else {
                core_call("BINOMTEST", &args)
            }
        }
        "z" => {
            let x = c.read("x");
            let sigma = c.read("sigma");
            let xs: Option<Vec<f64>> = match &a {
                V::List(l) => Some(l.iter().filter_map(finite_num).collect()),
                _ => None,
            };
            let mut r = V::Null;
            if let Some(xs) = xs.filter(|xs| xs.len() >= 2)
                && !matches!(x, V::Null)
                && !matches!(sigma, V::Null)
            {
                let n = xs.len() as f64;
                let m = mean(&xs);
                let std = if !matches!(sigma, V::Undef) && js_num(&sigma) > 0.0 {
                    js_num(&sigma)
                } else {
                    sample_var(&xs).sqrt()
                };
                if std > 0.0 {
                    r = V::Num(1.0 - std_norm_cdf((m - js_num(&x)) / (std / n.sqrt())));
                }
            }
            r
        }
        "chisq" => {
            let ex = first(c, "b");
            let mut r = V::Null;
            if present(&a) && present(&ex) && len(&a) >= 2 && len(&ex) >= len(&a) {
                let (obs, exp_) = (items(&a), items(&ex));
                let n = obs.len();
                let mut chi2 = 0.0;
                for i in 0..n {
                    let e = js_num(&exp_[i]);
                    if e <= 0.0 {
                        chi2 = f64::NAN;
                        break;
                    }
                    chi2 += libm::pow(js_num(&obs[i]) - e, 2.0) / e;
                }
                if chi2.is_finite() && chi2 >= 0.0 {
                    let p = 1.0 - regularized_gamma((n as f64 - 1.0) / 2.0, chi2 / 2.0);
                    if p.is_finite() {
                        r = V::Num(p);
                    }
                }
            }
            r
        }
        _ => {
            let b = first(c, "b");
            if present(&a) && present(&b) {
                // The kernels read their lists as JS arithmetic does: a blank as 0, a logical as 0 or 1.
                let as_js = |v: &V| match v {
                    V::List(l) => list(
                        l.iter()
                            .map(|x| if matches!(x, V::Null | V::Bool(_)) { V::Num(num(x)) } else { x.clone() })
                            .collect(),
                    ),
                    other => other.clone(),
                };
                let (a, b) = (as_js(&a), as_js(&b));
                if op == "f" {
                    core_call("F.TEST", &[a, b])
                } else {
                    let ty = match op.as_str() {
                        "t-paired" => 1.0,
                        "t-equal" => 2.0,
                        _ => 3.0,
                    };
                    core_call("T.TEST", &[a, b, V::Num(2.0), V::Num(ty)])
                }
            } else {
                V::Null
            }
        }
    };
    answer(c, result)
}

// ─── Interpolate ───────────────────────────────────────────────────────────────

fn interpolate(c: &mut Call) -> Answer {
    if c.field_str("mode", "list") == "points" {
        let method = V::str(c.field_str("method", "idw"));
        let (xs, ys, zs) = (first(c, "xs"), first(c, "ys"), first(c, "zs"));
        let (gx, gy) = (c.read("gx"), c.read("gy"));
        if [&xs, &ys, &zs, &gx, &gy].iter().any(|v| nullish(v)) {
            return answer(c, V::Null);
        }
        let r = core_call("GRIDDATA", &[xs, ys, zs, gx, gy, method]);
        return answer(c, r);
    }
    if c.field_str("mode", "list") == "grid" {
        // The filled table is the z table's, its unit too.
        let r = interpolate_grid(c);
        if let (Ok(outs), Some(u)) = (&r, c.matrix_unit("z").cloned())
            && outs.iter().any(|(k, v)| k == "result" && matches!(v, Cv::V(V::List(_))))
        {
            c.set_matrix_unit("result", u);
        }
        return r;
    }
    let (xs, ys) = match pair_present(&first(c, "xs"), &first(c, "ys")) {
        Ok(p) => p,
        Err(e) => return answer(c, e),
    };
    let q = c.read("new_xs");
    if q.is_sol_error() {
        return answer(c, q);
    }
    let no_data = len(&xs) == 0;
    if let V::List(qs) = &q {
        if let Some(e) = qs.iter().find(|v| v.is_sol_error()) {
            let e = e.clone();
            return answer(c, e);
        }
        if no_data || qs.is_empty() {
            return answer(c, list(Vec::new()));
        }
        let r = core_call("INTERPOLATE", &[ys, xs, q]);
        return answer(c, r);
    }
    if matches!(q, V::Null) || no_data {
        return answer(c, V::Null);
    }
    let r = core_call("INTERPOLATE", &[ys, xs, q]);
    answer(c, r)
}

/// An axis as `grid_axes` reads it: unwired counts 1, 2, 3…, a wired blank blanks the card.
fn grid_axis(raw: &V, n: usize, name: &str) -> Option<Result<(), V>> {
    match raw {
        V::Undef => Some(Ok(())),
        V::Null => None,
        _ => {
            let one = [raw.clone()];
            let vals = if let V::List(l) = raw { l.as_slice() } else { &one[..] };
            let unit = if name == "Xs" { "columns" } else { "rows" };
            if vals.len() != n {
                return Some(Err(err(ErrorCode::Shape, format!("{name} has {} values for {n} {unit}", vals.len()))));
            }
            if vals.iter().any(|v| finite_num(v).is_none()) {
                return Some(Err(err(ErrorCode::Value, format!("{name} must be finite numbers"))));
            }
            Some(Ok(()))
        }
    }
}

fn interpolate_grid(c: &mut Call) -> Answer {
    let z = first(c, "z");
    if z.is_sol_error() {
        return answer(c, z);
    }
    let axis = |k: &str| match c.wired(k) {
        None => V::Undef,
        Some([]) => V::Null,
        Some([v, ..]) => {
            if matches!(v, V::Undef) {
                V::Null
            } else {
                v.clone()
            }
        }
    };
    let (xs, ys) = (axis("xs"), axis("ys"));
    let forecast = c.field("forecast").and_then(serde_json::Value::as_bool).unwrap_or(true);
    let rows = items(&z);
    if !matches!(xs, V::Null) && !matches!(ys, V::Null) && rows.iter().any(|r| matches!(r, V::List(_))) {
        let r = core_call("INTERPOLATE", &[z.clone(), xs, ys, V::Bool(forecast)]);
        return answer(c, r);
    }
    // Here an axis is blank, so the grid only decides between a blank card and an axis's error.
    if rows.is_empty() {
        return answer(c, V::Null);
    }
    let cols = rows.iter().map(len).max().unwrap_or(0);
    if cols == 0 {
        return answer(c, V::Null);
    }
    for (raw, n, name) in [(&xs, cols, "Xs"), (&ys, rows.len(), "Ys")] {
        match grid_axis(raw, n, name) {
            None => return answer(c, V::Null),
            Some(Err(e)) => return answer(c, e),
            Some(Ok(())) => {}
        }
    }
    answer(c, V::Null)
}

// ─── Fit ───────────────────────────────────────────────────────────────────────

/// The R² of a linear fit over the logs.
fn exp_fit_r2(xs: &[f64], ys: &[f64]) -> Option<(f64, f64, f64)> {
    let n = xs.len().min(ys.len());
    let ys = &ys[..n];
    if !ys.iter().all(|y| *y > 0.0) {
        return None;
    }
    let ly: Vec<f64> = ys.iter().map(|y| log(*y)).collect();
    if n < 2 {
        return None;
    }
    let (mut xm, mut ym) = (0.0, 0.0);
    for i in 0..n {
        xm += xs[i];
        ym += ly[i];
    }
    xm /= n as f64;
    ym /= n as f64;
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (dx, dy) = (xs[i] - xm, ly[i] - ym);
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    if sxx == 0.0 {
        return None;
    }
    let slope = sxy / sxx;
    let r2 = if sxx > 0.0 && syy > 0.0 { libm::pow(sxy / (sxx * syy).sqrt(), 2.0) } else { 0.0 };
    Some((exp(slope), exp(ym - slope * xm), r2))
}

fn linest(c: &mut Call) -> Answer {
    let exponential = c.field_str("op", "linear") == "exponential";
    let outs = |c: &mut Call, s: V, i: V, r: V| -> Answer {
        c.show("cachedSlope", s.clone());
        c.show("cachedIntercept", i.clone());
        c.show("cachedR2", r.clone());
        Ok(vec![("slope".into(), Cv::from(s)), ("intercept".into(), Cv::from(i)), ("r2".into(), Cv::from(r))])
    };
    let (xs, ys) = match pair_present(&first(c, "xs"), &first(c, "ys")) {
        Ok(p) => p,
        Err(e) => return outs(c, e.clone(), e.clone(), e),
    };
    let fit: Option<(V, V, V)> = if exponential {
        let (xn, yn): (Vec<f64>, Vec<f64>) =
            (items(&xs).iter().map(js_num).collect(), items(&ys).iter().map(js_num).collect());
        let e = exp_fit_r2(&xn, &yn);
        if e.is_none() && len(&xs) >= 2 && yn.iter().any(|y| y.is_nan() || *y <= 0.0) {
            let e = err(ErrorCode::Domain, "Exponential fit needs every y above 0 (Excel: #NUM!)");
            return outs(c, e.clone(), e.clone(), e);
        }
        e.map(|(m, b, r2)| (V::Num(m), V::Num(b), V::Num(r2)))
    } else {
        match core_call("LINEST", &[ys, xs.clone()]) {
            e @ V::Err(_) => return outs(c, e.clone(), e.clone(), e),
            V::List(l) => {
                let at = |i: usize| or(l.get(i).cloned().unwrap_or(V::Undef), V::Null);
                Some((at(0), at(1), at(2)))
            }
            other if !blank(&other) => Some((V::Null, V::Null, V::Null)),
            _ => None,
        }
    };
    match fit {
        Some((s, i, r)) => outs(c, s, i, r),
        None if len(&xs) >= 2 => {
            let e = err(ErrorCode::DivZero, "Known Xs have zero variance");
            outs(c, e.clone(), e.clone(), e)
        }
        None => outs(c, V::Null, V::Null, V::Null),
    }
}

// ─── Distributions ──────────────────────────────────────────────────────────────

/// `DIST_SPECS`' x socket and parameter sockets, by family.
fn dist_keys(op: &str) -> Option<(&'static str, &'static [&'static str])> {
    Some(match op {
        "normal" | "lognorm" => ("x", &["mean", "stdev"]),
        "normal-s" => ("z", &[]),
        "phi" | "gauss" => ("x", &[]),
        "t" | "chisq" => ("x", &["df"]),
        "f" => ("x", &["df1", "df2"]),
        "beta" | "gamma" | "weibull" => ("x", &["alpha", "beta"]),
        "expon" => ("x", &["lambda"]),
        "binom" => ("k", &["n", "p"]),
        "poisson" => ("k", &["lambda"]),
        "hypgeom" => ("k", &["n", "M", "N"]),
        "negbinom" => ("k", &["r", "p"]),
        _ => return None,
    })
}

/// `DIST_FX`: the formula functions a family's forms share with the card ([[C17]] shareImpl): dist, inv, rt.
fn dist_fx(op: &str) -> (Option<&'static str>, Option<&'static str>, Option<&'static str>) {
    match op {
        "normal" => (Some("NORM.DIST"), Some("NORM.INV"), None),
        "normal-s" => (Some("NORM.S.DIST"), Some("NORM.S.INV"), None),
        "chisq" => (Some("CHISQ.DIST"), Some("CHISQ.INV"), Some("CHISQ.DIST.RT")),
        "f" => (Some("F.DIST"), Some("F.INV"), Some("F.DIST.RT")),
        "gamma" => (Some("GAMMA.DIST"), None, None),
        "lognorm" => (Some("LOGNORM.DIST"), Some("LOGNORM.INV"), None),
        "weibull" => (Some("WEIBULL.DIST"), None, None),
        "expon" => (Some("EXPON.DIST"), None, None),
        "binom" => (Some("BINOM.DIST"), Some("BINOM.INV"), None),
        "poisson" => (Some("POISSON.DIST"), None, None),
        "hypgeom" => (Some("HYPGEOM.DIST"), None, None),
        "negbinom" => (Some("NEGBINOM.DIST"), None, None),
        _ => (None, None, None),
    }
}

/// The formula call a family's form makes, where it has one.
fn dist_call(op: &str, form: &str, v: &V, ps: &[V]) -> Option<(&'static str, Vec<V>)> {
    let (dist, inv, rt) = dist_fx(op);
    let with_v = |name: &'static str| {
        let mut args = vec![v.clone()];
        args.extend(ps.iter().cloned());
        (name, args)
    };
    match form {
        "cdf" | "pdf" | "pmf" => dist.map(|d| {
            let (name, mut args) = with_v(d);
            args.push(V::Bool(form == "cdf"));
            (name, args)
        }),
        "inv" => inv.map(|i| {
            if op == "binom" {
                let mut args = ps.to_vec();
                args.push(v.clone());
                (i, args)
            } else {
                with_v(i)
            }
        }),
        "rt" => rt.map(with_v),
        _ => None,
    }
}

fn dist_form(form: &str) -> crate::dists::Form {
    use crate::dists::Form;
    match form {
        "pdf" => Form::Pdf,
        "pmf" => Form::Pmf,
        "2t" => Form::TwoTail,
        "rt" => Form::RightTail,
        "inv" => Form::Inv,
        "inv2t" => Form::Inv2t,
        "invrt" => Form::InvRt,
        _ => Form::Cdf,
    }
}

fn distributions(c: &mut Call) -> Answer {
    let op = c.field_str("op", "normal").to_string();
    let form = c.field_str("form", "cdf").to_string();
    let Some((x_key, params)) = dist_keys(&op) else {
        return Err(err(ErrorCode::Value, format!("Unknown distribution {op}")));
    };
    let read = |c: &Call, k: &str| c.read(k);
    let ps: Vec<V> = params.iter().map(|k| read(c, k)).collect();
    let result = if form == "sample" {
        let count = c.read("count");
        if matches!(count, V::Null) || ps.iter().any(|v| matches!(v, V::Null)) {
            V::Null
        } else {
            let head = |v: &V| match v {
                V::List(items) => match items.first() {
                    None | Some(V::Null | V::Undef) => 0.0,
                    Some(x) => crate::excel_functions::num_blank_zero(x),
                },
                v => crate::excel_functions::num_blank_zero(v),
            };
            let n = crate::jsnum::nan_min(100_000.0, crate::jsnum::nan_max(0.0, round_half_up(head(&count))));
            let nums: Vec<f64> = ps.iter().map(head).collect();
            // A frozen call's seed, else one drawn and held until the generation advances.
            let seed = match c.field("sampleSeed").and_then(serde_json::Value::as_f64) {
                Some(s) => s as u32,
                None => (c.rolls("", 1, false)[0] * 4_294_967_296.0) as u32,
            };
            let mut rng = crate::planners::mulberry32(seed);
            let us: Vec<f64> = (0..if n.is_nan() { 0 } else { n as usize }).map(|_| rng()).collect();
            let &(_, continuous, inverse, _) =
                crate::fns_random::FAMILIES.iter().find(|f| f.0 == op).unwrap_or(&("", true, false, &[]));
            list(
                crate::fns_random::sample_quantiles(&op, continuous, inverse, &us, &nums)
                    .into_iter()
                    .map(|v| v.map_or(V::Null, V::Num))
                    .collect(),
            )
        }
    } else {
        let first_key = if form.starts_with("inv") { "prob" } else { x_key };
        let mut args = vec![read(c, first_key)];
        args.extend(ps);
        let f = dist_form(&form);
        broadcast_err(&args, |o| {
            let ps: Vec<V> = o[1..].iter().map(|&v| v.clone()).collect();
            let r = match dist_call(&op, &form, o[0], &ps) {
                Some((name, args)) => core_call(name, &args),
                None => {
                    let nums: Vec<f64> = ps.iter().map(crate::excel_functions::num_blank_zero).collect();
                    match crate::dists::compute(&op, f, crate::excel_functions::num_blank_zero(o[0]), &nums) {
                        Ok(Some(n)) => V::Num(n),
                        _ => V::Null,
                    }
                }
            };
            match r {
                e if e.is_sol_error() => e,
                V::Num(n) if n.is_finite() => V::Num(n),
                // [[C24]] arraySemantics: a parameter outside the domain is a wrong input.
                _ => err(ErrorCode::Domain, "A parameter is outside the distribution's domain"),
            }
        })
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), Cv::from(result))])
}

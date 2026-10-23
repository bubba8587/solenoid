//! [[B17]] typedValueModel, [[C48]] appendLadder, [[C10]] socketLattice, [[C28]] literalsIffEditable, [[B11]]
//! maximalMerge, [[C17]] shareImpl. The table cards' bodies: `nodes/frame.ts`' builders, readers and planners (the lazy
//! verbs stay on the frame backend), `nodes/cube.ts`, and the cards in `nodes/stats.ts` and `nodes/finance.ts` whose
//! answer is a frame. The computations are the core's own (`frame_fns.rs`, `decision.rs`, `planners.rs`, `ladder.rs`,
//! `fns_lists.rs`); a body reads its inputs, calls them on the core's frame, and carries the units and formats back.

use super::stats::{read_role, Role};
use super::{err, list, Answer, Call, Column, Cube, CubeColumn, Frame};
use crate::error_value::{ErrorCode, SolError};
use crate::excel_functions::V;
use crate::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::{js_trim, math_max, math_round};
use serde_json::{json, Value as Json};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "AmortizationNode" => amortization(c),
        "HeadersNode" => headers(c),
        "SplitFrameNode" => split_frame(c),
        "SettleNode" => settle(c),
        "DescribeNode" => describe(c),
        "CorrMatrixNode" => corr_matrix(c),
        "PcaNode" => pca(c),
        "DecisionSensitivityNode" => decision_sensitivity(c),
        "EtsForecastNode" => ets_forecast(c),
        "FitDistributionNode" => fit_distribution(c),
        "DecomposeNode" => decompose(c),
        "KMeansNode" => kmeans(c),
        "LogisticNode" => logistic(c),
        "AllocatorNode" => allocator(c),
        "PayoffPlannerNode" => payoff_planner(c),
        "ChoiceLadderNode" => choice_ladder(c),
        "AddColumnNode" => add_column(c),
        "GetRowNode" => get_row(c),
        "XLookupNode" => xlookup(c),
        "NestNode" => nest(c),
        "UnnestNode" => unnest(c),
        "BuildCubeNode" => build_cube(c),
        "CubeColumnsNode" => cube_columns(c),
        "NestJoinNode" => nest_join(c),
        "CubeRollupNode" => cube_rollup(c),
        "DecisionMatrixNode" => decision_matrix(c),
        "ReconcileNode" => reconcile(c),
        "BuildFrameNode" => build_frame(c),
        "FrameFromListsNode" => frame_from_lists(c),
        _ => return None,
    })
}

// ─── The core's frame and the card's ────────────────────────────────────────────

/// A card cell as the columnar hand-off carries it (`encodeBinary`): a number, text, a logical or an error, anything
/// else blank.
pub(crate) fn core_cell(v: &V) -> FrameCell {
    match v {
        V::Num(n) => FrameCell::Num(*n),
        V::Str(s) => FrameCell::Str(s.clone()),
        V::Bool(b) => FrameCell::Bool(*b),
        V::Err(e) => FrameCell::Err(e.clone()),
        _ => FrameCell::Null,
    }
}

pub(crate) fn card_cell(c: &FrameCell) -> V {
    crate::excel_formula::cell_to_v(c)
}

/// The card's frame as the core computes on it: names, types and cells (units, formats and typed text stay behind).
pub(crate) fn to_core(f: &Frame) -> FrameValue {
    FrameValue {
        columns: f.columns.iter().map(|c| FrameColumn::new(c.name.clone(), c.ty, c.values.iter().map(core_cell).collect())).collect(),
    }
}

pub(crate) fn core_column(c: &FrameColumn) -> Column {
    Column { name: c.name.clone(), ty: c.ty, values: c.values.iter().map(card_cell).collect(), unit: None, format: None, raw: None }
}

/// The core's answer as a card's frame (`decodeBinary`): no unit, format or typed text.
pub(crate) fn from_core(f: &FrameValue) -> Frame {
    Frame { columns: f.columns.iter().map(core_column).collect(), total_rows: None, approx: None }
}

pub(crate) fn frame_v(columns: Vec<Column>) -> V {
    V::Frame(Rc::new(Frame { columns, total_rows: None, approx: None }))
}

pub(crate) fn num_column(name: &str, values: Vec<V>) -> Column {
    Column { name: name.to_string(), ty: FrameColType::Number, values, unit: None, format: None, raw: None }
}

/// What the error guard shows for a JS exception the TS body throws ([[node-bodies]] § Freezing).
pub(crate) fn thrown(message: &str) -> V {
    err(ErrorCode::Error, format!("This node failed to compute: {message}"))
}

/// `raw.trim()` on what `readInput` gave a text socket: text trims, anything else throws as JS's `trim` does.
pub(crate) fn trimmed(v: &V, name: &str) -> Result<String, V> {
    match v {
        V::Str(s) => Ok(js_trim(s).to_string()),
        _ => Err(thrown(&format!("{name}.trim is not a function"))),
    }
}

/// A number as `jsonEnc` writes it and a JSON reader takes it back: an integer as an integer, what JSON can't hold
/// tagged.
pub(crate) fn json_num(n: f64) -> Json {
    if n.is_nan() {
        return json!({ "__nf": "nan" });
    }
    if n.is_infinite() {
        return json!({ "__nf": if n > 0.0 { "inf" } else { "-inf" } });
    }
    if n == 0.0 && n.is_sign_negative() {
        return json!({ "__nf": "-0" });
    }
    if n.fract() == 0.0 && n.abs() < 1e21 {
        if (0.0..18446744073709551616.0).contains(&n) {
            return Json::from(n as u64);
        }
        if (-9223372036854775808.0..0.0).contains(&n) {
            return Json::from(n as i64);
        }
    }
    Json::from(n)
}

/// Plain data as `jsonEnc` writes it: lists as arrays, numbers as `json_num`, an error as its wire form.
pub(crate) fn to_json(v: &V) -> Json {
    match v {
        V::Num(n) => json_num(*n),
        V::Str(s) => Json::String(s.to_string()),
        V::Bool(b) => Json::Bool(*b),
        V::List(l) => Json::Array(l.iter().map(to_json).collect()),
        V::Json(j) => (**j).clone(),
        V::Undef => json!({ "__undef": 1 }),
        _ => Json::Null,
    }
}

/// `readInput(inputs[key], this.stringLiterals[key] ?? dflt)`.
pub(crate) fn str_input(c: &Call, key: &str, dflt: &str) -> V {
    let lit = match c.string_literal(key) {
        V::Undef | V::Null => V::str(dflt),
        v => v,
    };
    c.read_input(key, lit)
}

/// `inputs[key]?.[0] ?? null`.
pub(crate) fn first(c: &Call, key: &str) -> V {
    super::stats::first(c, key)
}

/// A frame's `V8` array cap: a body that builds a longer array throws as JS does.
const MAX_ARRAY: f64 = 134_217_725.0;

fn number_or_nan(v: &V) -> f64 {
    if let V::Num(n) = v { *n } else { f64::NAN }
}

// ─── Amortization (finance.ts) ──────────────────────────────────────────────────

/// `readMoneyInputs`: each money input read in one currency, every other input as a plain number; the currency read,
/// as a column unit, beside them.
fn read_money(c: &mut Call, name: &str, money: &[&str]) -> Result<Option<Json>, V> {
    use crate::finance_units::currency_clash;
    use crate::unit_dims::{dim_equal, is_dimensionless, Dim};
    use crate::unit_lists::format_dim;
    use crate::unit_value::unit_error;
    #[derive(Default)]
    struct Read {
        code: Option<String>,
        seen: bool,
        fail: Option<V>,
    }
    fn read(v: &V, name: &str, key: &str, is_money: bool, r: &mut Read) -> V {
        if r.fail.is_some() {
            return v.clone();
        }
        match v {
            V::List(l) => list(l.iter().map(|x| read(x, name, key, is_money, r)).collect()),
            V::Unit(u) if is_dimensionless(&u.dim) => V::Num(u.value),
            V::Unit(u) => {
                if !is_money {
                    r.fail = Some(V::err(unit_error(&format!("{name}'s {key} is a plain number, not {}. A rate or a count of periods carries no unit.", format_dim(&u.dim)))));
                    return v.clone();
                }
                if !dim_equal(&u.dim, &Dim::from([("currency".to_string(), 1.0)])) {
                    r.fail = Some(V::err(unit_error(&format!("{name}'s money arguments take a currency, not {}.", format_dim(&u.dim)))));
                    return v.clone();
                }
                if let Some(d) = &u.display {
                    if let Some(prev) = r.code.as_ref().filter(|p| *p != d) {
                        r.fail = Some(V::err(currency_clash(prev, d)));
                        return v.clone();
                    }
                    r.code = Some(d.clone());
                }
                r.seen = true;
                V::Num(u.value)
            }
            other => other.clone(),
        }
    }
    let mut r = Read::default();
    let mut inputs = std::mem::take(&mut c.inputs);
    for (key, vals) in inputs.iter_mut() {
        let is_money = money.contains(&key.as_str());
        for v in vals.iter_mut() {
            *v = read(v, name, key, is_money, &mut r);
        }
    }
    c.inputs = inputs;
    if let Some(e) = r.fail {
        return Err(e);
    }
    let code = r.code;
    Ok(r.seen.then(|| match code {
        Some(d) => json!({ "dim": { "currency": 1 }, "display": d }),
        None => json!({ "dim": { "currency": 1 } }),
    }))
}

fn amortization(c: &mut Call) -> Answer {
    let unit = match read_money(c, "Amortization", &["pv", "fv"]) {
        Ok(u) => u,
        Err(e) => {
            c.show("cachedResult", V::Null);
            return Ok(vec![("frame".into(), e)]);
        }
    };
    let [rate, nper, pv, fv] = ["rate", "nper", "pv", "fv"].map(|k| c.read_num(k, 0.0));
    if [&rate, &nper, &pv, &fv].iter().any(|v| matches!(v, V::Null)) {
        c.show("cachedResult", V::Null);
        return Ok(vec![("frame".into(), V::Null)]);
    }
    let n = super::kit::num(&nper);
    if n.floor() > 1_000_000.0 {
        c.show("cachedResult", V::Null);
        return Ok(vec![("frame".into(), err(ErrorCode::Domain, "Amortization takes at most 1,000,000 periods"))]);
    }
    let ty = if c.field_str("paymentTiming", "end") == "beg" { 1.0 } else { 0.0 };
    let frame = crate::planners::amortization_frame(number_or_nan(&rate), n, number_or_nan(&pv), number_or_nan(&fv), ty).map(|f| from_core(&f));
    let Some(mut frame) = frame else {
        c.show("cachedResult", V::Null);
        return Ok(vec![("frame".into(), V::Null)]);
    };
    // The card shows the schedule before its money columns take the currency; with none, the two are one frame.
    let Some(u) = unit else {
        let frame = V::Frame(Rc::new(frame));
        c.show("cachedResult", frame.clone());
        return Ok(vec![("frame".into(), frame)]);
    };
    c.show("cachedResult", V::Frame(Rc::new(frame.clone())));
    for col in frame.columns.iter_mut().filter(|col| col.name != "Period") {
        col.unit = Some(u.clone());
    }
    Ok(vec![("frame".into(), V::Frame(Rc::new(frame)))])
}

// ─── Forecast (ETS), Fit Distribution, Decompose (stats.ts) ─────────────────────

/// `forAggregate`: the first error, else the number cells.
fn for_aggregate(v: &V) -> Result<Vec<f64>, V> {
    let xs = super::stats::items(v);
    if let Some(e) = xs.iter().find(|x| x.is_sol_error()) {
        return Err(e.clone());
    }
    Ok(xs.iter().filter_map(|x| if let V::Num(n) = x { Some(*n) } else { None }).collect())
}

fn ets_forecast(c: &mut Call) -> Answer {
    let blank = |c: &mut Call, forecast: V| {
        c.show("cachedResult", forecast.clone());
        c.show("cachedSeason", V::Null);
        Ok(vec![("forecast".into(), forecast), ("detected".into(), V::Null)])
    };
    let y = match for_aggregate(&first(c, "values")) {
        Ok(y) => y,
        Err(e) => return blank(c, e),
    };
    let horizon = read_role(c, "horizon", Role::Required);
    let season = read_role(c, "season", Role::Setting(V::Num(1.0)));
    if horizon.is_sol_error() {
        return blank(c, horizon);
    }
    if y.len() < 3 {
        return blank(c, V::Null);
    }
    let h = math_max(1.0, math_round(super::kit::num(&horizon)));
    let s = super::kit::num(&season);
    let m = if s == 1.0 { crate::fns_lists::detect_season(&y) as f64 } else { math_max(1.0, math_round(s)) };
    let fit = crate::fns_lists::fit_ets(&y, m).or_else(|| if m > 1.0 { crate::fns_lists::fit_ets(&y, 1.0) } else { None });
    let Some(fit) = fit else { return blank(c, V::Null) };
    if h > MAX_ARRAY {
        return Err(thrown("Invalid array length"));
    }
    let steps = if h.is_nan() { 0 } else { h as usize };
    let z = crate::dists::norm_s_inv(0.5 + 0.95 / 2.0);
    let forecast = (1..=steps).map(|k| V::Num(crate::fns_lists::ets_forecast_at(&fit, k as f64))).collect();
    let interval = (1..=steps).map(|k| V::Num(z * fit.sigma * (k as f64).sqrt())).collect();
    let detected = V::Num(if fit.season > 1 { fit.season as f64 } else { 0.0 });
    let frame = frame_v(vec![num_column("Forecast", forecast), num_column("Interval", interval)]);
    c.show("cachedSeason", detected.clone());
    c.show("cachedResult", frame.clone());
    Ok(vec![("forecast".into(), frame), ("detected".into(), detected)])
}

const FIT_LABELS: [(&str, &str); 8] = [
    ("normal", "Normal"),
    ("lognorm", "Lognormal"),
    ("expon", "Exponential"),
    ("gamma", "Gamma"),
    ("weibull", "Weibull"),
    ("uniform", "Uniform"),
    ("beta", "Beta"),
    ("poisson", "Poisson"),
];

/// `fitDistribution`'s parameter names and its Kolmogorov–Smirnov distance from the sorted sample.
fn fit_names_and_ks(family: &str, p: &[f64], sorted: &[f64]) -> (&'static [&'static str], f64) {
    use crate::dists::{regularized_beta, regularized_gamma, std_norm_cdf};
    use crate::fdlibm::{exp, log, pow};
    let cdf: Box<dyn Fn(f64) -> f64> = match family {
        "normal" => Box::new(move |v| std_norm_cdf((v - p[0]) / p[1])),
        "lognorm" => Box::new(move |v| if v <= 0.0 { 0.0 } else { std_norm_cdf((log(v) - p[0]) / p[1]) }),
        "expon" => Box::new(move |v| if v < 0.0 { 0.0 } else { 1.0 - exp(-p[0] * v) }),
        "gamma" => Box::new(move |v| if v <= 0.0 { 0.0 } else { regularized_gamma(p[0], v / p[1]) }),
        "weibull" => Box::new(move |v| if v < 0.0 { 0.0 } else { 1.0 - exp(-pow(v / p[1], p[0])) }),
        "uniform" => Box::new(move |v| if v <= p[0] { 0.0 } else if v >= p[1] { 1.0 } else { (v - p[0]) / (p[1] - p[0]) }),
        "beta" => Box::new(move |t| if t <= 0.0 { 0.0 } else if t >= 1.0 { 1.0 } else { regularized_beta(t, p[0], p[1]) }),
        _ => Box::new(move |v| {
            let k = v.floor();
            if k < 0.0 { 0.0 } else { 1.0 - regularized_gamma(k + 1.0, p[0]) }
        }),
    };
    let names: &'static [&'static str] = match family {
        "normal" | "lognorm" => &["mean", "stdev"],
        "expon" | "poisson" => &["lambda"],
        "uniform" => &["min", "max"],
        _ => &["alpha", "beta"],
    };
    let n = sorted.len() as f64;
    let mut d = 0.0;
    for (i, &x) in sorted.iter().enumerate() {
        let f = cdf(x);
        d = math_max(math_max(d, (f - (i as f64 + 1.0) / n).abs()), (f - i as f64 / n).abs());
    }
    (names, d)
}

fn fit_distribution(c: &mut Call) -> Answer {
    let shown = |c: &mut Call, ranking: V, best: V, params: V| {
        c.show("cachedRanking", ranking.clone());
        c.show("cachedBest", best.clone());
        c.show("cachedParams", params.clone());
        Ok(vec![("ranking".into(), ranking), ("best".into(), best), ("params".into(), params)])
    };
    let data = match for_aggregate(&first(c, "list")) {
        Ok(y) => y,
        Err(e) => return shown(c, e, V::Null, V::Null),
    };
    let mut sorted: Vec<f64> = data.iter().copied().filter(|v| v.is_finite()).collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    struct Fit {
        label: &'static str,
        names: &'static [&'static str],
        params: Vec<f64>,
        ll: f64,
        aic: f64,
        ks: f64,
    }
    let mut fits: Vec<Fit> = Vec::new();
    for (family, label) in FIT_LABELS {
        let Some((params, ll)) = crate::fns_lists::fit_distribution(&data, family) else { continue };
        let aic = 2.0 * params.len() as f64 - 2.0 * ll;
        if !aic.is_finite() {
            continue;
        }
        let (names, ks) = fit_names_and_ks(family, &params, &sorted);
        fits.push(Fit { label, names, params, ll, aic, ks });
    }
    fits.sort_by(|a, b| (a.aic - b.aic).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    if fits.is_empty() {
        return shown(c, V::Null, V::Null, V::Null);
    }
    let text = |name: &str, f: &dyn Fn(&Fit) -> String| Column { name: name.into(), ty: FrameColType::String, values: fits.iter().map(|x| V::str(&f(x))).collect(), unit: None, format: None, raw: None };
    let nums = |name: &str, f: &dyn Fn(&Fit) -> V| num_column(name, fits.iter().map(f).collect());
    let pval = |i: usize| move |x: &Fit| x.params.get(i).map_or(V::Null, |v| V::Num(*v));
    let ranking = frame_v(vec![
        text("family", &|x| x.label.to_string()),
        text("parameter 1", &|x| x.names.first().unwrap_or(&"").to_string()),
        nums("value 1", &pval(0)),
        text("parameter 2", &|x| x.names.get(1).unwrap_or(&"").to_string()),
        nums("value 2", &pval(1)),
        nums("log-likelihood", &|x| V::Num(x.ll)),
        nums("AIC", &|x| V::Num(x.aic)),
        nums("KS", &|x| V::Num(x.ks)),
    ]);
    let best = V::str(fits[0].label);
    let params = list(fits[0].params.iter().map(|v| V::Num(*v)).collect());
    shown(c, ranking, best, params)
}

fn decompose(c: &mut Call) -> Answer {
    let blank = |c: &mut Call, e: V| {
        c.show("cachedResult", e.clone());
        Ok(vec![("decomposition".into(), e)])
    };
    let raw = first(c, "values");
    let period = read_role(c, "period", Role::Required);
    if period.is_sol_error() {
        return blank(c, period);
    }
    if matches!(raw, V::Null) {
        return blank(c, V::Null);
    }
    let xs = super::stats::items(&raw);
    if let Some(e) = xs.iter().find(|v| v.is_sol_error()) {
        return blank(c, e.clone());
    }
    let nums: Vec<Option<f64>> = xs.iter().map(|v| if let V::Num(n) = v { n.is_finite().then_some(*n) } else { None }).collect();
    let p = super::kit::num(&period);
    let model = c.field_str("model", "additive").to_string();
    if p.is_nan() {
        return Err(thrown("Invalid array length"));
    }
    let d = if model == "stl" { crate::fns_lists::stl_decompose(&nums, p) } else { crate::fns_lists::seasonal_decompose(&nums, p, model == "additive") };
    let Some([t, s, r]) = d else { return blank(c, V::Null) };
    let col = |name: &str, v: Vec<Option<f64>>| num_column(name, v.into_iter().map(|x| x.map_or(V::Null, V::Num)).collect());
    let frame = frame_v(vec![col("Trend", t), col("Seasonal", s), col("Residual", r)]);
    blank(c, frame)
}

// ─── K-Means, Logistic (frame.ts) ───────────────────────────────────────────────

fn frame_in(c: &Call, key: &str) -> Option<Rc<Frame>> {
    match first(c, key) {
        V::Frame(f) => Some(f),
        _ => None,
    }
}

fn kmeans(c: &mut Call) -> Answer {
    let k = read_role(c, "k", Role::Required);
    let out = |c: &mut Call, labels: V, centers: V, shown: (V, V)| {
        c.show("cachedLabels", shown.0);
        c.show("cachedCenters", shown.1);
        Ok(vec![("labels".into(), labels), ("centers".into(), centers)])
    };
    if k.is_sol_error() {
        return out(c, k.clone(), k, (V::Null, V::Null));
    }
    let Some(f) = frame_in(c, "frame") else { return out(c, V::Null, V::Null, (V::Null, V::Null)) };
    if !f.columns.iter().any(|col| col.ty == FrameColType::Number) {
        let e = err(ErrorCode::Value, "K-Means needs at least one number column");
        return out(c, e.clone(), V::Null, (e, V::Null));
    }
    let core = to_core(&f);
    let kn = super::kit::num(&k);
    if kn.is_nan() {
        let numeric = (0..crate::frame::frame_row_count(&core)).any(|r| {
            core.columns.iter().filter(|col| col.ty == FrameColType::Number).all(|col| matches!(col.cell_at(r), FrameCell::Num(n) if n.is_finite()))
        });
        return if numeric { Err(thrown("Invalid array length")) } else { out(c, V::Null, V::Null, (V::Null, V::Null)) };
    }
    let Some(r) = crate::planners::kmeans_frame(&core, kn) else { return out(c, V::Null, V::Null, (V::Null, V::Null)) };
    let mut cols = from_core(&r).columns;
    let labels = list(cols.remove(0).values);
    let centers = frame_v(cols);
    out(c, labels.clone(), centers.clone(), (labels, centers))
}

fn logistic(c: &mut Call) -> Answer {
    let blank = |c: &mut Call, e: V| {
        c.show("cachedCoefficients", e.clone());
        c.show("cachedProbabilities", V::Null);
        Ok(vec![("coefficients".into(), e), ("probabilities".into(), V::Null)])
    };
    let f = frame_in(c, "frame");
    let target = str_input(c, "target", "");
    let (Some(f), false) = (f, matches!(target, V::Null)) else { return blank(c, V::Null) };
    let t = trimmed(&target, "target")?;
    if t.is_empty() {
        return blank(c, V::Null);
    }
    let Some(ti) = f.columns.iter().position(|col| col.name == t) else { return blank(c, err(ErrorCode::Ref, format!("Logistic Regression: no column \"{t}\""))) };
    if !f.columns.iter().enumerate().any(|(i, col)| i != ti && col.ty == FrameColType::Number) {
        return blank(c, err(ErrorCode::Value, "Logistic Regression needs at least one number column besides the target"));
    }
    match crate::planners::logistic_frame(&to_core(&f), &t) {
        Some(Some(r)) => {
            let mut cols = from_core(&r).columns;
            let probs = list(cols.pop().map(|col| col.values).unwrap_or_default());
            let coef = frame_v(cols);
            c.show("cachedCoefficients", coef.clone());
            c.show("cachedProbabilities", probs.clone());
            Ok(vec![("coefficients".into(), coef), ("probabilities".into(), probs)])
        }
        _ => blank(c, err(ErrorCode::Domain, "Logistic Regression: the target must take both values and there must be more rows than columns")),
    }
}

// ─── Allocator, Payoff Planner (frame.ts) ───────────────────────────────────────

/// `c.name.trim().toLowerCase()` is one of `names`.
fn named(col: &Column, names: &[&str]) -> bool {
    names.contains(&crate::jsnum::js_lower(js_trim(&col.name)).as_ref())
}

fn by_name(f: &Frame, names: &[&str]) -> Option<usize> {
    f.columns.iter().position(|col| named(col, names))
}

/// `{ ...c, unit, format }` of another column's, where it has them.
fn carry_money(col: &mut Column, from: &Column) {
    if from.unit.is_some() {
        col.unit = from.unit.clone();
    }
    if from.format.is_some() {
        col.format = from.format.clone();
    }
}

/// `runVerb`'s answer as a body's: the frame, or the error it threw.
fn frame_or_error(r: Result<FrameValue, SolError>) -> Result<Frame, V> {
    r.map(|f| from_core(&f)).map_err(V::err)
}

/// A body's one frame output, shown on the card as `cachedResult`.
fn shown_frame(c: &mut Call, key: &str, v: V) -> Answer {
    c.show("cachedResult", v.clone());
    Ok(vec![(key.into(), v)])
}

fn allocator(c: &mut Call) -> Answer {
    let Some(f) = frame_in(c, "categories") else { return shown_frame(c, "frame", V::Null) };
    let amount = super::list::or(c.read_num("amount", 0.0), V::Num(0.0));
    let mode = c.field_str("mode", "budget").to_string();
    let out = match crate::decision::allocate_frame(&to_core(&f), &mode, super::kit::num(&amount)) {
        Some(r) => frame_or_error(r),
        None => Err(err(ErrorCode::Value, format!("Allocator: no mode \"{mode}\""))),
    };
    let out = out.map(|mut out| {
        let weight = by_name(&f, &["weight", "weights", "value"]);
        let price: Vec<usize> = (0..f.columns.len()).filter(|&i| f.columns[i].ty == FrameColType::Number && Some(i) != weight).collect();
        let min = by_name(&f, &["min"]).or(price.first().copied());
        if let (Some(min), 3) = (min, out.columns.len()) {
            carry_money(&mut out.columns[1], &f.columns[min]);
        }
        V::Frame(Rc::new(out))
    });
    shown_frame(c, "frame", out.unwrap_or_else(|e| e))
}

/// `localMonthStartSerial`: the first of this month.
fn month_start() -> f64 {
    let V::Num(today) = super::kit::core_call("TODAY", &[]) else { return f64::NAN };
    let (y, m, _) = crate::date_serial::civil_from_days(today as i64 - 25569);
    crate::date_serial::days_from_civil(y, m, 1) as f64 + 25569.0
}

fn payoff_planner(c: &mut Call) -> Answer {
    let Some(f) = frame_in(c, "debts") else { return shown_frame(c, "frame", V::Null) };
    let extra = super::list::or(c.read_num("extra", 0.0), V::Num(0.0));
    let start = match c.wired("start") {
        None => Some(month_start()),
        Some(w) => match w.first() {
            None | Some(V::Null | V::Undef) => None,
            Some(V::Num(n)) => Some(*n),
            Some(_) => Some(f64::NAN),
        },
    };
    let order = if c.field_str("order", "avalanche") == "snowball" { "snowball" } else { "avalanche" };
    let view = if c.field_str("mode", "summary") == "schedule" { "schedule" } else { "summary" };
    let out = frame_or_error(crate::planners::payoff_frame(&to_core(&f), super::kit::num(&extra), order, view, start)).map(|mut out| {
        let nums: Vec<usize> = (0..f.columns.len()).filter(|&i| f.columns[i].ty == FrameColType::Number).collect();
        if let Some(bal) = by_name(&f, &["balance", "owed", "principal"]).or(nums.first().copied()) {
            for (k, col) in out.columns.iter_mut().enumerate() {
                if if view == "schedule" { k > 0 } else { k == 2 } {
                    carry_money(col, &f.columns[bal]);
                }
            }
        }
        V::Frame(Rc::new(out))
    });
    shown_frame(c, "frame", out.unwrap_or_else(|e| e))
}

// ─── Choice Ladder (frame.ts) ───────────────────────────────────────────────────

fn normalize_of(c: &Call) -> crate::decision::Normalize {
    crate::decision::Normalize::from_tag(c.field_str("normalize", "max")).unwrap_or(crate::decision::Normalize::Max)
}

/// `ladderFromWire`: the plan's cost columns dressed in their resource's unit and format, and the ladder's payload.
fn ladder_from_wire(f: &Frame, plan: &FrameValue, wire: &V) -> (Frame, Json) {
    let part = |i: usize| super::stats::items(wire).get(i).cloned().unwrap_or(V::Null);
    let rows = |i: usize| super::stats::items(&part(i)).to_vec();
    let at = |row: &V, i: usize| super::stats::items(row).get(i).cloned().unwrap_or(V::Null);
    let resources = rows(2);
    let cols: Vec<Option<&Column>> = resources
        .iter()
        .map(|r| {
            let name = at(r, 0);
            f.columns.iter().find(|c| (c.ty == FrameColType::Number || c.ty == FrameColType::Logical) && matches!(&name, V::Str(s) if **s == *c.name))
        })
        .collect();
    let r = resources.len();
    let mut out = from_core(plan);
    for (j, col) in out.columns.iter_mut().enumerate() {
        if j >= 4 && j < 4 + 2 * r {
            if let Some(src) = cols[(j - 4) % r] {
                carry_money(col, src);
            }
        }
    }
    let obj = |row: &V, keys: &[&str]| Json::Object(keys.iter().enumerate().map(|(i, k)| (k.to_string(), to_json(&at(row, i)))).collect());
    let objs = |i: usize, keys: &[&str]| Json::Array(rows(i).iter().map(|row| obj(row, keys)).collect());
    let resources_json = resources
        .iter()
        .enumerate()
        .map(|(k, row)| {
            let mut o = obj(row, &["name", "limit", "floor", "logical"]);
            o["format"] = cols[k].and_then(|c| c.format.clone()).unwrap_or(Json::Null);
            o
        })
        .collect();
    let payload = json!({
        "kind": "ladder",
        "options": objs(0, &["name", "score", "costs", "value"]),
        "criteria": to_json(&part(1)),
        "resources": Json::Array(resources_json),
        "states": objs(3, &["id", "depth", "share", "taken", "end"]),
        "edges": objs(4, &["from", "to", "pick", "share", "kind", "struck", "conflicts"]),
        "main": to_json(&part(5)),
        "choices": to_json(&part(6)),
        "ruledOut": to_json(&part(7)),
    });
    (out, payload)
}

fn choice_ladder(c: &mut Call) -> Answer {
    let out = |c: &mut Call, frame: V, chart: V| {
        c.show("cachedResult", frame.clone());
        c.show("cachedChart", chart.clone());
        Ok(vec![("frame".into(), frame), ("chart".into(), chart)])
    };
    let Some(f) = frame_in(c, "frame") else { return out(c, V::Null, V::Null) };
    let close = super::list::or(c.read_num("close", 0.05), V::Num(0.0));
    let (w, l) = (frame_in(c, "weights").map(|w| to_core(&w)), frame_in(c, "limits").map(|l| to_core(&l)));
    let choices: Vec<String> = c.field("choices").and_then(Json::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    match crate::ladder::choice_ladder(&to_core(&f), w.as_ref(), l.as_ref(), normalize_of(c), super::kit::num(&close), &choices) {
        Some(Ok((plan, wire))) => {
            let (plan, payload) = ladder_from_wire(&f, &plan, &wire);
            let label = c.field_str("label", "");
            let title = if label.is_empty() { "Choice Ladder" } else { label };
            let chart = json!({ "__chart": true, "op": "ladder", "values": null, "payload": payload, "options": {}, "title": title });
            out(c, V::Frame(Rc::new(plan)), V::Json(Rc::new(chart)))
        }
        Some(Err(e)) => out(c, V::err(e.clone()), V::err(e)),
        None => out(c, V::Null, V::Null),
    }
}


// ─── Headers, Split Frame, Describe, Correlation Matrix, PCA (frame.ts) ──────────

/// A frame function's one frame, a thrown error as the card's error, as `runVerb` reads `frameOnCore`.
fn frame_fn_frame(name: &str, f: &Frame, args: &[V]) -> Option<Result<FrameValue, V>> {
    use crate::frame_fns::FrameOut;
    match frame_fn(name, &[&to_core(f)], args) {
        FrameOut::Frame(r) | FrameOut::FrameAnd(r, _) => Some(Ok(r)),
        FrameOut::Error(e) => Some(Err(V::err(e))),
        _ => None,
    }
}

fn headers(c: &mut Call) -> Answer {
    let Some(f) = frame_in(c, "frame") else { return shown_frame(c, "frame", V::Null) };
    let promote = c.field_str("action", "promote") == "promote";
    let out = match frame_fn_frame(if promote { "promoteHeaders" } else { "demoteHeaders" }, &f, &[]) {
        Some(Ok(r)) if promote && r.columns.len() == f.columns.len() => {
            // A promoted column keeps its type, unit and format, and its typed text loses the header row too.
            let columns = r.columns.iter().zip(&f.columns).map(|(rc, fc)| {
                let raw = fc.raw.as_ref().map(|raw| match raw {
                    Json::Array(a) => Json::Array(a.iter().skip(1).cloned().collect()),
                    other => other.clone(),
                });
                let values = if fc.raw.is_some() { fc.values.iter().skip(1).cloned().collect() } else { core_column(rc).values };
                Column { name: rc.name.clone(), values, raw, ..fc.clone() }
            });
            V::Frame(Rc::new(Frame { columns: columns.collect(), total_rows: None, approx: None }))
        }
        Some(Ok(r)) => V::Frame(Rc::new(from_core(&r))),
        Some(Err(e)) => e,
        None => V::Null,
    };
    shown_frame(c, "frame", out)
}

fn split_frame(c: &mut Call) -> Answer {
    let out = |c: &mut Call, matrix: V, headers: V, mixed: bool| {
        c.show("cachedMatrix", matrix.clone());
        c.show("cachedHeaders", headers.clone());
        c.show("cachedMixed", V::Bool(mixed));
        Ok(vec![("matrix".into(), matrix), ("headers".into(), headers)])
    };
    let Some(f) = frame_in(c, "frame") else { return out(c, V::Null, V::Null, false) };
    let ty = c.field_str("colType", "all");
    let cols: Vec<Column> = f.columns.iter().filter(|col| ty == "all" || col.ty.as_str() == ty).cloned().collect();
    let headers = list(cols.iter().map(|col| V::str(&col.name)).collect());
    if ty == "string" {
        let rows = cols.iter().map(|col| col.values.len()).max().unwrap_or(0);
        let matrix = if cols.is_empty() {
            V::Null
        } else {
            list((0..rows).map(|i| list(cols.iter().map(|col| match col.values.get(i) {
                Some(V::Str(s)) => V::Str(s.clone()),
                Some(V::Err(e)) => V::str(e.code.as_str()),
                None | Some(V::Null | V::Undef) => V::str(""),
                Some(v) => V::str(&crate::excel_functions::js_string_of(v)),
            }).collect())).collect())
        };
        return out(c, matrix, headers, false);
    }
    let mixed = cols.iter().any(|col| col.ty == FrameColType::String);
    let sub = Frame { columns: cols, total_rows: None, approx: None };
    let matrix = match frame_fn("splitFrame", &[&to_core(&sub)], &[]) {
        crate::frame_fns::FrameOut::Value(V::List(v)) => v.first().cloned().unwrap_or(V::Null),
        _ => V::Null,
    };
    out(c, matrix, headers, mixed)
}

fn describe(c: &mut Call) -> Answer {
    let Some(f) = frame_in(c, "frame") else { return shown_frame(c, "frame", V::Null) };
    let out = match frame_fn_frame("describeFrame", &f, &[]) {
        Some(Ok(r)) => V::Frame(Rc::new(from_core(&r))),
        Some(Err(e)) => e,
        None => V::Null,
    };
    shown_frame(c, "frame", out)
}

fn corr_matrix(c: &mut Call) -> Answer {
    let Some(f) = frame_in(c, "frame") else { return shown_frame(c, "frame", V::Null) };
    let method = V::str(c.field_str("method", "pearson"));
    let out = match frame_fn_frame("correlationMatrix", &f, &[method]) {
        Some(Ok(r)) => V::Frame(Rc::new(from_core(&r))),
        Some(Err(e)) => e,
        None => V::Null,
    };
    shown_frame(c, "frame", out)
}

fn pca(c: &mut Call) -> Answer {
    let out = |c: &mut Call, scores: V, loadings: V, explained: V| {
        c.show("cachedScores", scores.clone());
        c.show("cachedLoadings", loadings.clone());
        c.show("cachedExplained", explained.clone());
        Ok(vec![("scores".into(), scores), ("loadings".into(), loadings), ("explained".into(), explained)])
    };
    let Some(f) = frame_in(c, "frame") else { return out(c, V::Null, V::Null, V::Null) };
    if !f.columns.iter().any(|col| col.ty == FrameColType::Number) {
        return out(c, err(ErrorCode::Value, "PCA needs at least one number column"), V::Null, V::Null);
    }
    let standardize = c.field("standardize").and_then(Json::as_bool).unwrap_or(false);
    let r = match frame_fn("pca", &[&to_core(&f)], &[V::Bool(standardize)]) {
        crate::frame_fns::FrameOut::Frame(r) => r,
        _ => return out(c, V::Null, V::Null, V::Null),
    };
    let mut cols = from_core(&r).columns;
    let d = (cols.len().saturating_sub(2)) / 2;
    let explained = list(cols.get(2 * d + 1).map(|col| col.values.clone()).unwrap_or_default());
    cols.truncate(2 * d + 1);
    let loadings = cols.split_off(d);
    out(c, frame_v(cols), frame_v(loadings), explained)
}

// ─── Group Cost Settle (frame.ts) ───────────────────────────────────────────────

fn settle_shown(c: &mut Call, r: Result<(V, V), V>) -> Answer {
    let (t, n) = r.unwrap_or_else(|e| (e.clone(), e));
    c.show("cachedResult", t.clone());
    c.show("cachedNet", n.clone());
    Ok(vec![("transfers".into(), t), ("net".into(), n)])
}

/// The core's eight settle columns as the card's two frames, the money columns carrying `money`'s unit and format.
fn settle_split(out: FrameValue, unit: Option<Json>, format: Option<Json>) -> Option<(V, V)> {
    if out.columns.len() != 8 {
        return None;
    }
    let mut cols = from_core(&out).columns;
    for (k, col) in cols.iter_mut().enumerate() {
        if k == 2 || k > 3 {
            if unit.is_some() {
                col.unit = unit.clone();
            }
            if format.is_some() {
                col.format = format.clone();
            }
        }
    }
    let net = cols.split_off(3);
    Some((frame_v(cols), frame_v(net)))
}

fn settle_name_key(s: &str) -> String {
    crate::jsnum::js_lower(js_trim(s)).into_owned()
}

/// A cube cell as a column unit's JSON: the cell's dimension, and its display unit where it names one.
fn cell_money(u: &crate::unit_dims::UnitCell) -> Json {
    let dim = dim_json(&u.dim);
    match &u.display {
        Some(d) => json!({ "dim": dim, "display": d }),
        None => json!({ "dim": dim }),
    }
}

/// `settleLedgerOnCore`: a ledger's scalar cells on the core, a unit column crossing as its amounts. A row's list
/// reads as the names it holds, and as no amount.
fn settle_ledger_card(cube: &[(String, Vec<V>)]) -> Result<(V, V), V> {
    let amount_names = ["amount", "cost", "total", "price", "spend"];
    let amount_col = cube.iter().position(|(n, _)| amount_names.contains(&settle_name_key(n).as_str()));
    let mut units: Vec<V> = Vec::new();
    let columns: Vec<FrameColumn> = cube
        .iter()
        .enumerate()
        .map(|(j, (name, cells))| {
            if cells.iter().any(|v| matches!(v, V::Unit(_))) {
                units.push(V::str(name));
            }
            let values = cells
                .iter()
                .map(|v| match v {
                    V::Unit(u) => FrameCell::Num(u.value),
                    V::List(_) if Some(j) == amount_col => FrameCell::Null,
                    V::List(items) => FrameCell::Str(ledger_names(items).into()),
                    V::Frame(_) | V::Cube(_) => FrameCell::Null,
                    v => core_cell(v),
                })
                .collect();
            FrameColumn::new(name.clone(), FrameColType::String, values)
        })
        .collect();
    let money = amount_col.and_then(|j| cube[j].1.iter().find_map(|v| if let V::Unit(u) = v { Some(cell_money(u)) } else { None }));
    match frame_fn("settleLedger", &[&FrameValue { columns }], &[list(units)]) {
        crate::frame_fns::FrameOut::Frame(out) => settle_split(out, money, None).ok_or(V::Null),
        crate::frame_fns::FrameOut::Error(e) => Err(V::err(e)),
        _ => Err(V::Null),
    }
}

/// The names a row's list holds, as the ledger reads a comma-separated cell.
fn ledger_names(items: &[V]) -> String {
    let mut out = Vec::new();
    for v in items {
        match v {
            V::List(inner) => out.push(ledger_names(inner)),
            V::Null | V::Undef | V::Unit(_) | V::Frame(_) | V::Cube(_) => {}
            v => out.push(crate::excel_functions::js_string_of(v)),
        }
    }
    out.join(",")
}

fn settle(c: &mut Call) -> Answer {
    let raw = first(c, "in");
    let split = c.field_str("split", "equal");
    if c.field_str("mode", "totals") == "transactions" {
        let cube: Vec<(String, Vec<V>)> = match &raw {
            V::Cube(k) => k.columns.iter().map(|col| (col.name.clone(), col.cells.clone())).collect(),
            // `frameToCube`: a unit column's numbers become unit cells.
            V::Frame(f) => f.columns.iter().map(|col| (col.name.clone(), frame_cube_cells(col))).collect(),
            _ => return settle_shown(c, Ok((V::Null, V::Null))),
        };
        let r = settle_ledger_card(&cube);
        return settle_shown(c, r);
    }
    let f = match &raw {
        V::Frame(f) => (**f).clone(),
        V::Cube(k) => Frame {
            columns: k
                .columns
                .iter()
                .filter(|col| col.cells.iter().all(|v| !matches!(v, V::List(_) | V::Frame(_) | V::Cube(_))))
                .map(|col| super::list::infer_column(&col.name, &col.cells))
                .collect(),
            total_rows: None,
            approx: None,
        },
        _ => return settle_shown(c, Ok((V::Null, V::Null))),
    };
    let by_name = |names: &[&str]| f.columns.iter().find(|col| names.contains(&settle_name_key(&col.name).as_str()));
    let share = by_name(&["share", "weight", "shares"]);
    let paid = by_name(&["paid", "amount", "spent"])
        .or_else(|| f.columns.iter().find(|col| col.ty == FrameColType::Number && share.is_none_or(|s| !std::ptr::eq(*col, s))));
    let (unit, format) = paid.map_or((None, None), |p| (p.unit.clone(), p.format.clone()));
    let r = match frame_fn("settleFrame", &[&to_core(&f)], &[V::str(split)]) {
        crate::frame_fns::FrameOut::Frame(out) => settle_split(out, unit, format).ok_or(V::Null),
        crate::frame_fns::FrameOut::Error(e) => Err(V::err(e)),
        _ => Err(V::Null),
    };
    settle_shown(c, r)
}

/// `cubeCellsFromColumn`: a unit column's finite numbers as unit cells (`tagFrameCellUnit`).
fn frame_cube_cells(col: &Column) -> Vec<V> {
    let Some(unit) = &col.unit else { return col.values.clone() };
    let dim: crate::unit_dims::Dim = unit.get("dim").and_then(Json::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect()).unwrap_or_default();
    let display = unit.get("display").and_then(Json::as_str);
    col.values
        .iter()
        .map(|v| match v {
            V::Num(n) if n.is_finite() => match display.and_then(crate::unit_catalog::fc_unit_to_unit) {
                Some(u) => super::units::from_unit(*n, &u, display),
                None => super::units::tag(*n, dim.clone(), None),
            },
            v => v.clone(),
        })
        .collect()
}

// ─── Decision Sensitivity (frame.ts, frameVerbs.ts) ─────────────────────────────

/// `decisionSensitivity`: the options ranked under each scenario's weights.
fn decision_sensitivity_cube(scores: &FrameValue, scen: &FrameValue, normalize: crate::decision::Normalize) -> Result<V, SolError> {
    use crate::decision::{bounds_from, crit_key, criteria_names, criterion_row_index, decision_screen, norm_overrides, num_or_null, rank_options, round4, weight_columns, Resolved};
    use crate::error_value::sol_error;
    let criteria = criteria_names(scores);
    if criteria.is_empty() {
        return Err(sol_error(ErrorCode::Value, "Decision Matrix needs at least one numeric criterion column"));
    }
    let rows = criterion_row_index(scen);
    let cols = weight_columns(scen);
    if cols.is_empty() {
        return Err(sol_error(ErrorCode::Value, "Scenarios needs a number column per scenario"));
    }
    if !criteria.iter().any(|n| rows.contains_key(&crit_key(n))) {
        return Err(sol_error(ErrorCode::Value, "No Scenarios row is named after a criterion"));
    }
    let overrides = norm_overrides(scen, &criteria, &rows);
    let bounds = bounds_from(scen, &criteria, &rows)?;
    let failed = decision_screen(scores, bounds.as_deref());
    let (mut names, mut winners, mut margins, mut rankings) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for col in cols {
        let weights = criteria
            .iter()
            .enumerate()
            .map(|(j, name)| {
                let r = rows.get(&crit_key(name)).copied();
                let screen_only = r.is_some() && bounds.as_ref().and_then(|b| b.get(j)).is_some_and(|b| b.at_least.is_some() || b.at_most.is_some());
                r.and_then(|r| num_or_null(col.cell_at(r))).unwrap_or(if screen_only { 0.0 } else { 1.0 })
            })
            .collect();
        let resolved = Resolved { weights: Some(weights), overrides: overrides.clone(), bounds: bounds.clone() };
        let ranking = rank_options(scores, &resolved, normalize, false, &failed)?;
        let score_at = |i: usize| match ranking.columns[1].values.get(i) {
            Some(FrameCell::Num(n)) => Some(*n),
            _ => None,
        };
        let tied: Vec<&FrameCell> = ranking.columns[0].values.iter().enumerate().filter(|(k, _)| matches!(ranking.columns[2].values.get(*k), Some(FrameCell::Num(r)) if *r == 1.0)).map(|(_, v)| v).collect();
        names.push(V::str(&col.name));
        winners.push(if tied.len() > 1 {
            let texts: Vec<String> = tied.iter().map(|v| if matches!(v, FrameCell::Null) { String::new() } else { crate::excel_functions::js_string_of(&card_cell(v)) }).collect();
            V::str(&format!("Tie: {}", texts.join(", ")))
        } else {
            tied.first().map_or(V::Null, |v| card_cell(v))
        });
        margins.push(match (score_at(0), score_at(1)) {
            (Some(a), Some(b)) => V::Num(round4(a - b)),
            _ => V::Null,
        });
        rankings.push(V::Frame(Rc::new(from_core(&ranking))));
    }
    let col = |name: &str, cells: Vec<V>| CubeColumn { name: name.into(), cells, ty: None, format: None };
    Ok(cube_from_columns(vec![col("Scenario", names), col("Winner", winners), col("Margin", margins), col("Ranking", rankings)]))
}

fn decision_sensitivity(c: &mut Call) -> Answer {
    let scores = frame_in(c, "scores");
    let scen = frame_in(c, "scenarios");
    let flips = c.field_str("mode", "scenarios") == "flips";
    let out = match (scores, scen) {
        (None, _) => V::Null,
        (Some(_), None) if !flips => V::Null,
        (Some(s), w) => {
            let s = to_core(&s);
            let w = w.map(|w| to_core(&w));
            let r = if flips {
                let frames: Vec<&FrameValue> = std::iter::once(&s).chain(w.as_ref()).collect();
                match frame_fn("flipPoints", &frames, &[V::str(c.field_str("normalize", "max"))]) {
                    crate::frame_fns::FrameOut::Frame(r) => Ok(V::Frame(Rc::new(from_core(&r)))),
                    crate::frame_fns::FrameOut::Error(e) => Err(e),
                    _ => Ok(V::Null),
                }
            } else {
                decision_sensitivity_cube(&s, w.as_ref().unwrap_or(&s), normalize_of(c))
            };
            r.unwrap_or_else(V::err)
        }
    };
    shown_frame(c, "cube", out)
}
// ─── The core's frame functions ───────────────────────────────────────────────

/// A frame function by name on the core's frames (`engine_frame_fn`), a bailed reading answered as `Bail`.
pub(crate) fn frame_fn(name: &str, frames: &[&FrameValue], args: &[V]) -> crate::frame_fns::FrameOut {
    crate::excel_functions::take_bailed();
    let out = crate::frame_fns::call(name, frames, args);
    if crate::excel_functions::take_bailed() {
        crate::excel_functions::take_thrown();
        return crate::frame_fns::FrameOut::Bail;
    }
    out
}

// ─── Units on columns (unitColumn.ts) ───────────────────────────────────────────

/// A unit's dimension as a column unit's JSON holds it.
fn dim_json(dim: &crate::unit_dims::Dim) -> Json {
    Json::Object(dim.iter().map(|(k, v)| (k.clone(), json_num(*v))).collect())
}

const CURRENCY_SYMBOL: [(&str, &str); 4] = [("$", "usd"), ("€", "eur"), ("£", "gbp"), ("¥", "jpy")];

/// `columnUnitFromSpec`: a currency symbol, or a display unit's id once the format's digits are stripped.
pub(crate) fn column_unit_from_spec(spec: &str) -> Option<Json> {
    let s = js_trim(spec);
    for (sym, id) in CURRENCY_SYMBOL {
        if s.contains(sym) {
            let u = crate::unit_catalog::fc_unit_to_unit(id)?;
            return Some(json!({ "dim": dim_json(&u.dim), "display": id }));
        }
    }
    let token: String = s.chars().filter(|ch| !matches!(ch, '0' | '#' | ',' | '.') && !ch.is_whitespace()).collect();
    if token.is_empty() {
        return None;
    }
    let u = crate::unit_catalog::fc_unit_to_unit(&token)?;
    Some(json!({ "dim": dim_json(&u.dim), "display": token }))
}

/// `parseColumnUnitFromHeader`: `Price (usd)` is the column `Price` in usd; a header with no unit reads whole.
pub(crate) fn parse_column_unit_from_header(header: &str) -> (String, Option<Json>) {
    let name = js_trim(header);
    // /^(.*?)\s*\(([^)]+)\)\s*$/
    let Some(body) = name.strip_suffix(')') else { return (name.to_string(), None) };
    let Some(open) = body.rfind('(') else { return (name.to_string(), None) };
    let spec = &body[open + 1..];
    if spec.is_empty() || spec.contains(')') {
        return (name.to_string(), None);
    }
    let clean = js_trim(&body[..open]);
    match column_unit_from_spec(spec) {
        Some(u) => (if clean.is_empty() { name.to_string() } else { clean.to_string() }, Some(u)),
        None => (name.to_string(), None),
    }
}

/// `tagFrameCellUnit`: a finite number as a cell in the column's unit.
pub(crate) fn tag_cell_unit(v: &V, unit: &Json) -> V {
    let V::Num(n) = v else { return v.clone() };
    if !n.is_finite() {
        return v.clone();
    }
    let display = unit.get("display").and_then(Json::as_str);
    if let Some(u) = display.and_then(crate::unit_catalog::fc_unit_to_unit) {
        return super::units::from_unit(*n, &u, display);
    }
    let dim = unit.get("dim").and_then(Json::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect()).unwrap_or_default();
    super::units::tag(*n, dim, None)
}

/// `tagCubeCellUnit`: a list item by item.
pub(crate) fn tag_cube_cell_unit(v: &V, unit: &Json) -> V {
    match v {
        V::List(l) => list(l.iter().map(|x| tag_cube_cell_unit(x, unit)).collect()),
        other => tag_cell_unit(other, unit),
    }
}

// ─── Cubes (frame.ts) ───────────────────────────────────────────────────────────

pub(crate) fn cube_v(columns: Vec<CubeColumn>) -> V {
    V::Cube(Rc::new(Cube { columns }))
}

pub(crate) fn cube_row_count(c: &Cube) -> usize {
    c.columns.iter().map(|col| col.cells.len()).max().unwrap_or(0)
}

/// `cubeFromColumns`: the names made unique as `makeHeaders` makes them.
pub(crate) fn cube_from_columns(cols: Vec<CubeColumn>) -> V {
    let names: Vec<String> = cols.iter().map(|c| c.name.clone()).collect();
    let names = crate::frame::make_headers(&names, cols.len());
    cube_v(cols.into_iter().zip(names).map(|(c, name)| CubeColumn { name, ..c }).collect())
}

/// `selectCubeRows`.
pub(crate) fn select_cube_rows(cube: &Cube, rows: &[usize]) -> V {
    cube_v(cube.columns.iter().map(|c| CubeColumn { cells: rows.iter().map(|&i| c.cells.get(i).cloned().unwrap_or(V::Null)).collect(), ..c.clone() }).collect())
}

/// `frameFromRows`: a column per position, each inferred (`inferColumn`).
pub(crate) fn frame_from_rows(rows: &[Vec<V>]) -> Frame {
    let ncols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let names = crate::frame::make_headers(&[], ncols);
    let columns = names.iter().enumerate().map(|(j, name)| super::list::infer_column(name, &rows.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect::<Vec<_>>())).collect();
    Frame { columns, total_rows: None, approx: None }
}

/// `widenToFrame`: a table, a list as one row, a value as one cell.
pub(crate) fn widen_to_frame(v: &V) -> Frame {
    match v {
        V::List(rows) if matches!(rows.first(), Some(V::List(_))) => {
            frame_from_rows(&rows.iter().map(|r| if let V::List(r) = r { r.to_vec() } else { Vec::new() }).collect::<Vec<_>>())
        }
        V::List(row) => frame_from_rows(&[row.to_vec()]),
        other => frame_from_rows(&[vec![other.clone()]]),
    }
}

// ─── Add Column, Get Row (frame.ts) ─────────────────────────────────────────────

/// The cube twin of `addColumn`: a Cube carries its unit on its cells, so `unit` tags each number, list items
/// included, and a replaced column keeps its place and format.
fn cube_with_column(cube: &Cube, name: &str, cells: Vec<V>, ty: FrameColType, unit: Option<&Json>) -> V {
    let (clean, _) = parse_column_unit_from_header(name);
    let cells = match unit {
        Some(u) if ty == FrameColType::Number => cells.iter().map(|v| tag_cube_cell_unit(v, u)).collect(),
        _ => cells,
    };
    let col = CubeColumn { name: clean.clone(), cells, ty: Some(ty), format: None };
    let mut cols = cube.columns.clone();
    match cols.iter().position(|c| c.name == clean) {
        Some(at) => {
            let format = cols[at].format.clone();
            cols[at] = CubeColumn { format, ..col };
        }
        None => cols.push(col),
    }
    cube_from_columns(cols)
}

fn add_column(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let values = first(c, "values");
    let name_raw = str_input(c, "name", "");
    let blank = matches!(raw, V::Null) || super::stats::falsy(&values) || matches!(name_raw, V::Null);
    if blank {
        return shown_frame(c, "frame", V::Null);
    }
    let name = trimmed(&name_raw, "nameRaw")?;
    let name = if name.is_empty() { "Col".to_string() } else { name };
    let ty = match c.field_str("addAs", "number") {
        "text" => FrameColType::String,
        t => t.parse().map_err(|_| err(ErrorCode::Value, format!("Add Column can't add a column as \"{t}\"")))?,
    };
    let values = super::stats::items(&values).to_vec();
    if let V::Cube(cube) = &raw {
        let rows = cube_row_count(cube).max(values.len());
        let padded: Vec<V> = (0..rows).map(|i| values.get(i).cloned().unwrap_or(V::Null)).collect();
        let unit = parse_column_unit_from_header(&name).1;
        let out = cube_with_column(cube, &name, padded, ty, unit.as_ref());
        return shown_frame(c, "frame", out);
    }
    let f = match &raw {
        V::Frame(f) => (**f).clone(),
        other => widen_to_frame(other),
    };
    let rows = f.columns.iter().map(|col| col.values.len()).max().unwrap_or(0).max(values.len());
    let padded: Vec<V> = (0..rows).map(|i| values.get(i).cloned().unwrap_or(V::Null)).collect();
    let (clean, unit) = parse_column_unit_from_header(&name);
    let names_only = FrameValue { columns: f.columns.iter().map(|col| FrameColumn::new(col.name.clone(), col.ty, Vec::new())).collect() };
    let at = match frame_fn("addColumn", &[&names_only], &[V::str(&clean), list(Vec::new()), V::str(ty.as_str())]) {
        crate::frame_fns::FrameOut::FrameAnd(out, V::Num(at)) => Some((out, at as usize)),
        _ => None,
    };
    let Some((out, at)) = at else { return Err(thrown("Add Column left a reading to the TS")) };
    let unit = unit.filter(|_| ty == FrameColType::Number);
    let mut columns = f.columns.clone();
    if at < f.columns.len() {
        let col = &mut columns[at];
        col.ty = ty;
        col.values = padded;
        col.raw = None;
        if unit.is_some() {
            col.unit = unit;
        }
    } else {
        columns.push(Column { name: out.columns[at].name.clone(), ty, values: padded, unit, format: None, raw: None });
    }
    shown_frame(c, "frame", frame_v(columns))
}

fn get_row(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let idx = read_role(c, "index", Role::Required);
    if idx.is_sol_error() {
        c.show("cachedResult", V::Null);
        return Ok(vec![("frame".into(), idx)]);
    }
    if matches!(raw, V::Null) {
        return shown_frame(c, "frame", V::Null);
    }
    let i = math_round(super::kit::num(&idx)) - 1.0;
    if let V::Cube(cube) = &raw {
        if i < 0.0 || i >= cube_row_count(cube) as f64 {
            return shown_frame(c, "frame", V::Null);
        }
        return shown_frame(c, "frame", select_cube_rows(cube, &[if i.is_nan() { usize::MAX } else { i as usize }]));
    }
    let f = match &raw {
        V::Frame(f) => (**f).clone(),
        other => widen_to_frame(other),
    };
    if i < 0.0 || i >= f.columns.iter().map(|col| col.values.len()).max().unwrap_or(0) as f64 {
        return shown_frame(c, "frame", V::Null);
    }
    let columns = f
        .columns
        .iter()
        .map(|col| {
            let cell = if i.is_nan() { None } else { col.values.get(i as usize) }.map_or(V::Null, |v| card_cell(&core_cell(v)));
            let raw = col.raw.as_ref().map(|r| {
                let items = r.as_array().cloned().unwrap_or_default();
                let item = if i.is_nan() { None } else { items.get(i as usize).cloned() };
                Json::Array(vec![item.filter(|x| !x.is_null()).unwrap_or(Json::String(String::new()))])
            });
            Column { values: vec![cell], raw, ..col.clone() }
        })
        .collect();
    shown_frame(c, "frame", frame_v(columns))
}

// ─── XLOOKUP (frame.ts) ─────────────────────────────────────────────────────────

/// `keysInDisplayUnit`: a unit key column read as the numbers it shows in its first cell's unit; a key of another
/// dimension never matches.
fn keys_in_display_unit(cells: &[V]) -> Vec<V> {
    use crate::unit_expression::display_magnitude_of;
    let Some(first) = cells.iter().find_map(|v| if let V::Unit(u) = v { Some(u.clone()) } else { None }) else { return cells.to_vec() };
    cells
        .iter()
        .map(|v| match v {
            V::Unit(u) if !crate::unit_dims::dim_equal(&u.dim, &first.dim) => V::Null,
            V::Unit(u) if first.display.is_some() => {
                let shown = crate::unit_dims::UnitCell { display: first.display.clone(), scale: first.scale, offset: first.offset, unit_dim: first.unit_dim.clone(), ..(**u).clone() };
                V::Num(display_magnitude_of(&shown))
            }
            V::Unit(u) => V::Num(u.value),
            other => other.clone(),
        })
        .collect()
}

/// `inferCubeKeyType`: the one kind every filled cell is, text otherwise.
fn infer_cube_key_type(cells: &[V]) -> FrameColType {
    let (mut num, mut bool, mut other) = (false, false, false);
    for v in cells {
        match v {
            V::Null | V::Err(_) => {}
            V::Num(_) | V::Unit(_) => num = true,
            V::Bool(_) => bool = true,
            _ => other = true,
        }
    }
    if other || (num && bool) {
        FrameColType::String
    } else if num {
        FrameColType::Number
    } else if bool {
        FrameColType::Logical
    } else {
        FrameColType::String
    }
}

/// `lookupRowIndex` over a Cube's key column (a frame's read as `frameToCube` reads it): its keys as the numbers
/// they show, matched on the core.
fn cube_lookup_index(cube: &Cube, in_col: &str, lookup: &str, mm: &str, sm: &str) -> Result<i64, V> {
    let Some(key) = cube.columns.iter().find(|k| k.name == in_col) else { return Err(err(ErrorCode::Ref, format!("column \"{in_col}\" not found"))) };
    let rows = cube_row_count(cube);
    let ty = key.ty.unwrap_or_else(|| infer_cube_key_type(&key.cells));
    let cells: Vec<V> = (0..rows).map(|i| key.cells.get(i).cloned().unwrap_or(V::Undef)).collect();
    let keys: Vec<FrameCell> = keys_in_display_unit(&cells).iter().map(core_cell).collect();
    let f = FrameValue { columns: vec![FrameColumn::new(in_col, ty, keys)] };
    match frame_fn("lookupRowIndex", &[&f], &[V::str(in_col), V::str(lookup), V::str(mm), V::str(sm)]) {
        crate::frame_fns::FrameOut::Value(V::Num(i)) => Ok(i as i64),
        crate::frame_fns::FrameOut::Error(e) => Err(V::err(e)),
        _ => Err(thrown("XLOOKUP left a reading to the TS")),
    }
}

/// `frameToCube`: each column's cells in its unit.
pub(crate) fn frame_to_cube(f: &Frame) -> Cube {
    Cube {
        columns: f
            .columns
            .iter()
            .map(|col| CubeColumn {
                name: col.name.clone(),
                cells: match &col.unit {
                    Some(u) => col.values.iter().map(|v| tag_cell_unit(v, u)).collect(),
                    None => col.values.clone(),
                },
                ty: Some(col.ty),
                format: col.format.clone(),
            })
            .collect(),
    }
}

/// `lookupOnCore`: every lookup's match over a frame in one call, each row index (`ret` None) or Return cell
/// (`undefined` where nothing matched), the Return column's unit tagged back on. None where the TS reads the Cube.
fn lookup_on_core(src: &Frame, in_col: &str, ret: Option<&str>, lookups: &[String], mm: &str, sm: &str) -> Result<Option<Vec<V>>, V> {
    if lookups.is_empty() || (ret == Some(in_col) && src.columns.iter().find(|c| c.name == in_col).is_some_and(|c| c.unit.is_some())) {
        return Ok(None);
    }
    let columns = src
        .columns
        .iter()
        .filter(|c| c.name == in_col || Some(c.name.as_str()) == ret)
        .map(|c| {
            let values: Vec<FrameCell> = match (&c.unit, c.name == in_col) {
                (Some(u), true) => keys_in_display_unit(&c.values.iter().map(|v| tag_cell_unit(v, u)).collect::<Vec<_>>()).iter().map(core_cell).collect(),
                _ => c.values.iter().map(core_cell).collect(),
            };
            FrameColumn::new(c.name.clone(), c.ty, values)
        })
        .collect();
    let f = FrameValue { columns };
    let items = list(lookups.iter().map(|l| V::str(l)).collect());
    let r = match ret {
        None => frame_fn("lookupRowIndex", &[&f], &[V::str(in_col), items, V::str(mm), V::str(sm)]),
        Some(r) => frame_fn("lookupCell", &[&f], &[V::str(in_col), V::str(r), items, V::str(mm), V::str(sm)]),
    };
    let out = match r {
        crate::frame_fns::FrameOut::Value(V::List(l)) => l.to_vec(),
        crate::frame_fns::FrameOut::Error(e) => return Err(V::err(e)),
        _ => return Ok(None),
    };
    let unit = ret.and_then(|r| src.columns.iter().find(|c| c.name == r)).and_then(|c| c.unit.clone());
    Ok(Some(match unit {
        Some(u) => out.iter().map(|v| if matches!(v, V::Undef) { V::Undef } else { tag_cell_unit(v, &u) }).collect(),
        None => out,
    }))
}

/// `frameRowAt`: the row as a one-row frame, its columns' units and formats kept.
fn frame_row_at(f: &Frame, i: usize) -> V {
    frame_v(f.columns.iter().map(|c| Column { values: vec![c.values.get(i).cloned().unwrap_or(V::Null)], raw: None, ..c.clone() }).collect())
}

/// `cubeRowAt`.
fn cube_row_at(c: &Cube, i: usize) -> V {
    cube_from_columns(c.columns.iter().map(|col| CubeColumn { cells: vec![col.cells.get(i).cloned().unwrap_or(V::Null)], ..col.clone() }).collect())
}

fn xlookup(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let [lookup_raw, in_raw, ret_raw, fb_raw] = ["lookup", "inColumn", "returnColumn", "ifNotFound"].map(|k| str_input(c, k, ""));
    if [&lookup_raw, &in_raw, &ret_raw, &fb_raw].iter().any(|v| matches!(v, V::Null)) {
        return shown_value(c, V::Null);
    }
    let in_col = trimmed(&in_raw, "inColRaw")?;
    let ret_col = trimmed(&ret_raw, "retColRaw")?;
    let scalar_blank = match &lookup_raw {
        V::List(_) => false,
        other => trimmed(other, "lookupRaw")?.is_empty(),
    };
    if matches!(raw, V::Null) || in_col.is_empty() || ret_col.is_empty() || scalar_blank {
        return shown_value(c, V::Null);
    }
    let tabular = match &raw {
        V::Frame(_) | V::Cube(_) => true,
        V::List(l) => matches!(l.first(), Some(V::List(_))),
        _ => false,
    };
    if !tabular {
        return shown_value(c, err(ErrorCode::Value, "XLOOKUP needs a table or Cube. Combine two Lists with Frame from Lists first."));
    }
    let src_frame: Option<Frame> = match &raw {
        V::Cube(_) => None,
        V::Frame(f) => Some((**f).clone()),
        other => Some(widen_to_frame(other)),
    };
    let src_cube: Cube = match (&raw, &src_frame) {
        (V::Cube(cube), _) => (**cube).clone(),
        (_, Some(f)) => frame_to_cube(f),
        _ => Cube::default(),
    };
    let whole_row = ret_col == "*";
    let fb = trimmed(&fb_raw, "fallbackRaw")?;
    let (mm, sm) = (c.field_str("matchMode", "exact").to_string(), c.field_str("searchMode", "first").to_string());
    let as_text = |v: &V| if super::list::nullish(v) { String::new() } else { js_trim(&crate::excel_functions::js_string_of(v)).to_string() };
    let result = (|| -> Result<V, V> {
        let raws: Vec<V> = match &lookup_raw {
            V::List(l) => l.to_vec(),
            other => vec![other.clone()],
        };
        let lookups: Vec<String> = raws.iter().map(as_text).filter(|t| !t.is_empty()).collect();
        let found = match &src_frame {
            Some(f) => lookup_on_core(f, &in_col, if whole_row { None } else { Some(&ret_col) }, &lookups, &mm, &sm)?,
            None => None,
        };
        let mut k = 0;
        let mut match_one = |v: &V| -> Result<V, V> {
            let lookup = as_text(v);
            if lookup.is_empty() {
                return Ok(V::Null);
            }
            let hit = found.as_ref().map(|f| f.get(k).cloned().unwrap_or(V::Undef));
            k += 1;
            let cell = if whole_row {
                let idx = match hit {
                    Some(h) => super::kit::num(&h) as i64,
                    None => cube_lookup_index(&src_cube, &in_col, &lookup, &mm, &sm)?,
                };
                if idx < 0 {
                    None
                } else {
                    Some(match &src_frame {
                        Some(f) => frame_row_at(f, idx as usize),
                        None => cube_row_at(&src_cube, idx as usize),
                    })
                }
            } else {
                match hit {
                    Some(V::Undef) => None,
                    Some(h) => Some(h),
                    None => {
                        let idx = cube_lookup_index(&src_cube, &in_col, &lookup, &mm, &sm)?;
                        let Some(ret) = src_cube.columns.iter().find(|k| k.name == ret_col) else { return Err(err(ErrorCode::Ref, format!("column \"{ret_col}\" not found"))) };
                        (idx >= 0).then(|| ret.cells.get(idx as usize).cloned().unwrap_or(V::Null))
                    }
                }
            };
            if let Some(cell) = cell {
                return Ok(cell);
            }
            if fb.is_empty() {
                return Ok(err(ErrorCode::NotAvailable, "No row matched the lookup value"));
            }
            let n = crate::jsnum::string_to_number(&fb);
            Ok(if n.is_nan() { V::str(&fb) } else { V::Num(n) })
        };
        match &lookup_raw {
            V::List(l) => l.iter().map(&mut match_one).collect::<Result<Vec<_>, _>>().map(list),
            other => match_one(other),
        }
    })();
    shown_value(c, result.unwrap_or_else(|e| e))
}

fn shown_value(c: &mut Call, v: V) -> Answer {
    c.show("cachedResult", v.clone());
    Ok(vec![("value".into(), v)])
}

// ─── Nest, Unnest (frame.ts) ────────────────────────────────────────────────────

/// `readColumnList`: the names a text list holds, null where it reads blank.
fn column_list(c: &Call, key: &str) -> Option<Vec<String>> {
    match c.read_input(key, list(Vec::new())) {
        V::Null => None,
        v => Some(super::stats::items(&v).iter().filter_map(|x| if let V::Str(s) = x { Some(s.to_string()) } else { None }).collect()),
    }
}

/// `nestFrame`: a row per distinct key, the other columns as a nested table in it.
fn nest_frame(f: &Frame, keys: &[String], name: &str) -> Result<V, V> {
    use crate::frame_fns::FrameOut;
    let args = [list(keys.iter().map(|k| V::str(k)).collect()), V::str(name)];
    let (names, groups) = match frame_fn("nestGroups", &[&to_core(f)], &args) {
        FrameOut::Value(V::List(r)) if r.len() == 2 => {
            let names: Vec<String> = super::stats::items(&r[0]).iter().map(|v| if let V::Str(s) = v { s.to_string() } else { String::new() }).collect();
            let groups: Vec<Vec<usize>> = super::stats::items(&r[1]).iter().map(|g| super::stats::items(g).iter().map(|i| super::kit::num(i) as usize).collect()).collect();
            (names, groups)
        }
        FrameOut::Error(e) => return Err(V::err(e)),
        _ => return Err(thrown("Nest left a reading to the TS")),
    };
    let cell = |col: &Column, i: usize| col.values.get(i).cloned().unwrap_or(V::Null);
    let mut cols: Vec<CubeColumn> = keys
        .iter()
        .enumerate()
        .map(|(k, key)| {
            let col = f.columns.iter().find(|c| &c.name == key).expect("the core found it");
            CubeColumn { name: names[k].clone(), cells: groups.iter().map(|g| cell(col, g[0])).collect(), ty: Some(col.ty), format: col.format.clone() }
        })
        .collect();
    let children: Vec<&Column> = f.columns.iter().filter(|c| !keys.contains(&c.name)).collect();
    let nested = groups
        .iter()
        .map(|g| frame_v(children.iter().map(|c| Column { values: g.iter().map(|&i| cell(c, i)).collect(), raw: None, ..(*c).clone() }).collect()))
        .collect();
    cols.push(CubeColumn { name: names[keys.len()].clone(), cells: nested, ty: None, format: None });
    Ok(cube_from_columns(cols))
}

fn nest(c: &mut Call) -> Answer {
    let f = frame_in(c, "frame");
    let keys = column_list(c, "keys");
    let name_raw = str_input(c, "nestedName", "items");
    let (Some(f), Some(keys), false) = (f, keys, matches!(name_raw, V::Null)) else { return shown_cube(c, V::Null) };
    if keys.is_empty() {
        return shown_cube(c, V::Null);
    }
    let name = trimmed(&name_raw, "nameRaw")?;
    let name = if name.is_empty() { "items".to_string() } else { name };
    let out = nest_frame(&f, &keys, &name).unwrap_or_else(|e| e);
    shown_cube(c, out)
}

fn shown_cube(c: &mut Call, v: V) -> Answer {
    c.show("cachedResult", v.clone());
    Ok(vec![("cube".into(), v)])
}

/// `inferColumn` under the name given, the format kept.
fn inferred(name: &str, cells: &[V], format: Option<Json>) -> Column {
    let mut col = super::list::infer_column(name, cells);
    if format.is_some() {
        col.format = format;
    }
    col
}

/// `unnestCube`: each nested row (a list's items, a table's or a Cube's rows) under a copy of its parent row.
fn unnest_cube(c: &Cube, nested_name: &str) -> Result<V, V> {
    let Some(at) = c.columns.iter().position(|col| col.name == nested_name) else { return Err(err(ErrorCode::Ref, format!("column \"{nested_name}\" not found"))) };
    let flat: Vec<&CubeColumn> = c.columns.iter().enumerate().filter(|&(j, _)| j != at).map(|(_, col)| col).collect();
    let nested = &c.columns[at];
    let (mut saw_list, mut saw_frame, mut saw_cube) = (false, false, false);
    for cell in &nested.cells {
        match cell {
            V::List(l) => saw_list |= !l.is_empty(),
            V::Frame(_) => saw_frame = true,
            V::Cube(_) => saw_cube = true,
            _ => {}
        }
    }
    if [saw_list, saw_frame, saw_cube].iter().filter(|b| **b).count() > 1 {
        return Err(err(ErrorCode::Type, "nested cells must all be lists, all tables, or all cubes"));
    }
    if !saw_list && !saw_frame && !saw_cube {
        saw_list = nested.cells.iter().any(|v| matches!(v, V::List(_)));
    }
    let rows = cube_row_count(c);
    let at_cell = |col: &CubeColumn, i: usize| col.cells.get(i).cloned().unwrap_or(V::Null);
    if saw_list {
        let mut flat_vals: Vec<Vec<V>> = vec![Vec::new(); flat.len()];
        let mut exploded = Vec::new();
        for i in 0..rows {
            let items = match nested.cells.get(i) {
                Some(V::List(l)) => l.to_vec(),
                _ => Vec::new(),
            };
            let push_parent = |vals: &mut Vec<Vec<V>>| flat.iter().enumerate().for_each(|(k, fc)| vals[k].push(at_cell(fc, i)));
            if items.is_empty() {
                push_parent(&mut flat_vals);
                exploded.push(V::Null);
            } else {
                for item in items {
                    push_parent(&mut flat_vals);
                    exploded.push(if matches!(item, V::Undef) { V::Null } else { item });
                }
            }
        }
        let mut columns: Vec<Column> = flat.iter().enumerate().map(|(k, fc)| inferred(&fc.name, &flat_vals[k], fc.format.clone())).collect();
        columns.push(inferred(&nested.name, &exploded, None));
        return Ok(frame_v(columns));
    }
    if saw_cube {
        let schema: Vec<CubeColumn> = nested.cells.iter().find_map(|v| if let V::Cube(k) = v { Some(k.columns.clone()) } else { None }).unwrap_or_default();
        let mut flat_vals: Vec<Vec<V>> = vec![Vec::new(); flat.len()];
        let mut child_vals: Vec<Vec<V>> = vec![Vec::new(); schema.len()];
        for i in 0..rows {
            let Some(V::Cube(child)) = nested.cells.get(i) else { continue };
            for r in 0..cube_row_count(child) {
                flat.iter().enumerate().for_each(|(k, fc)| flat_vals[k].push(at_cell(fc, i)));
                for (k, cc) in schema.iter().enumerate() {
                    child_vals[k].push(child.columns.iter().find(|x| x.name == cc.name).map_or(V::Null, |col| at_cell(col, r)));
                }
            }
        }
        let names: Vec<String> = flat.iter().map(|c| c.name.clone()).chain(schema.iter().map(|c| c.name.clone())).collect();
        let names = crate::frame::make_headers(&names, names.len());
        let mut cols: Vec<CubeColumn> = flat.iter().enumerate().map(|(k, fc)| CubeColumn { name: names[k].clone(), cells: flat_vals[k].clone(), ty: fc.ty, format: fc.format.clone() }).collect();
        cols.extend(schema.iter().enumerate().map(|(k, cc)| CubeColumn { name: names[flat.len() + k].clone(), cells: child_vals[k].clone(), ty: cc.ty, format: cc.format.clone() }));
        return Ok(cube_from_columns(cols));
    }
    let schema: Vec<Column> = nested.cells.iter().find_map(|v| if let V::Frame(f) = v { Some(f.columns.clone()) } else { None }).unwrap_or_default();
    let mut flat_vals: Vec<Vec<V>> = vec![Vec::new(); flat.len()];
    let mut child_vals: Vec<Vec<V>> = vec![Vec::new(); schema.len()];
    for i in 0..rows {
        let Some(V::Frame(child)) = nested.cells.get(i) else { continue };
        for r in 0..child.columns.iter().map(|col| col.values.len()).max().unwrap_or(0) {
            flat.iter().enumerate().for_each(|(k, fc)| flat_vals[k].push(at_cell(fc, i)));
            for (k, cc) in schema.iter().enumerate() {
                child_vals[k].push(child.columns.iter().find(|x| x.name == cc.name).and_then(|col| col.values.get(r).cloned()).unwrap_or(V::Null));
            }
        }
    }
    let names: Vec<String> = flat.iter().map(|c| c.name.clone()).chain(schema.iter().map(|c| c.name.clone())).collect();
    let names = crate::frame::make_headers(&names, names.len());
    let mut columns: Vec<Column> = flat.iter().enumerate().map(|(k, fc)| inferred(&names[k], &flat_vals[k], fc.format.clone())).collect();
    columns.extend(schema.iter().enumerate().map(|(k, cc)| Column {
        name: names[flat.len() + k].clone(),
        ty: cc.ty,
        values: child_vals[k].clone(),
        unit: cc.unit.clone(),
        format: cc.format.clone(),
        raw: None,
    }));
    Ok(frame_v(columns))
}

fn unnest(c: &mut Call) -> Answer {
    let cube = match first(c, "cube") {
        V::Cube(k) => Some(k),
        _ => None,
    };
    let col_raw = str_input(c, "column", "");
    let (Some(cube), false) = (cube, matches!(col_raw, V::Null)) else { return shown_frame(c, "frame", V::Null) };
    let col = trimmed(&col_raw, "colRaw")?;
    if col.is_empty() {
        return shown_frame(c, "frame", V::Null);
    }
    let out = unnest_cube(&cube, &col).unwrap_or_else(|e| e);
    shown_frame(c, "frame", out)
}

// ─── Build Cube, Cube Columns (cube.ts) ─────────────────────────────────────────

/// `literalCell`: the typed literal, else the text one, else blank.
fn literal_cell(c: &Call, key: &str) -> V {
    if c.literals.contains_key(key) {
        return c.literal(key);
    }
    if c.string_literals.contains_key(key) {
        return c.string_literal(key);
    }
    V::Null
}

/// Each value input's cell, by its key's prefix in the card's order: the cable's value, else the literal.
fn value_cells(c: &Call, prefix: char) -> Vec<V> {
    c.sockets
        .iter()
        .map(|s| s.key.as_str())
        .filter(|k| k.starts_with(prefix))
        .map(|k| match c.wired(k) {
            Some([v, ..]) => v.clone(),
            _ => literal_cell(c, k),
        })
        .collect()
}

fn build_cube(c: &mut Call) -> Answer {
    let cells = value_cells(c, 'v');
    let name_raw = str_input(c, "name", "");
    if matches!(name_raw, V::Null) {
        return shown_cube(c, V::Null);
    }
    let name = trimmed(&name_raw, "nameRaw")?;
    let name = if name.is_empty() { "Items".to_string() } else { name };
    let out = cube_from_columns(vec![CubeColumn { name, cells, ty: None, format: None }]);
    shown_cube(c, out)
}

/// `cubeColumnFromValue`: a Cube's first column, a table as one cell, a list's items, a value as one cell.
fn cube_column_from_value(v: &V) -> Vec<V> {
    match v {
        V::Null | V::Undef => Vec::new(),
        V::Cube(k) => k.columns.first().map(|col| col.cells.clone()).unwrap_or_default(),
        V::List(l) => l.to_vec(),
        other => vec![other.clone()],
    }
}

fn cube_columns(c: &mut Call) -> Answer {
    let names = match c.wired("names") {
        Some([v, ..]) => v.clone(),
        _ => V::Null,
    };
    let name_at = |i: usize| -> Result<String, V> {
        let item = match &names {
            V::List(l) => l.get(i).cloned().unwrap_or(V::Null),
            V::Str(s) => s.encode_utf16().nth(i).map_or(V::Null, |u| V::str(&String::from_utf16_lossy(&[u]))),
            _ => V::Null,
        };
        match item {
            V::Null | V::Undef => Ok(String::new()),
            other => trimmed(&other, "(names[i] ?? \"\")"),
        }
    };
    let mut cols = Vec::new();
    for (i, v) in value_cells(c, 'c').iter().enumerate() {
        let name = name_at(i)?;
        cols.push((if name.is_empty() { format!("Col{}", i + 1) } else { name }, cube_column_from_value(v)));
    }
    let max = cols.iter().map(|(_, cells)| cells.len()).max().unwrap_or(0);
    let padded = cols
        .into_iter()
        .map(|(name, cells)| CubeColumn { name, cells: (0..max).map(|r| cells.get(r).filter(|v| !matches!(v, V::Undef)).cloned().unwrap_or(V::Null)).collect(), ty: None, format: None })
        .collect();
    shown_cube(c, cube_from_columns(padded))
}

// ─── Nest Join (cube.ts) ────────────────────────────────────────────────────────

/// `getColumn`: by name, or by a 1-based position written as digits.
fn card_column<'a>(f: &'a Frame, name: &str) -> Option<&'a Column> {
    let key = js_trim(name);
    if let Some(col) = f.columns.iter().find(|c| c.name == key) {
        return Some(col);
    }
    if !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit()) {
        let i = key.parse::<usize>().ok()?;
        return (i >= 1).then(|| f.columns.get(i - 1)).flatten();
    }
    None
}

/// `keyId`: the text a cell keys a join by, a unit cell by its dimension, currency and rounded base value.
fn key_id(v: &V) -> String {
    match v {
        V::Null | V::Undef => "~null".into(),
        V::Bool(b) => if *b { "1" } else { "0" }.into(),
        V::Err(e) => format!("~err:{}", e.code),
        V::Unit(u) if u.ratio => crate::jsnum::number_to_string(u.value),
        V::Unit(u) => {
            let currency = crate::unit_dims::dim_equal(&u.dim, &crate::unit_dims::Dim::from([("currency".to_string(), 1.0)]));
            let cur = if currency { u.display.clone().unwrap_or_default() } else { String::new() };
            let offset = u.display.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit).and_then(|x| x.offset).unwrap_or(0.0);
            let key = crate::unit_value::round_at_larger_term(u.value, math_max((u.value - offset).abs(), offset.abs()));
            let cur = if cur.is_empty() { String::new() } else { format!(":{cur}") };
            format!("~u:{}{cur}:{}", crate::unit_lists::format_dim(&u.dim), crate::jsnum::number_to_string(key))
        }
        other => crate::excel_functions::js_string_of(other),
    }
}

/// `keyIdInColumn`: a number in a unit column keys as the unit cell it shows.
fn key_id_in_column(v: &V, unit: Option<&Json>) -> String {
    match (unit, v) {
        (Some(u), V::Num(n)) if n.is_finite() => key_id(&tag_cell_unit(v, u)),
        _ => key_id(v),
    }
}

/// `cellKeyId`: none for a blank, an error or a nested cell.
fn cell_key_id(v: &V, unit: Option<&Json>) -> Option<String> {
    match v {
        V::Null | V::Undef | V::Err(_) => None,
        V::Num(_) | V::Str(_) | V::Bool(_) => Some(key_id_in_column(v, unit)),
        V::Unit(_) => Some(key_id(v)),
        _ => None,
    }
}

/// `subFrame`: the rows picked, their typed text kept.
fn sub_frame(f: &Frame, rows: &[usize]) -> V {
    frame_v(
        f.columns
            .iter()
            .map(|c| Column {
                values: rows.iter().map(|&i| c.values.get(i).cloned().unwrap_or(V::Null)).collect(),
                raw: c.raw.as_ref().map(|r| {
                    let items = r.as_array().cloned().unwrap_or_default();
                    Json::Array(rows.iter().map(|&i| items.get(i).cloned().filter(|x| !x.is_null()).unwrap_or(Json::String(String::new()))).collect())
                }),
                ..c.clone()
            })
            .collect(),
    )
}

/// `relateFramesToCube`: each parent row with the child rows sharing its key as a nested table.
fn relate_frames(parent: &Frame, child: &V, key: &str, nested_name: &str) -> Option<V> {
    let p_key = card_column(parent, key)?;
    let (c_cells, c_unit, c_rows): (Vec<V>, Option<Json>, usize) = match child {
        V::Cube(k) => (k.columns.iter().find(|c| c.name == key)?.cells.clone(), None, cube_row_count(k)),
        V::Frame(f) => {
            let col = card_column(f, key)?;
            (col.values.clone(), col.unit.clone(), f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0))
        }
        _ => return None,
    };
    let mut by_key: std::collections::HashMap<String, Vec<usize>> = std::collections::HashMap::new();
    for i in 0..c_rows {
        if let Some(id) = cell_key_id(c_cells.get(i).unwrap_or(&V::Null), c_unit.as_ref()) {
            by_key.entry(id).or_default().push(i);
        }
    }
    let p_rows = parent.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let nested = js_trim(nested_name);
    let mut names: Vec<String> = parent.columns.iter().map(|c| c.name.clone()).collect();
    names.push(if nested.is_empty() { "items".into() } else { nested.to_string() });
    let names = crate::frame::make_headers(&names, parent.columns.len() + 1);
    let mut columns: Vec<CubeColumn> = parent
        .columns
        .iter()
        .enumerate()
        .map(|(j, c)| {
            let cells = (0..p_rows)
                .map(|i| {
                    let v = c.values.get(i).cloned().unwrap_or(V::Null);
                    match &c.unit {
                        Some(u) => tag_cell_unit(&v, u),
                        None => v,
                    }
                })
                .collect();
            CubeColumn { name: names[j].clone(), cells, ty: Some(c.ty), format: None }
        })
        .collect();
    let nested_cells = (0..p_rows)
        .map(|i| {
            let id = key_id_in_column(p_key.values.get(i).unwrap_or(&V::Null), p_key.unit.as_ref());
            let rows = by_key.get(&id).cloned().unwrap_or_default();
            match child {
                V::Cube(k) => select_cube_rows(k, &rows),
                V::Frame(f) => sub_frame(f, &rows),
                _ => V::Null,
            }
        })
        .collect();
    columns.push(CubeColumn { name: names[parent.columns.len()].clone(), cells: nested_cells, ty: None, format: None });
    Some(cube_v(columns))
}

/// `relateCubeToFrame`: the join made inside the Cube's first nested column, at whatever depth.
fn relate_cube(parent: &Cube, child: &V, key: &str, nested_name: &str) -> V {
    let Some(at) = parent.columns.iter().position(|c| c.cells.iter().any(|v| matches!(v, V::Frame(_) | V::Cube(_)))) else {
        return V::Cube(Rc::new(parent.clone()));
    };
    let cells = parent.columns[at]
        .cells
        .iter()
        .map(|cell| match cell {
            V::Cube(k) => relate_cube(k, child, key, nested_name),
            V::Frame(f) => relate_frames(f, child, key, nested_name).unwrap_or_else(|| cell.clone()),
            other => other.clone(),
        })
        .collect();
    let mut cols = parent.columns.clone();
    cols[at] = CubeColumn { name: cols[at].name.clone(), cells, ty: None, format: None };
    cube_v(cols)
}

fn nest_join(c: &mut Call) -> Answer {
    let parent = first(c, "parent");
    let child = match first(c, "child") {
        V::Null => None,
        v @ (V::Cube(_) | V::Frame(_)) => Some(v),
        other => Some(V::Frame(Rc::new(widen_to_frame(&other)))),
    };
    let key_raw = str_input(c, "key", "");
    let name_raw = str_input(c, "name", "");
    if matches!(key_raw, V::Null) || matches!(name_raw, V::Null) {
        return shown_cube(c, V::Null);
    }
    let key = trimmed(&key_raw, "keyRaw")?;
    let name = trimmed(&name_raw, "nameRaw")?;
    let Some(child) = child.filter(|_| !key.is_empty()) else { return shown_cube(c, V::Null) };
    let out = match &parent {
        V::Cube(k) => relate_cube(k, &child, &key, &name),
        V::Frame(f) => relate_frames(f, &child, &key, &name).unwrap_or(V::Null),
        V::Null => V::Null,
        _ => err(ErrorCode::Type, "Nest Join parent must be a Frame or a Cube"),
    };
    shown_cube(c, out)
}

// ─── Cube Rollup (cube.ts) ──────────────────────────────────────────────────────

/// A unit cell's column unit, `{ dim, display }`.
fn cell_column_unit(u: &crate::unit_dims::UnitCell) -> Json {
    let mut o = serde_json::Map::new();
    o.insert("dim".into(), dim_json(&u.dim));
    if let Some(d) = &u.display {
        o.insert("display".into(), Json::String(d.clone()));
    }
    Json::Object(o)
}

/// `matrixCellsFromList`: each unit cell as the number it shows, and the one unit they share, if they do.
pub(crate) fn matrix_cells_from_list(cells: &[V]) -> (Vec<V>, Option<Json>) {
    let mags = cells.iter().map(|v| if let V::Unit(u) = v { V::Num(crate::unit_expression::display_magnitude_of(u)) } else { v.clone() }).collect();
    let mut unit: Option<&crate::unit_dims::UnitCell> = None;
    for v in cells {
        let V::Unit(u) = v else { continue };
        match unit {
            None => unit = Some(u),
            Some(first) if crate::unit_dims::dim_equal(&first.dim, &u.dim) && first.display.as_deref().unwrap_or("") == u.display.as_deref().unwrap_or("") => {}
            Some(_) => return (mags, None),
        }
    }
    (mags, unit.map(cell_column_unit))
}

fn unit_dim(unit: &Json) -> crate::unit_dims::Dim {
    unit.get("dim").and_then(Json::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect()).unwrap_or_default()
}

fn unit_display(unit: Option<&Json>) -> Option<&str> {
    unit?.get("display").and_then(Json::as_str).filter(|d| !d.is_empty())
}

pub(crate) fn affine_display(d: &str) -> bool {
    crate::unit_catalog::fc_unit_to_unit(d).and_then(|u| u.offset).is_some_and(|o| o != 0.0)
}

enum Plan {
    Keep,
    Scale(f64),
    Refuse(V),
}

/// `aggUnitPlan`: how an aggregate answers over a column in `unit` ([[C25]] firstClassUnits): its cells, and its unit.
fn agg_unit_plan(op: &str, unit: Option<&Json>) -> (Plan, Option<Json>) {
    use crate::unit_value::{unit_error, READINGS_ADD, READINGS_SCALE};
    let refused = match op {
        "sum" => Some(READINGS_ADD),
        "product" | "percentof" => Some(READINGS_SCALE),
        _ => None,
    };
    let delta = match op {
        "stdev" | "stdevp" => Some(1),
        "var" | "varp" => Some(2),
        _ => None,
    };
    let keeps = matches!(op, "sum" | "avg" | "min" | "max" | "median" | "mode" | "first" | "last");
    let pow = |dim: crate::unit_dims::Dim, k: f64| json!({ "dim": dim_json(&dim.into_iter().map(|(a, e)| (a, e * k)).collect()) });
    let display = unit_display(unit);
    let scale = display.filter(|d| affine_display(d)).map(|d| crate::unit_catalog::fc_unit_to_unit(d).map_or(1.0, |u| u.scale));
    let kept = unit.filter(|_| keeps || delta == Some(1)).cloned();
    let Some(scale) = scale else {
        if delta != Some(2) {
            return (Plan::Keep, kept);
        }
        let linear = display.and_then(crate::unit_catalog::fc_unit_to_unit).map(|u| u.scale).filter(|s| *s != 1.0).unwrap_or(1.0);
        let k = linear * linear;
        return (if k == 1.0 { Plan::Keep } else { Plan::Scale(k) }, unit.map(|u| pow(unit_dim(u), 2.0)));
    };
    if let Some(r) = refused {
        return (Plan::Refuse(V::err(unit_error(r))), None);
    }
    match delta {
        None => (Plan::Keep, kept),
        Some(d) => {
            let dim = unit.map(unit_dim).unwrap_or_else(|| crate::unit_dims::Dim::from([("temperature".to_string(), 1.0)]));
            (Plan::Scale(if d == 2 { scale * scale } else { scale }), Some(pow(dim, d as f64)))
        }
    }
}

/// `typedColumn` as text: each filled cell as the text it reads.
fn text_column(name: &str, cells: &[V]) -> Column {
    let values = cells
        .iter()
        .map(|v| match v {
            V::Null | V::Undef => V::Null,
            V::Err(_) | V::Str(_) => v.clone(),
            other => V::str(&crate::excel_functions::js_string_of(other)),
        })
        .collect();
    Column { name: name.to_string(), ty: FrameColType::String, values, unit: None, format: None, raw: None }
}

/// A nested table's column to roll up: its cells, type and unit.
type Nested = (Vec<V>, Option<FrameColType>, Option<Json>);

fn cube_rollup(c: &mut Call) -> Answer {
    let Some(cube) = (match first(c, "cube") {
        V::Cube(k) => Some(k),
        _ => None,
    }) else {
        return shown_frame(c, "frame", V::Null);
    };
    let [nested_raw, col_raw, as_raw] = [("nested", ""), ("column", ""), ("as", "Total")].map(|(k, d)| str_input(c, k, d));
    if [&nested_raw, &col_raw, &as_raw].iter().any(|v| matches!(v, V::Null)) {
        return shown_frame(c, "frame", V::Null);
    }
    let nested_name = trimmed(&nested_raw, "nestedRaw")?;
    let col = trimmed(&col_raw, "colRaw")?;
    let out_name = trimmed(&as_raw, "asRaw")?;
    let out_name = if out_name.is_empty() { "Total".to_string() } else { out_name };
    let at = cube.columns.iter().position(|k| k.name == nested_name);
    if nested_name.is_empty() || col.is_empty() {
        return shown_frame(c, "frame", V::Null);
    }
    let Some(at) = at else { return shown_frame(c, "frame", err(ErrorCode::Ref, format!("nested column \"{nested_name}\" not found"))) };
    let agg = c.field_str("agg", "sum").to_string();
    let flat: Vec<&CubeColumn> = cube.columns.iter().enumerate().filter(|&(j, _)| j != at).map(|(_, k)| k).collect();
    let nested = &cube.columns[at];
    let rows = cube_row_count(&cube);
    let mut flat_vals: Vec<Vec<V>> = vec![Vec::new(); flat.len()];
    let mut rolled: Vec<V> = Vec::new();
    let mut text_rolled = false;
    for i in 0..rows {
        for (k, fc) in flat.iter().enumerate() {
            flat_vals[k].push(fc.cells.get(i).cloned().unwrap_or(V::Null));
        }
        let read: Option<Result<Nested, V>> = match nested.cells.get(i) {
            Some(V::Frame(f)) => Some(match f.columns.iter().find(|k| k.name == col) {
                None => Err(err(ErrorCode::Ref, format!("column \"{col}\" not found in nested frame"))),
                Some(fc) => Ok((fc.values.clone(), Some(fc.ty), fc.unit.clone())),
            }),
            Some(V::Cube(k)) => Some(match k.columns.iter().find(|x| x.name == col) {
                None => Err(err(ErrorCode::Ref, format!("column \"{col}\" not found in nested cube"))),
                Some(cc) if cc.cells.iter().any(|v| matches!(v, V::Cube(_) | V::Frame(_) | V::List(_))) => {
                    Err(err(ErrorCode::Shape, format!("column \"{col}\" holds nested cells; roll up a flat column")))
                }
                Some(cc) => {
                    let (mags, unit) = matrix_cells_from_list(&cc.cells);
                    Ok(match &cc.ty {
                        Some(t) => (mags, Some(*t), unit),
                        None => {
                            let r = super::list::infer_column(&col, &mags);
                            (r.values, Some(r.ty), unit)
                        }
                    })
                }
            }),
            _ => None,
        };
        let Some(read) = read else {
            rolled.push(V::Null);
            continue;
        };
        let unit = read.as_ref().ok().and_then(|r| r.2.clone());
        let (plan, plan_unit) = agg_unit_plan(&agg, unit.as_ref());
        let r = match read {
            Err(e) => e,
            Ok((values, ty, _)) => {
                let cells: Vec<FrameCell> = values.iter().map(core_cell).collect();
                let op: crate::frame_verbs::AggOp = agg.parse().map_err(|_| err(ErrorCode::Name, format!("Unknown aggregation \"{agg}\"")))?;
                let v = card_cell(&crate::frame_verbs::aggregate_group(&cells, op, ty));
                match plan {
                    Plan::Keep => v,
                    Plan::Scale(k) => match v {
                        V::Num(n) if n.is_finite() => V::Num(n * k),
                        other => other,
                    },
                    Plan::Refuse(e) => e,
                }
            }
        };
        if matches!(r, V::Str(_)) {
            text_rolled = true;
        }
        rolled.push(match &plan_unit {
            Some(u) => tag_cell_unit(&r, u),
            None => r,
        });
    }
    let mut names: Vec<String> = flat.iter().map(|k| k.name.clone()).collect();
    names.push(out_name);
    let names = crate::frame::make_headers(&names, flat.len() + 1);
    let mut columns: Vec<Column> = flat.iter().enumerate().map(|(k, _)| super::list::infer_column(&names[k], &flat_vals[k])).collect();
    let last = &names[flat.len()];
    columns.push(if text_rolled {
        text_column(last, &rolled)
    } else {
        let (mags, unit) = matrix_cells_from_list(&rolled);
        Column { name: last.clone(), ty: FrameColType::Number, values: mags, unit, format: None, raw: None }
    });
    shown_frame(c, "frame", frame_v(columns))
}

// ─── Decision Matrix (frame.ts) ─────────────────────────────────────────────────

use crate::decision::{Normalize, Resolved};

fn round4(n: f64) -> f64 {
    let r = math_round(n * 1e4) / 1e4;
    if r == 0.0 { 0.0 } else { r }
}

/// `rankOptions`: the ranking, the input row behind each of its rows, and where its Score column sits (Rank follows).
fn rank_options(f: &FrameValue, r: &Resolved, normalize: Normalize, breakdown: bool, failed: &[Vec<String>], skip_fill: &[String]) -> Result<(FrameValue, Vec<usize>, usize), SolError> {
    use crate::decision::{decision_scores, filled_in, frame_rows, sort_by_num};
    let rows = crate::frame::frame_row_count(f);
    let pass: Vec<usize> = (0..rows).filter(|&i| failed[i].is_empty()).collect();
    let out_: Vec<usize> = (0..rows).filter(|&i| !failed[i].is_empty()).collect();
    let weights = r.weights.as_deref();
    let all = decision_scores(f, weights, normalize, &r.overrides)?;
    let sub;
    let ds = if pass.len() == rows {
        Some(&all)
    } else if !pass.is_empty() {
        sub = decision_scores(&frame_rows(f, &pass), weights, normalize, &r.overrides)?;
        Some(&sub)
    } else {
        None
    };
    let mut order: Vec<(f64, usize, usize)> = pass.iter().enumerate().map(|(k, &row)| (ds.map_or(0.0, |d| d.scores[k]), k, row)).collect();
    sort_by_num(&mut order, |a, b| b.0 - a.0);
    let mut rank: Vec<f64> = Vec::with_capacity(order.len());
    for (n, o) in order.iter().enumerate() {
        rank.push(if n > 0 && o.0 == order[n - 1].0 { rank[n - 1] } else { (n + 1) as f64 });
    }
    let nulls = |n: usize| std::iter::repeat_n(FrameCell::Null, n);
    let mut out: Vec<FrameColumn> = vec![FrameColumn::new(
        all.label_name.clone(),
        FrameColType::String,
        order.iter().map(|o| all.labels[o.2].clone()).chain(out_.iter().map(|&i| all.labels[i].clone())).collect(),
    )];
    if breakdown {
        for (j, name) in all.criteria.iter().enumerate() {
            let ds = ds.unwrap_or(&all);
            out.push(FrameColumn::new(name.clone(), FrameColType::Number, order.iter().map(|o| FrameCell::Num(round4(ds.contrib[j][o.1]))).chain(nulls(out_.len())).collect()));
        }
    }
    let score_at = out.len();
    out.push(FrameColumn::new("Score", FrameColType::Number, order.iter().map(|o| FrameCell::Num(o.0)).chain(nulls(out_.len())).collect()));
    out.push(FrameColumn::new("Rank", FrameColType::Number, rank.iter().map(|&r| FrameCell::Num(r)).chain(nulls(out_.len())).collect()));
    if !out_.is_empty() {
        out.push(FrameColumn::new("Ruled out by", FrameColType::String, nulls(order.len()).chain(out_.iter().map(|&i| FrameCell::str(&failed[i].join(", ")))).collect()));
    }
    let fills = filled_in(f, skip_fill);
    if pass.iter().any(|&i| !fills[i].is_empty()) {
        let text = |i: usize| if !fills[i].is_empty() && failed[i].is_empty() { FrameCell::str(&fills[i].join(", ")) } else { FrameCell::Null };
        out.push(FrameColumn::new("Filled in", FrameColType::String, order.iter().map(|o| text(o.2)).chain(nulls(out_.len())).collect()));
    }
    let names = crate::frame::make_headers(&out.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), out.len());
    let frame = FrameValue { columns: out.into_iter().zip(names).map(|(c, name)| FrameColumn { name, ..c }).collect() };
    let at = order.iter().map(|o| o.2).chain(out_.iter().copied()).collect();
    Ok((frame, at, score_at))
}

/// A ranked table, the input row behind each of its rows, and where its Score and Rank columns sit.
struct Ranked {
    table: V,
    at: Vec<usize>,
    score_at: usize,
    rank_at: usize,
}

type Best = Option<(V, f64)>;

fn table_rows(t: &V) -> usize {
    match t {
        V::Frame(f) => f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0),
        V::Cube(k) => cube_row_count(k),
        _ => 0,
    }
}

/// A table's columns as name, type and cells, whichever kind it is.
fn table_columns(t: &V) -> Vec<(String, Option<FrameColType>, Vec<V>)> {
    match t {
        V::Frame(f) => f.columns.iter().map(|c| (c.name.clone(), Some(c.ty), c.values.clone())).collect(),
        V::Cube(k) => k.columns.iter().map(|c| (c.name.clone(), c.ty, c.cells.clone())).collect(),
        _ => Vec::new(),
    }
}

/// `flatCubeToFrame(c, "scalar")`: the Cube's flat columns as a frame, cells in one unit read in it.
fn flat_cube_scalar(c: &Cube) -> FrameValue {
    let rows = cube_row_count(c);
    let nested = |col: &CubeColumn| col.cells.iter().any(|v| matches!(v, V::Cube(_) | V::Frame(_) | V::List(_)));
    FrameValue {
        columns: c
            .columns
            .iter()
            .filter(|col| !nested(col))
            .map(|col| {
                let (mags, unit) = if col.cells.iter().any(|v| matches!(v, V::Unit(_))) { matrix_cells_from_list(&col.cells) } else { (col.cells.clone(), None) };
                let cells: Vec<FrameCell> = if unit.is_some() { mags } else { col.cells.iter().map(|v| if let V::Unit(u) = v { V::Num(u.value) } else { v.clone() }).collect() }.iter().map(core_cell).collect();
                crate::frame_fns::typed_column(col.name.clone(), &cells, rows, col.ty)
            })
            .collect(),
    }
}

/// `rankAny`: a frame ranked as the Decision Matrix ranks it, a Cube with its nested choices.
fn rank_any(t: &V, wf: Option<&FrameValue>, normalize: Normalize, breakdown: bool) -> Result<Ranked, SolError> {
    if let V::Cube(k) = t {
        return rank_cube(k, wf, normalize, breakdown);
    }
    let V::Frame(f) = t else { return Err(crate::error_value::sol_error(ErrorCode::Value, "not a table")) };
    let f = to_core(f);
    let r = crate::decision::resolve_weights(wf, &crate::decision::criteria_names(&f))?;
    let failed = crate::decision::decision_screen(&f, r.bounds.as_deref());
    let (frame, at, score_at) = rank_options(&f, &r, normalize, breakdown, &failed, &[])?;
    Ok(Ranked { table: V::Frame(Rc::new(from_core(&frame))), at, score_at, rank_at: score_at + 1 })
}

/// Rows of a table, as `frameRows` or `selectCubeRows` picks them.
fn table_pick(t: &V, rows: &[usize]) -> V {
    match t {
        V::Cube(k) => select_cube_rows(k, rows),
        V::Frame(f) => frame_v(f.columns.iter().map(|c| Column { values: rows.iter().map(|&i| c.values.get(i).cloned().unwrap_or(V::Null)).collect(), ..c.clone() }).collect()),
        other => other.clone(),
    }
}

/// `withinGroup`: a slice of a pooled ranking with its ranks recounted within the slice, and its best row.
fn within_group(t: &V, score_at: usize, rank_at: usize) -> (V, Best) {
    let cols = table_columns(t);
    let scores = cols.get(score_at).map(|c| c.2.clone()).unwrap_or_default();
    let mut ranks: Vec<V> = Vec::new();
    for (n, s) in scores.iter().enumerate() {
        let r = if super::list::nullish(s) {
            V::Null
        } else if n > 0 && strict_eq(&scores[n - 1], s) {
            ranks[n - 1].clone()
        } else {
            V::Num((n + 1) as f64)
        };
        ranks.push(r);
    }
    let label = cols.first().and_then(|c| c.2.first().cloned()).filter(|v| !matches!(v, V::Undef)).unwrap_or(V::Null);
    let best = match scores.first() {
        Some(V::Num(s)) => Some((label, *s)),
        _ => None,
    };
    let table = match t {
        V::Cube(k) => cube_from_columns(k.columns.iter().enumerate().map(|(j, c)| if j == rank_at { CubeColumn { cells: ranks.clone(), ..c.clone() } } else { c.clone() }).collect()),
        V::Frame(f) => frame_v(f.columns.iter().enumerate().map(|(j, c)| if j == rank_at { Column { values: ranks.clone(), ..c.clone() } } else { c.clone() }).collect()),
        other => other.clone(),
    };
    (table, best)
}

/// JS `===` on cells: primitives by value, objects never.
fn strict_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        _ => false,
    }
}

/// `poolTables`: tables with the same columns stacked into one, frames as a frame and anything with a Cube as a Cube.
fn pool_tables(ts: &[V]) -> V {
    let mut names: Vec<String> = Vec::new();
    let mut types: Vec<Option<FrameColType>> = Vec::new();
    for t in ts {
        for (name, ty, _) in table_columns(t) {
            if !names.contains(&name) {
                names.push(name);
                types.push(ty);
            }
        }
    }
    if ts.iter().all(|t| matches!(t, V::Frame(_))) {
        let frames: Vec<&Frame> = ts.iter().filter_map(|t| if let V::Frame(f) = t { Some(&**f) } else { None }).collect();
        return frame_v(
            names
                .iter()
                .map(|name| {
                    let first = frames.iter().find_map(|f| f.columns.iter().find(|c| &c.name == name)).expect("a table has it");
                    let values = frames
                        .iter()
                        .flat_map(|f| match f.columns.iter().find(|c| &c.name == name) {
                            Some(c) => c.values.clone(),
                            None => vec![V::Null; table_rows(&V::Frame(Rc::new((*f).clone())))],
                        })
                        .collect();
                    Column { values, ..first.clone() }
                })
                .collect(),
        );
    }
    let cubes: Vec<Cube> = ts.iter().map(|t| if let V::Cube(k) = t { (**k).clone() } else if let V::Frame(f) = t { frame_to_cube(f) } else { Cube::default() }).collect();
    cube_from_columns(
        names
            .iter()
            .zip(types)
            .map(|(name, ty)| CubeColumn {
                name: name.clone(),
                cells: cubes.iter().flat_map(|k| k.columns.iter().find(|c| &c.name == name).map_or_else(|| vec![V::Null; cube_row_count(k)], |c| c.cells.clone())).collect(),
                ty,
                format: None,
            })
            .collect(),
    )
}

/// `rankNested`: one nested column's tables scored together and split back to their rows, each ranked within itself;
/// None where the tables hold nothing to score.
fn rank_nested(cells: &[V], rows: usize, wf: Option<&FrameValue>, normalize: Normalize, breakdown: bool, parent: &Cube) -> Result<Option<Vec<(V, Best)>>, SolError> {
    let is_table = |v: &V| matches!(v, V::Frame(_) | V::Cube(_));
    let mut keys: Vec<String> = Vec::new();
    for pc in &parent.columns {
        let (mut seen, mut all) = (false, true);
        for (i, t) in cells.iter().enumerate() {
            if !is_table(t) {
                continue;
            }
            let Some((_, _, col)) = table_columns(t).into_iter().find(|(n, _, _)| *n == pc.name) else {
                all = false;
                continue;
            };
            seen = true;
            let own = pc.cells.get(i).cloned().unwrap_or(V::Undef);
            if !col.iter().all(|v| strict_eq(v, &own)) {
                all = false;
            }
        }
        if seen && all {
            keys.push(pc.name.clone());
        }
    }
    let label_of = |t: &V| table_columns(t).iter().position(|(n, ty, _)| *ty == Some(FrameColType::String) && !keys.contains(n));
    let label_name = cells.iter().find(|v| is_table(v)).and_then(|t| label_of(t).map(|j| table_columns(t)[j].0.clone()));
    let tidy = |t: &V| -> V {
        let first_text = label_of(t);
        let keep = |j: usize, name: &str| Some(j) == first_text || !keys.contains(&name.to_string());
        let rename = |j: usize, name: &String| match &label_name {
            Some(l) if Some(j) == first_text => l.clone(),
            _ => name.clone(),
        };
        match t {
            V::Cube(k) => cube_from_columns(k.columns.iter().enumerate().filter(|(j, c)| keep(*j, &c.name)).map(|(j, c)| CubeColumn { name: rename(j, &c.name), ..c.clone() }).collect()),
            V::Frame(f) => V::Frame(Rc::new(Frame {
                columns: f.columns.iter().enumerate().filter(|(j, c)| keep(*j, &c.name)).map(|(j, c)| Column { name: rename(j, &c.name), ..c.clone() }).collect(),
                ..(**f).clone()
            })),
            other => other.clone(),
        }
    };
    let mut out: Vec<(V, Best)> = (0..rows).map(|i| (cells.get(i).filter(|v| is_table(v)).map_or(V::Null, tidy), None)).collect();
    let tables: Vec<(V, usize)> = out.iter().enumerate().filter(|(_, o)| table_rows(&o.0) > 0).map(|(i, o)| (o.0.clone(), i)).collect();
    if tables.is_empty() {
        return Ok(Some(out));
    }
    let mut group: Vec<usize> = Vec::new();
    for (t, i) in &tables {
        group.extend(std::iter::repeat_n(*i, table_rows(t)));
    }
    let pooled = pool_tables(&tables.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>());
    if let V::Frame(p) = &pooled {
        if crate::decision::decision_columns(&to_core(p)).1.is_empty() {
            return Ok(None);
        }
    }
    let ranked = rank_any(&pooled, wf, normalize, breakdown)?;
    for (_, i) in &tables {
        let mine: Vec<usize> = ranked.at.iter().enumerate().filter(|(_, &p)| group[p] == *i).map(|(k, _)| k).collect();
        let sub = table_pick(&ranked.table, &mine);
        out[*i] = within_group(&sub, ranked.score_at, ranked.rank_at);
    }
    Ok(Some(out))
}

/// `rankCube` ([[C126]] chainedDecisions): the nested tables under each column ranked together, each row counting its
/// best acceptable one as a criterion named after the column, a row with nothing acceptable inside ruled out by it.
fn rank_cube(c: &Cube, wf: Option<&FrameValue>, normalize: Normalize, breakdown: bool) -> Result<Ranked, SolError> {
    let rows = cube_row_count(c);
    let scalar = flat_cube_scalar(c);
    let table_cols: Vec<&CubeColumn> = c.columns.iter().filter(|col| col.cells.iter().any(|v| matches!(v, V::Frame(_) | V::Cube(_)))).collect();
    let ranked: Vec<Option<Vec<(V, Best)>>> = table_cols.iter().map(|col| rank_nested(&col.cells, rows, wf, normalize, breakdown, c)).collect::<Result<_, _>>()?;
    let nested_cols: Vec<&CubeColumn> = table_cols.iter().zip(&ranked).filter(|(_, r)| r.is_some()).map(|(c, _)| *c).collect();
    let inner: Vec<&Vec<(V, Best)>> = ranked.iter().flatten().collect();
    let carried: Vec<&CubeColumn> = table_cols.iter().zip(&ranked).filter(|(_, r)| r.is_none()).map(|(c, _)| *c).collect();
    let mut parent = scalar.clone();
    for (n, col) in nested_cols.iter().enumerate() {
        parent.columns.push(FrameColumn::new(col.name.clone(), FrameColType::Number, inner[n].iter().map(|r| r.1.as_ref().map_or(FrameCell::Null, |b| FrameCell::Num(b.1))).collect()));
    }
    let r = crate::decision::resolve_weights(wf, &crate::decision::criteria_names(&parent))?;
    let mut failed = crate::decision::decision_screen(&parent, r.bounds.as_deref());
    for (n, col) in nested_cols.iter().enumerate() {
        for (i, x) in inner[n].iter().enumerate() {
            if x.1.is_none() {
                if let Some(f) = failed.get_mut(i) {
                    f.push(format!("no acceptable {}", col.name));
                }
            }
        }
    }
    let nested_names: Vec<String> = nested_cols.iter().map(|c| c.name.clone()).collect();
    let (frame, at, score_at) = rank_options(&parent, &r, normalize, breakdown, &failed, &nested_names)?;
    let k = nested_cols.len();
    let col_v = |fc: &FrameColumn| fc.values.iter().map(card_cell).collect::<Vec<_>>();
    let mut out = vec![CubeColumn { name: frame.columns[0].name.clone(), cells: col_v(&frame.columns[0]), ty: Some(FrameColType::String), format: None }];
    for (n, col) in nested_cols.iter().enumerate() {
        out.push(CubeColumn {
            name: format!("Best in {}", col.name),
            cells: at.iter().map(|&i| inner[n][i].1.as_ref().map_or(V::Null, |b| b.0.clone())).collect(),
            ty: Some(FrameColType::String),
            format: None,
        });
    }
    let criteria = crate::decision::decision_columns(&parent).1;
    for (j, col) in frame.columns.iter().skip(1).enumerate() {
        let contribution = j + 1 < score_at && criteria.get(j).is_some_and(|&ci| nested_names.contains(&parent.columns[ci].name));
        out.push(CubeColumn { name: if contribution { format!("{} score", col.name) } else { col.name.clone() }, cells: col_v(col), ty: Some(col.ty), format: None });
    }
    for (n, col) in nested_cols.iter().enumerate() {
        out.push(CubeColumn { name: col.name.clone(), cells: at.iter().map(|&i| inner[n][i].0.clone()).collect(), ty: None, format: None });
    }
    for col in &carried {
        out.push(CubeColumn { name: col.name.clone(), cells: at.iter().map(|&i| col.cells.get(i).cloned().unwrap_or(V::Null)).collect(), ty: None, format: None });
    }
    Ok(Ranked { table: cube_from_columns(out), at, score_at: score_at + k, rank_at: score_at + 1 + k })
}

fn decision_matrix(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    if matches!(raw, V::Null) {
        return shown_frame(c, "frame", V::Null);
    }
    let w = frame_in(c, "weights").map(|w| to_core(&w));
    let breakdown = c.field_str("detail", "summary") == "breakdown";
    let normalize = normalize_of(c);
    let out = match &raw {
        V::Cube(k) => rank_cube(k, w.as_ref(), normalize, breakdown).map(|r| r.table),
        other => {
            let f = match other {
                V::Frame(f) => (**f).clone(),
                v => widen_to_frame(v),
            };
            crate::decision::decision_matrix(&to_core(&f), w.as_ref(), normalize, breakdown).map(|f| V::Frame(Rc::new(from_core(&f))))
        }
    };
    shown_frame(c, "frame", out.unwrap_or_else(V::err))
}

// ─── Reconcile, Build Frame, Frame from Lists (frame.ts) ────────────────────────

/// `colTypeForSocket`: the element family of a socket's type, as a frame column's type.
fn col_type_for_socket(dt: Option<&str>) -> Option<&'static str> {
    Some(match dt? {
        "number" | "list" | "numlist" | "table" => "number",
        "string" | "strlist" | "strcombo" | "strtable" => "string",
        "date" | "datelist" | "datecombo" | "datetable" => "date",
        "logical" | "logicallist" | "logicalcombo" | "logicaltable" => "logical",
        _ => return None,
    })
}

/// `toAnyMatrix`: a table as it is, a list as one row, a value as one cell; a later item that isn't a row is a
/// one-cell row.
fn to_any_matrix(v: &V) -> Option<Vec<Vec<V>>> {
    match v {
        V::Null | V::Undef => None,
        V::List(items) if items.is_empty() => Some(Vec::new()),
        V::List(items) if !matches!(items[0], V::List(_)) => Some(vec![items.to_vec()]),
        V::List(rows) => Some(rows.iter().map(|r| if let V::List(r) = r { r.to_vec() } else { vec![r.clone()] }).collect()),
        other => Some(vec![vec![other.clone()]]),
    }
}

/// `parseColumnUnitFromHeader` over each header (`(header ?? "").trim()`).
fn parsed_headers(headers: &V) -> Vec<(String, Option<Json>)> {
    super::stats::items(headers)
        .iter()
        .map(|h| match h {
            V::Null | V::Undef => (String::new(), None),
            V::Str(s) => parse_column_unit_from_header(s),
            other => parse_column_unit_from_header(&crate::excel_functions::js_string_of(other)),
        })
        .collect()
}

fn build_frame(c: &mut Call) -> Answer {
    let raw = super::list::slot(c, "matrix");
    let headers = super::list::slot(c, "headers");
    let Some(m) = to_any_matrix(&raw).filter(|m| !m.is_empty()) else { return shown_frame(c, "frame", V::Null) };
    let known = col_type_for_socket(c.input_type("matrix"));
    let all_numeric = known.is_none() && m.iter().all(|row| row.iter().all(|x| matches!(x, V::Null | V::Err(_) | V::Num(_))));
    let typed = !(known == Some("number") || all_numeric);
    let parsed = if matches!(headers, V::Null | V::Undef) { Vec::new() } else { parsed_headers(&headers) };
    let clean = list(parsed.iter().map(|(n, _)| V::str(n)).collect());
    let matrix = list(m.into_iter().map(list).collect());
    let out = if typed {
        frame_fn("buildFrameTyped", &[], &[matrix, clean, known.map_or(V::Null, V::str)])
    } else {
        frame_fn("buildFrame", &[], &[matrix, clean])
    };
    let crate::frame_fns::FrameOut::Frame(f) = out else { return Err(thrown("Build Frame left a reading to the TS")) };
    let mut f = from_core(&f);
    for (col, (_, unit)) in f.columns.iter_mut().zip(&parsed) {
        if unit.is_some() && (!typed || col.ty == crate::frame::FrameColType::Number) {
            col.unit = unit.clone();
        }
    }
    shown_frame(c, "frame", V::Frame(Rc::new(f)))
}

fn frame_from_lists(c: &mut Call) -> Answer {
    let pairs: Vec<(String, String)> = c.sockets.iter().filter_map(|s| Some((s.key.clone(), format!("vals{}", s.key.strip_prefix("name")?)))).collect();
    let (mut names, mut lists, mut known) = (Vec::new(), Vec::new(), Vec::new());
    for (name_k, vals_k) in &pairs {
        let wired = super::list::slot(c, vals_k);
        if matches!(wired, V::Null | V::Undef) {
            continue;
        }
        let name = match str_input(c, name_k, "") {
            V::Null => return shown_frame(c, "frame", V::Null),
            V::Str(s) => js_trim(&s).to_string(),
            other => js_trim(&crate::excel_functions::js_string_of(&other)).to_string(),
        };
        names.push(V::str(&name));
        lists.push(if matches!(wired, V::List(_)) { wired } else { list(vec![wired]) });
        known.push(col_type_for_socket(c.input_type(vals_k)).map_or(V::Null, V::str));
    }
    if names.is_empty() {
        return shown_frame(c, "frame", V::Null);
    }
    match frame_fn("frameFromLists", &[], &[list(names), list(lists), list(known)]) {
        crate::frame_fns::FrameOut::Frame(f) => shown_frame(c, "frame", V::Frame(Rc::new(from_core(&f)))),
        _ => Err(thrown("Frame from Lists left a reading to the TS")),
    }
}

fn reconcile(c: &mut Call) -> Answer {
    let left = first(c, "left");
    let right = first(c, "right");
    let key_raw = str_input(c, "key", "");
    let price_raw = str_input(c, "priceColumn", "");
    let qty_raw = str_input(c, "qtyColumn", "");
    let blank = |c: &mut Call| {
        c.show("cachedResult", V::Null);
        c.show("cachedSummary", V::str(""));
        Ok(vec![("frame".into(), V::Null), ("summary".into(), V::str(""))])
    };
    if [&key_raw, &price_raw, &qty_raw].iter().any(|v| matches!(v, V::Null)) {
        return blank(c);
    }
    let key = trimmed(&key_raw, "keyRaw")?;
    let column = |s: String| if s.is_empty() { V::Undef } else { V::str(&s) };
    let price = column(trimmed(&price_raw, "priceRaw")?);
    let qty = column(trimmed(&qty_raw, "qtyRaw")?);
    let (V::Frame(l), V::Frame(r)) = (&left, &right) else { return blank(c) };
    if key.is_empty() {
        return blank(c);
    }
    use crate::frame_fns::FrameOut;
    let outcome = match frame_fn("reconcileFrames", &[&to_core(l), &to_core(r)], &[V::str(&key), V::str(&key), price, qty]) {
        FrameOut::FrameAnd(f, summary) => Ok((from_core(&f), summary)),
        FrameOut::Error(e) => Err(V::err(e)),
        _ => return Err(thrown("Reconcile left a reading to the TS")),
    };
    match outcome {
        Err(e) => {
            c.show("cachedResult", e.clone());
            c.show("cachedSummary", V::str(""));
            Ok(vec![("frame".into(), e.clone()), ("summary".into(), e)])
        }
        Ok((f, summary)) => {
            let frame = V::Frame(Rc::new(f));
            let text = V::str(&summarize_reconcile(&summary));
            c.show("cachedResult", frame.clone());
            c.show("cachedSummary", text.clone());
            Ok(vec![("frame".into(), frame), ("summary".into(), text)])
        }
    }
}

/// `n.toLocaleString("en-US", { maximumFractionDigits: fd })`.
fn locale_number(n: f64, fd: usize) -> String {
    let s = crate::excel_functions::intl_usd(n, fd).replacen('$', "", 1);
    match s.split_once('.') {
        Some((int, frac)) => {
            let frac = frac.trim_end_matches('0');
            if frac.is_empty() { int.to_string() } else { format!("{int}.{frac}") }
        }
        None => s,
    }
}

/// `summarizeReconcile`: markdown without headings, so it reads as plain text in a hero box.
fn summarize_reconcile(s: &V) -> String {
    use crate::jsnum::number_to_string as js;
    let items = super::stats::items(s);
    let n = |i: usize| super::kit::num(items.get(i).unwrap_or(&V::Null));
    let names = |i: usize| -> Vec<String> {
        items.get(i).map(super::stats::items).unwrap_or_default().iter().map(crate::excel_functions::js_string_of).collect()
    };
    let mut parts = vec![format!("**{}** added", js(n(0))), format!("**{}** removed", js(n(1))), format!("**{}** changed", js(n(2))), format!("**{}** unchanged", js(n(3)))];
    if n(4) > 0.0 {
        parts.push(format!("**{}** skipped", js(n(4))));
    }
    let mut out = parts.join(" · ");
    let (added, removed) = (names(5), names(6));
    if !added.is_empty() || !removed.is_empty() {
        let bits: Vec<String> = added.iter().map(|c| format!("+{c}")).chain(removed.iter().map(|c| format!("−{c}"))).collect();
        out += &format!("\n\n_Columns: {}._", bits.join(" · "));
    }
    if let Some(V::List(p)) = items.get(7) {
        let p = |i: usize| super::kit::num(p.get(i).unwrap_or(&V::Null));
        let fmt = |v: f64| if v.is_finite() && v.fract() == 0.0 { locale_number(v, 0) } else { locale_number(v, 2) };
        let sign = |v: f64| if v >= 0.0 { "+" } else { "" };
        let (delta, price, volume, mix, excluded) = (p(2), p(3), p(4), p(5), p(6));
        out += &format!(
            "\n\n**Δ {}{}**: price {}{} · volume {}{} · mix {}{}",
            sign(delta), fmt(delta), sign(price), fmt(price), sign(volume), fmt(volume), sign(mix), fmt(mix)
        );
        if excluded > 0.0 {
            out += &format!("\n\n_PVM excludes {} row{} with blank or errored price or qty._", js(excluded), if excluded == 1.0 { "" } else { "s" });
        }
    }
    out
}

// [[B27]] computeAnswersToExcel
//! Excel's documented examples, table by table: each answer is the one Microsoft's function page gives. A row that
//! fails is either a body that answers unlike Excel, or a row copied wrong; both are worth knowing.
#![allow(clippy::approx_constant, reason = "Excel's examples are written with these digits")]

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;

enum Want {
    N(f64, f64),
    /// A date, by its serial ([[D114]] dateIsAKind).
    D(f64),
    T(&'static str),
    B(bool),
    E,
}
use Want::*;

fn list(xs: &[f64]) -> V {
    V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into())
}

fn run(rows: &[(&str, Want)], env: &Env) -> Vec<String> {
    let mut bad = Vec::new();
    for (src, want) in rows {
        let got = formula(src, env.clone());
        let ok = match (want, &got) {
            (N(w, tol), Some(V::Num(g))) => (g - w).abs() <= *tol,
            (D(w), Some(V::Date(g))) => g == w,
            (T(w), Some(V::Str(g))) => &**g == *w,
            (B(w), Some(V::Bool(g))) => g == w,
            (E, Some(V::Err(_) | V::Fx(_))) => true,
            _ => false,
        };
        if !ok {
            let w = match want {
                N(w, _) => w.to_string(),
                D(w) => format!("the date {w}"),
                T(t) => format!("{t:?}"),
                B(b) => b.to_string(),
                E => "an error".into(),
            };
            bad.push(format!("{src}: got {got:?}, want {w}"));
        }
    }
    bad
}

fn env() -> Env {
    let mut e = Env::default();
    for (k, v) in [
        ("irr5", list(&[-70000.0, 12000.0, 15000.0, 18000.0, 21000.0])),
        ("irr6", list(&[-70000.0, 12000.0, 15000.0, 18000.0, 21000.0, 26000.0])),
        ("fvs", list(&[0.09, 0.11, 0.1])),
        ("sd", list(&[1345.0, 1301.0, 1368.0, 1322.0, 1310.0, 1370.0, 1318.0, 1350.0, 1303.0, 1299.0])),
        ("ks", list(&[3.0, 4.0, 5.0, 2.0, 3.0, 4.0, 5.0, 6.0, 4.0, 7.0])),
        ("p1", list(&[1.0, 3.0, 2.0, 4.0])),
        ("pe", list(&[1.0, 2.0, 3.0, 6.0, 6.0, 6.0, 7.0, 8.0, 9.0])),
        ("q1", list(&[1.0, 2.0, 4.0, 7.0, 8.0, 9.0, 10.0, 12.0])),
        ("qe", list(&[6.0, 7.0, 15.0, 36.0, 39.0, 40.0, 41.0, 42.0, 43.0, 47.0, 49.0])),
        ("lg", list(&[3.0, 5.0, 3.0, 5.0, 4.0, 4.0, 2.0, 4.0, 6.0, 7.0])),
        ("sm", list(&[3.0, 4.0, 5.0, 2.0, 3.0, 4.0, 6.0, 4.0, 7.0])),
        ("rk", list(&[7.0, 3.5, 3.5, 1.0, 2.0])),
        ("ra", list(&[89.0, 88.0, 92.0, 101.0, 94.0, 97.0, 95.0])),
        ("cx", list(&[3.0, 2.0, 4.0, 5.0, 6.0])),
        ("cy", list(&[9.0, 7.0, 12.0, 15.0, 17.0])),
        ("px", list(&[9.0, 7.0, 5.0, 3.0, 1.0])),
        ("py", list(&[10.0, 6.0, 1.0, 5.0, 3.0])),
        ("sy", list(&[2.0, 3.0, 9.0, 1.0, 8.0, 7.0, 5.0])),
        ("sx", list(&[6.0, 5.0, 11.0, 7.0, 5.0, 4.0, 4.0])),
        ("iy", list(&[2.0, 3.0, 9.0, 1.0, 8.0])),
        ("ix", list(&[6.0, 5.0, 11.0, 7.0, 5.0])),
        ("fy", list(&[6.0, 7.0, 9.0, 15.0, 21.0])),
        ("fx", list(&[20.0, 28.0, 31.0, 38.0, 40.0])),
        ("ca", list(&[2.0, 4.0, 8.0])),
        ("cb", list(&[5.0, 11.0, 12.0])),
        ("pv", list(&[0.0, 1.0, 2.0, 3.0])),
        ("pp", list(&[0.2, 0.3, 0.1, 0.4])),
        ("t1", list(&[3.0, 4.0, 5.0, 8.0, 9.0, 1.0, 2.0, 4.0, 5.0])),
        ("t2", list(&[6.0, 19.0, 3.0, 2.0, 14.0, 4.0, 5.0, 17.0, 1.0])),
    ] {
        e.insert(k.into(), v);
    }
    e
}

#[test]
fn finance() {
    let rows = [
        ("PMT(0.08/12, 10, 10000)", N(-1037.03, 0.005)),
        ("PMT(0.06/12, 18*12, 0, 50000)", N(-129.08, 0.005)),
        ("IPMT(0.1/12, 1, 3*12, 8000)", N(-66.67, 0.005)),
        ("IPMT(0.1, 3, 3, 8000)", N(-292.45, 0.005)),
        ("PPMT(0.1/12, 1, 2*12, 2000)", N(-75.62, 0.005)),
        ("PV(0.08/12, 12*20, 500, , 0)", N(-59777.15, 0.005)),
        ("FV(0.06/12, 10, -200, -500, 1)", N(2581.40, 0.005)),
        ("NPER(0.12/12, -100, -1000, 10000, 1)", N(59.6738657, 1e-6)),
        ("RATE(4*12, -200, 8000)", N(0.007701472, 1e-8)),
        ("IRR(irr5)", N(-0.021244848, 1e-6)),
        ("IRR(irr6)", N(0.086630948, 1e-8)),
        ("EFFECT(0.0525, 4)", N(0.053542667, 1e-8)),
        ("NOMINAL(0.053543, 4)", N(0.052500319, 1e-8)),
        ("SLN(30000, 7500, 10)", N(2250.0, 1e-9)),
        ("SYD(30000, 7500, 10, 1)", N(4090.91, 0.005)),
        ("SYD(30000, 7500, 10, 10)", N(409.09, 0.005)),
        ("FVSCHEDULE(1, fvs)", N(1.33089, 1e-9)),
        ("CUMIPMT(0.09/12, 30*12, 125000, 13, 24, 0)", N(-11135.23, 0.005)),
        ("CUMPRINC(0.09/12, 30*12, 125000, 13, 24, 0)", N(-934.1071234, 1e-6)),
        ("DOLLARDE(1.02, 16)", N(1.125, 1e-12)),
        ("DOLLARFR(1.125, 16)", N(1.02, 1e-12)),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

#[test]
fn math() {
    let rows = [
        ("MROUND(10, 3)", N(9.0, 0.0)),
        ("MROUND(-10, -3)", N(-9.0, 0.0)),
        ("MROUND(1.3, 0.2)", N(1.4, 1e-12)),
        ("MROUND(5, -2)", E),
        ("CEILING(2.5, 1)", N(3.0, 0.0)),
        ("CEILING(-2.5, -2)", N(-4.0, 0.0)),
        ("CEILING(-2.5, 2)", N(-2.0, 0.0)),
        ("CEILING(1.5, 0.1)", N(1.5, 1e-12)),
        ("CEILING(0.234, 0.01)", N(0.24, 1e-12)),
        ("FLOOR(3.7, 2)", N(2.0, 0.0)),
        ("FLOOR(-2.5, -2)", N(-2.0, 0.0)),
        ("FLOOR(2.5, -2)", E),
        ("FLOOR(1.58, 0.1)", N(1.5, 1e-12)),
        ("FLOOR(0.234, 0.01)", N(0.23, 1e-12)),
        ("CEILING.MATH(24.3, 5)", N(25.0, 0.0)),
        ("CEILING.MATH(6.7)", N(7.0, 0.0)),
        ("CEILING.MATH(-8.1, 2)", N(-8.0, 0.0)),
        ("CEILING.MATH(-5.5, 2, -1)", N(-6.0, 0.0)),
        ("FLOOR.MATH(24.3, 5)", N(20.0, 0.0)),
        ("FLOOR.MATH(6.7)", N(6.0, 0.0)),
        ("FLOOR.MATH(-8.1, 2)", N(-10.0, 0.0)),
        ("FLOOR.MATH(-5.5, 2, -1)", N(-4.0, 0.0)),
        ("ROUNDUP(3.2, 0)", N(4.0, 0.0)),
        ("ROUNDUP(3.14159, 3)", N(3.142, 1e-12)),
        ("ROUNDUP(-3.14159, 1)", N(-3.2, 1e-12)),
        ("ROUNDUP(31415.92654, -2)", N(31500.0, 0.0)),
        ("ROUNDDOWN(-3.14159, 1)", N(-3.1, 1e-12)),
        ("ROUNDDOWN(31415.92654, -2)", N(31400.0, 0.0)),
        ("ROUND(2.15, 1)", N(2.2, 1e-12)),
        ("ROUND(2.149, 1)", N(2.1, 1e-12)),
        ("ROUND(-1.475, 2)", N(-1.48, 1e-12)),
        ("ROUND(21.5, -1)", N(20.0, 0.0)),
        ("ROUND(626.3, -3)", N(1000.0, 0.0)),
        ("ROUND(1.98, -1)", N(0.0, 0.0)),
        ("ROUND(-50.55, -2)", N(-100.0, 0.0)),
        ("EVEN(1.5)", N(2.0, 0.0)),
        ("EVEN(3)", N(4.0, 0.0)),
        ("EVEN(-1)", N(-2.0, 0.0)),
        ("ODD(1.5)", N(3.0, 0.0)),
        ("ODD(2)", N(3.0, 0.0)),
        ("ODD(-1)", N(-1.0, 0.0)),
        ("ODD(-2)", N(-3.0, 0.0)),
        ("TRUNC(-8.9)", N(-8.0, 0.0)),
        ("INT(-8.9)", N(-9.0, 0.0)),
        ("MOD(-3, 2)", N(1.0, 0.0)),
        ("MOD(3, -2)", N(-1.0, 0.0)),
        ("MOD(-3, -2)", N(-1.0, 0.0)),
        ("QUOTIENT(4.5, 3.1)", N(1.0, 0.0)),
        ("QUOTIENT(-10, 3)", N(-3.0, 0.0)),
        ("GCD(24, 36)", N(12.0, 0.0)),
        ("GCD(5, 0)", N(5.0, 0.0)),
        ("LCM(24, 36)", N(72.0, 0.0)),
        ("COMBIN(8, 2)", N(28.0, 0.0)),
        ("COMBINA(4, 3)", N(20.0, 0.0)),
        ("PERMUT(100, 3)", N(970200.0, 0.0)),
        ("MULTINOMIAL(2, 3, 4)", N(1260.0, 0.0)),
        ("SQRTPI(2)", N(2.506628275, 1e-9)),
        ("POWER(98.6, 3.2)", N(2401077.222, 1e-3)),
        ("LOG10(86)", N(1.934498451, 1e-9)),
        ("LN(86)", N(4.454347296, 1e-9)),
        ("SIGN(-0.00001)", N(-1.0, 0.0)),
        ("ATAN2(-1, -1)", N(-2.35619449, 1e-8)),
        ("RADIANS(270)", N(4.712389, 1e-6)),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

#[test]
fn statistics() {
    let rows = [
        ("AVEDEV(4, 5, 6, 7, 5, 4, 3)", N(1.020408163, 1e-9)),
        ("DEVSQ(4, 5, 8, 7, 11, 4, 3)", N(48.0, 1e-9)),
        ("GEOMEAN(4, 5, 8, 7, 11, 4, 3)", N(5.476987, 1e-6)),
        ("HARMEAN(4, 5, 8, 7, 11, 4, 3)", N(5.028376, 1e-6)),
        ("KURT(ks)", N(-0.151799637, 1e-9)),
        ("SKEW(ks)", N(0.359543071, 1e-9)),
        ("STDEV.S(sd)", N(27.46391572, 1e-8)),
        ("STDEV.P(sd)", N(26.05455814, 1e-8)),
        ("VAR.S(sd)", N(754.2666667, 1e-6)),
        ("VAR.P(sd)", N(678.84, 1e-8)),
        ("MODE.SNGL(5.6, 4, 4, 3, 2, 4)", N(4.0, 0.0)),
        ("PERCENTILE.INC(p1, 0.3)", N(1.9, 1e-12)),
        ("PERCENTILE.EXC(pe, 0.25)", N(2.5, 1e-12)),
        ("QUARTILE.INC(q1, 1)", N(3.5, 1e-12)),
        ("QUARTILE.EXC(qe, 1)", N(15.0, 1e-12)),
        ("QUARTILE.EXC(qe, 3)", N(43.0, 1e-12)),
        ("LARGE(lg, 3)", N(5.0, 0.0)),
        ("SMALL(sm, 4)", N(4.0, 0.0)),
        ("RANK.EQ(7, rk, 1)", N(5.0, 0.0)),
        ("RANK.AVG(94, ra)", N(4.0, 0.0)),
        ("CORREL(cx, cy)", N(0.997054486, 1e-9)),
        ("PEARSON(px, py)", N(0.699379, 1e-6)),
        ("SLOPE(sy, sx)", N(0.305556, 1e-6)),
        ("INTERCEPT(iy, ix)", N(0.0483871, 1e-7)),
        ("RSQ(sy, sx)", N(0.05795, 1e-5)),
        ("STEYX(sy, sx)", N(3.305719, 1e-6)),
        ("FORECAST.LINEAR(30, fy, fx)", N(10.607253, 1e-6)),
        ("COVARIANCE.P(cx, cy)", N(5.2, 1e-12)),
        ("COVARIANCE.S(ca, cb)", N(9.666666667, 1e-9)),
        ("FISHER(0.75)", N(0.972955, 1e-6)),
        ("FISHERINV(0.972955075)", N(0.75, 1e-9)),
        ("STANDARDIZE(42, 40, 1.5)", N(1.333333, 1e-6)),
        ("NORM.DIST(42, 40, 1.5, TRUE)", N(0.9087888, 1e-7)),
        ("NORM.DIST(42, 40, 1.5, FALSE)", N(0.10934, 1e-5)),
        ("NORM.INV(0.908789, 40, 1.5)", N(42.000002, 1e-6)),
        ("NORM.S.INV(0.908789)", N(1.3333347, 1e-7)),
        ("LOGNORM.DIST(4, 3.5, 1.2, TRUE)", N(0.0390836, 1e-7)),
        ("LOGNORM.INV(0.039084, 3.5, 1.2)", N(4.0000252, 1e-6)),
        ("EXPON.DIST(0.2, 10, TRUE)", N(0.86466472, 1e-8)),
        ("EXPON.DIST(0.2, 10, FALSE)", N(1.35335283, 1e-8)),
        ("BINOM.DIST(6, 10, 0.5, FALSE)", N(0.2050781, 1e-7)),
        ("POISSON.DIST(2, 5, TRUE)", N(0.124652, 1e-6)),
        ("POISSON.DIST(2, 5, FALSE)", N(0.084224, 1e-6)),
        ("GAMMA.DIST(10.00001131, 9, 2, FALSE)", N(0.032639, 1e-6)),
        ("GAMMA.DIST(10.00001131, 9, 2, TRUE)", N(0.068094, 1e-6)),
        ("BETA.DIST(2, 8, 10, TRUE, 1, 3)", N(0.6854706, 1e-7)),
        ("BETA.DIST(2, 8, 10, FALSE, 1, 3)", N(1.4837646, 1e-7)),
        ("CHISQ.DIST(0.5, 1, TRUE)", N(0.52049988, 1e-8)),
        ("CHISQ.DIST(2, 3, FALSE)", N(0.20755375, 1e-8)),
        ("T.DIST(60, 1, TRUE)", N(0.99469533, 1e-8)),
        ("T.DIST(8, 3, FALSE)", N(0.00073691, 1e-8)),
        ("T.DIST.2T(1.959999998, 60)", N(0.054644930, 1e-8)),
        ("T.INV(0.75, 2)", N(0.8164966, 1e-7)),
        ("T.INV.2T(0.546449, 60)", N(0.606533, 1e-6)),
        ("F.DIST(15.2069, 6, 4, TRUE)", N(0.99, 1e-6)),
        ("F.DIST.RT(15.2068649, 6, 4)", N(0.01, 1e-7)),
        ("WEIBULL.DIST(105, 20, 100, TRUE)", N(0.929581, 1e-6)),
        ("WEIBULL.DIST(105, 20, 100, FALSE)", N(0.035589, 1e-6)),
        ("HYPGEOM.DIST(1, 4, 8, 20, TRUE)", N(0.4654, 1e-4)),
        ("HYPGEOM.DIST(1, 4, 8, 20, FALSE)", N(0.3633, 1e-4)),
        ("NEGBINOM.DIST(10, 5, 0.25, TRUE)", N(0.3135141, 1e-7)),
        ("NEGBINOM.DIST(10, 5, 0.25, FALSE)", N(0.055048660, 1e-8)),
        ("GAMMALN(4)", N(1.791759, 1e-6)),
        ("PROB(pv, pp, 2)", N(0.1, 1e-12)),
        ("PROB(pv, pp, 1, 3)", N(0.8, 1e-12)),
        ("T.TEST(t1, t2, 2, 1)", N(0.196016, 1e-6)),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

#[test]
fn text() {
    let rows = [
        ("LEFT(\"Sale Price\", 4)", T("Sale")),
        ("RIGHT(\"Sale Price\", 5)", T("Price")),
        ("MID(\"Fluid Flow\", 7, 20)", T("Flow")),
        ("MID(\"Fluid Flow\", 20, 5)", T("")),
        ("FIND(\"m\", \"Miriam McGovern\")", N(6.0, 0.0)),
        ("FIND(\"M\", \"Miriam McGovern\", 3)", N(8.0, 0.0)),
        ("SEARCH(\"e\", \"Statements\", 6)", N(7.0, 0.0)),
        ("SUBSTITUTE(\"Quarter 1, 2008\", \"1\", \"2\", 1)", T("Quarter 2, 2008")),
        ("SUBSTITUTE(\"Quarter 1, 2011\", \"1\", \"2\", 3)", T("Quarter 1, 2012")),
        ("PROPER(\"this is a TITLE\")", T("This Is A Title")),
        ("PROPER(\"2-way street\")", T("2-Way Street")),
        ("REPT(\"*-\", 3)", T("*-*-*-")),
        ("EXACT(\"Word\", \"word\")", B(false)),
        ("CLEAN(CHAR(9) & \"Monthly report\" & CHAR(10))", T("Monthly report")),
        ("FIXED(1234.567, 1)", T("1,234.6")),
        ("FIXED(1234.567, -1)", T("1,230")),
        ("FIXED(-1234.567, -1, TRUE)", T("-1230")),
        ("FIXED(44.332)", T("44.33")),
        ("VALUE(\"$1,000\")", N(1000.0, 0.0)),
        ("NUMBERVALUE(\"2.500,27\", \",\", \".\")", N(2500.27, 1e-9)),
        ("NUMBERVALUE(\"3.5%\")", N(0.035, 1e-12)),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

#[test]
fn dates() {
    let rows = [
        ("DAYS360(DATE(2011, 1, 1), DATE(2011, 12, 31))", N(360.0, 0.0)),
        ("DAYS360(DATE(2011, 1, 30), DATE(2011, 12, 31))", N(330.0, 0.0)),
        ("YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30))", N(0.58055556, 1e-8)),
        ("YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30), 1)", N(0.57650273, 1e-8)),
        ("YEARFRAC(DATE(2012, 1, 1), DATE(2012, 7, 30), 3)", N(0.57808219, 1e-8)),
        ("EOMONTH(DATE(2011, 1, 1), 1) - DATE(2011, 2, 28)", N(0.0, 0.0)),
        ("EOMONTH(DATE(2011, 1, 1), -3) - DATE(2010, 10, 31)", N(0.0, 0.0)),
        ("EDATE(DATE(2011, 1, 15), 1) - DATE(2011, 2, 15)", N(0.0, 0.0)),
        ("NETWORKDAYS(DATE(2012, 10, 1), DATE(2013, 3, 1))", N(110.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14))", N(5.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 2)", N(4.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 3)", N(3.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9))", N(10.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 2)", N(11.0, 0.0)),
        ("ISOWEEKNUM(DATE(2012, 3, 9))", N(10.0, 0.0)),
        // Every return type: 14-Feb-2008 is a Thursday; 09-Mar-2012 a Friday in a year that starts on a Sunday.
        ("WEEKDAY(DATE(2008, 2, 14), 11)", N(4.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 12)", N(3.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 13)", N(2.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 14)", N(1.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 15)", N(7.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 16)", N(6.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 17)", N(5.0, 0.0)),
        ("WEEKDAY(DATE(2008, 2, 14), 4)", E),
        ("WEEKNUM(DATE(2012, 3, 9), 11)", N(11.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 12)", N(11.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 13)", N(11.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 14)", N(11.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 15)", N(11.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 16)", N(10.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 17)", N(10.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 21)", N(10.0, 0.0)),
        ("WEEKNUM(DATE(2012, 3, 9), 3)", E),
        ("TIME(12, 0, 0)", N(0.5, 0.0)),
        ("TIME(16, 48, 10)", N(0.700115741, 1e-9)),
        ("TIME(27, 0, 0)", N(0.125, 1e-12)),
        ("TIME(1.9, 0, 0)", N(1.0 / 24.0, 1e-12)),
        ("TIME(1, -30, 0)", N(1.0 / 48.0, 1e-12)),
        ("TIME(0, -1, 0)", E),
        ("WORKDAY(DATE(2008, 10, 1), 151) - DATE(2009, 4, 30)", N(0.0, 0.0)),
        ("WORKDAY.INTL(DATE(2012, 1, 1), 30, 0)", E),
        ("NETWORKDAYS.INTL(DATE(2006, 1, 1), DATE(2006, 1, 31))", N(22.0, 0.0)),
        ("NETWORKDAYS.INTL(DATE(2006, 2, 28), DATE(2006, 1, 31))", N(-21.0, 0.0)),
        ("DATEDIF(DATE(2001, 1, 1), DATE(2003, 1, 1), \"Y\")", N(2.0, 0.0)),
        ("DATEDIF(DATE(2001, 6, 1), DATE(2002, 8, 15), \"D\")", N(440.0, 0.0)),
        ("DATEDIF(DATE(2001, 6, 1), DATE(2002, 8, 15), \"YD\")", N(75.0, 0.0)),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

#[test]
fn engineering() {
    let rows = [
        ("BIN2DEC(1100100)", N(100.0, 0.0)),
        ("BIN2DEC(1111111111)", N(-1.0, 0.0)),
        ("HEX2DEC(\"A5\")", N(165.0, 0.0)),
        ("HEX2DEC(\"FFFFFFFF5B\")", N(-165.0, 0.0)),
        ("HEX2DEC(\"3DA408B9\")", N(1034160313.0, 0.0)),
        ("OCT2DEC(54)", N(44.0, 0.0)),
        ("OCT2DEC(7777777533)", N(-165.0, 0.0)),
        ("DEC2BIN(-100)", T("1110011100")),
        ("DEC2HEX(100, 4)", T("0064")),
        ("DEC2HEX(-54)", T("FFFFFFFFCA")),
        ("DEC2HEX(28)", T("1C")),
        ("DEC2OCT(58, 3)", T("072")),
        ("HEX2BIN(\"F\", 8)", T("00001111")),
        ("HEX2BIN(\"B7\")", T("10110111")),
        ("HEX2BIN(\"FFFFFFFFFF\")", T("1111111111")),
        ("HEX2OCT(\"F\", 3)", T("017")),
        ("HEX2OCT(\"3B4E\")", T("35516")),
        ("HEX2OCT(\"FFFFFFFF00\")", T("7777777400")),
        ("OCT2BIN(3, 3)", T("011")),
        ("OCT2BIN(7777777000)", T("1000000000")),
        ("OCT2HEX(100, 4)", T("0040")),
        ("OCT2HEX(7777777533)", T("FFFFFFFF5B")),
        ("BIN2HEX(11111011, 4)", T("00FB")),
        ("BIN2HEX(1110)", T("E")),
        ("BIN2HEX(1111111111)", T("FFFFFFFFFF")),
        ("BIN2OCT(1001, 3)", T("011")),
        ("BIN2OCT(1111111111)", T("7777777777")),
        ("DELTA(5, 4)", N(0.0, 0.0)),
        ("DELTA(0.5, 0)", N(0.0, 0.0)),
        ("GESTEP(-4, -5)", N(1.0, 0.0)),
        ("GESTEP(-1)", N(0.0, 0.0)),
        ("IMABS(\"5+12i\")", N(13.0, 0.0)),
        ("IMAGINARY(\"3+4i\")", N(4.0, 0.0)),
        ("IMREAL(\"6-9i\")", N(6.0, 0.0)),
        ("CONVERT(1, \"lbm\", \"kg\")", N(0.4535924, 1e-7)),
        ("CONVERT(68, \"F\", \"C\")", N(20.0, 1e-9)),
        ("CONVERT(2.5, \"ft\", \"sec\")", E),
    ];
    let bad = run(&rows, &env());
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

/// Answers the author's Excel gave (US locale), 2026-11-01, for cases Excel's documentation leaves open.
#[test]
fn checked_in_excel() {
    let mut e = env();
    e.insert("cf".into(), list(&[3.0, 5.0, 2.0, 8.0]));
    e.insert("cg".into(), V::List(vec![V::Num(2.0), V::Num(6.0), V::str("x"), V::Num(9.0)].into()));
    e.insert("fk".into(), list(&[1.0, 3.0, 7.0, 12.0, 20.0]));
    e.insert("fl".into(), V::List(vec![V::Num(2.0), V::Null, V::Num(10.0), V::Num(15.0)].into()));
    let rows = [
        ("CHISQ.TEST(cf, cg)", N(0.854774575, 1e-9)),
        ("ARABIC(\"MMMM\")", N(4000.0, 0.0)),
        ("ARABIC(\"VV\")", N(10.0, 0.0)),
        ("ARABIC(\"IIII\")", N(4.0, 0.0)),
        ("DECIMAL(\"0x1F\", 16)", N(31.0, 0.0)),
        ("DECIMAL(\" 1F\", 16)", N(31.0, 0.0)),
        ("INDEX(FREQUENCY(fk, fl), 2)", N(2.0, 0.0)),
        ("BESSELJ(1.9, 2)", N(0.329925828669785, 1e-15)),
        ("BESSELY(2.5, 1)", N(0.145918137508313, 1e-15)),
        ("DB(1000000, 100000, 6, 7, 7)", N(15845.09847, 1e-5)),
        // Excel reads 3/5/24 month first; Solenoid answers #AMBIGUOUS! for two numbers that could each be the month
        // (author 2026-11-01), and reads one past 12 as the day.
        ("DATEVALUE(\"3/5/24\")", E),
        ("DATEVALUE(\"13/5/24\")", D(45425.0)),
        ("DATEVALUE(\"3/3/24\")", D(45354.0)),
        ("DATEVALUE(\"March 2024\")", D(45352.0)),
        ("DATEVALUE(\"5-Mar-24\")", D(45356.0)),
    ];
    let bad = run(&rows, &e);
    assert!(bad.is_empty(), "\n{}", bad.join("\n"));
}

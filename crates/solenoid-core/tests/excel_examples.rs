// [[B27]] computeAnswersToExcel
//! Answers from Excel's own documentation, for functions whose bodies were rewritten away from what JavaScript
//! computed. The frozen fixtures pin what the core answers; these pin that it is what Excel answers.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;

fn eval(src: &str) -> V {
    formula(src, Env::default()).expect("parses")
}

fn num(src: &str) -> f64 {
    match eval(src) {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

fn text(src: &str) -> String {
    match eval(src) {
        V::Str(s) => s.to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

fn is_error(src: &str) -> bool {
    matches!(eval(src), V::Fx(_) | V::Err(_))
}

fn close(src: &str, want: f64, tol: f64) {
    let got = num(src);
    assert!((got - want).abs() <= tol, "{src}: got {got}, want {want}");
}

#[test]
fn bit_functions_work_on_48_bits() {
    assert_eq!(num("BITAND(13, 25)"), 9.0);
    assert_eq!(num("BITOR(23, 10)"), 31.0);
    assert_eq!(num("BITXOR(5, 3)"), 6.0);
    assert_eq!(num("BITLSHIFT(4, 2)"), 16.0);
    assert_eq!(num("BITRSHIFT(13, 2)"), 3.0);
    assert_eq!(num("BITAND(2^33, 2^33)"), 8_589_934_592.0);
    assert_eq!(num("BITLSHIFT(1, 40)"), 1_099_511_627_776.0);
    assert_eq!(num("BITLSHIFT(8, -2)"), 2.0);
    assert!(is_error("BITLSHIFT(1, 48)"));
    assert!(is_error("BITAND(-1, 1)"));
    assert!(is_error("BITAND(1.5, 1)"));
}

#[test]
fn erf_and_confidence_and_chisq_test() {
    close("ERF(0.745)", 0.707928920, 1e-9);
    close("ERF(1)", 0.842700793, 1e-9);
    close("ERF(0, 1)", 0.842700793, 1e-9);
    close("ERF(1, 2)", 0.152621472, 1e-9);
    close("ERFC(1)", 0.157299207, 1e-9);
    close("CONFIDENCE.NORM(0.05, 2.5, 50)", 0.692951912, 1e-9);
    close("CONFIDENCE.T(0.05, 1, 50)", 0.284196855, 1e-6);
    assert!(is_error("CONFIDENCE.NORM(0, 1, 10)"));
    assert!(is_error("CONFIDENCE.NORM(0.05, 0, 10)"));
    assert!(is_error("CONFIDENCE.T(0.05, 1, 1)"));
    let rows = |r: &[[f64; 2]]| {
        V::List(
            r.iter()
                .map(|p| V::List(p.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into()))
                .collect::<Vec<_>>()
                .into(),
        )
    };
    let mut env = Env::default();
    env.insert("seen".into(), rows(&[[58.0, 35.0], [11.0, 25.0], [10.0, 23.0]]));
    env.insert("expected".into(), rows(&[[45.35, 47.65], [17.56, 18.44], [16.09, 16.91]]));
    match formula("CHISQ.TEST(seen, expected)", env) {
        Some(V::Num(p)) => assert!((p - 0.000308192).abs() < 1e-9, "CHISQ.TEST: got {p}"),
        other => panic!("CHISQ.TEST answered {other:?}"),
    }
    close("GAMMA(0.5)", std::f64::consts::PI.sqrt(), 1e-15);
}

#[test]
fn radix_and_roman_functions() {
    assert_eq!(text("BASE(7, 2)"), "111");
    assert_eq!(text("BASE(100, 16)"), "64");
    assert_eq!(text("BASE(15, 2, 10)"), "0000001111");
    assert_eq!(text("BASE(255.9, 16)"), "FF");
    assert!(is_error("BASE(-1, 2)"));
    assert!(is_error("BASE(7, 1)"));
    assert_eq!(num("DECIMAL(\"FF\", 16)"), 255.0);
    assert_eq!(num("DECIMAL(\"ff\", 16)"), 255.0);
    assert_eq!(num("DECIMAL(111, 2)"), 7.0);
    assert_eq!(num("DECIMAL(\"zap\", 36)"), 45745.0);
    assert_eq!(num("DECIMAL(\"0x1F\", 16)"), 31.0);
    assert!(is_error("DECIMAL(\"12z\", 10)"));
    for (form, want) in ["CDXCIX", "LDVLIV", "XDIX", "VDIV", "ID"].iter().enumerate() {
        assert_eq!(text(&format!("ROMAN(499, {form})")), *want);
        assert_eq!(num(&format!("ARABIC(\"{want}\")")), 499.0);
    }
    assert_eq!(text("ROMAN(499, TRUE)"), "CDXCIX");
    assert_eq!(text("ROMAN(499, FALSE)"), "ID");
    assert_eq!(text("ROMAN(1999)"), "MCMXCIX");
    assert_eq!(text("ROMAN(3999)"), "MMMCMXCIX");
    assert!(is_error("ROMAN(4000)"));
    assert!(is_error("ROMAN(-1)"));
    assert_eq!(num("ARABIC(\"LVII\")"), 57.0);
    assert_eq!(num("ARABIC(\"mcmxii\")"), 1912.0);
    assert_eq!(num("ARABIC(\"-IV\")"), -4.0);
    assert_eq!(num("ARABIC(\"\")"), 0.0);
    assert_eq!(num("ARABIC(\"VV\")"), 10.0);
    assert!(is_error("ARABIC(\"ABC\")"));
    assert_eq!(num("PERMUTATIONA(3, 2)"), 9.0);
    assert_eq!(num("PERMUTATIONA(2.7, 2.9)"), 4.0);
    assert!(is_error("PERMUTATIONA(-1, 2)"));
}

fn list(xs: &[f64]) -> V {
    V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into())
}

/// `src` with each name bound to its list.
fn eval_with(src: &str, names: &[(&str, V)]) -> V {
    let mut env = Env::default();
    for (k, v) in names {
        env.insert((*k).into(), v.clone());
    }
    formula(src, env).expect("parses")
}

fn num_with(src: &str, names: &[(&str, V)]) -> f64 {
    match eval_with(src, names) {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn arguments_read_as_excel_reads_them() {
    close("LOG(10)", 1.0, 1e-15);
    close("LOG(8, 2)", 3.0, 1e-15);
    close("LOG(86, 2.7182818)", 4.454347343, 1e-9);
    assert!(is_error("LOG(10, 0)"), "a base of 0 is not a missing base");
    assert!(is_error("LOG(10, 1)"));
    assert!(is_error("LOG(-1)"));
    assert!(is_error("LOG(\"8\")"));

    let xs = list(&[6.0, 7.0, 9.0, 15.0, 21.0]);
    let ys = list(&[20.0, 28.0, 31.0, 38.0, 40.0]);
    let close_with = |src: &str, names: &[(&str, V)], want: f64, tol: f64| {
        let got = num_with(src, names);
        assert!((got - want).abs() <= tol, "{src}: got {got}, want {want}");
    };
    close_with("F.TEST(xs, ys)", &[("xs", xs.clone()), ("ys", ys)], 0.64831785, 1e-8);
    assert!(matches!(eval_with("F.TEST(xs, one)", &[("xs", xs), ("one", list(&[1.0]))]), V::Err(_) | V::Fx(_)));

    let t = list(&[4.0, 5.0, 6.0, 7.0, 2.0, 3.0, 4.0, 5.0, 1.0, 2.0, 3.0]);
    close_with("TRIMMEAN(t, 0.2)", &[("t", t)], 3.777777778, 1e-9);
    close("TRIMMEAN(5, 0)", 5.0, 0.0);

    let sp = [("p", list(&[3.0, 4.0, 8.0, 6.0, 1.0, 9.0])), ("q", list(&[2.0, 7.0, 6.0, 7.0, 5.0, 3.0]))];
    assert_eq!(num_with("SUMPRODUCT(p, q)", &sp), 156.0);
    assert!(matches!(eval_with("SUMPRODUCT(p, s)", &[sp[0].clone(), ("s", list(&[1.0, 2.0]))]), V::Err(_) | V::Fx(_)));
    let u = [("u", list(&[2.0, 3.0, 9.0, 1.0, 8.0, 7.0, 5.0])), ("v", list(&[6.0, 5.0, 11.0, 7.0, 5.0, 4.0, 4.0]))];
    assert_eq!(num_with("SUMX2MY2(u, v)", &u), -55.0);
    assert_eq!(num_with("SUMX2PY2(u, v)", &u), 521.0);
    assert_eq!(num_with("SUMXMY2(u, v)", &u), 79.0);
    assert!(matches!(eval_with("SUMXMY2(u, s)", &[u[0].clone(), ("s", list(&[1.0]))]), V::Err(_) | V::Fx(_)));
    assert_eq!(num("SUMSQ(3, 4)"), 25.0);
    assert!(is_error("SUMSQ(3, \"4\")"));

    let z = [("z", list(&[3.0, 6.0, 7.0, 8.0, 6.0, 5.0, 4.0, 2.0, 1.0, 9.0]))];
    close_with("Z.TEST(z, 4)", &z, 0.090574197, 1e-9);
    close_with("Z.TEST(z, 4, 6)", &z, 0.281041305, 1e-9);

    assert_eq!(num("TYPE(1)"), 1.0);
    assert_eq!(num("TYPE(\"a\")"), 2.0);
    assert_eq!(num("TYPE(TRUE)"), 4.0);
    assert_eq!(num("TYPE(1/0)"), 16.0);

    assert_eq!(text("REPLACE(\"abcdefghijk\", 6, 5, \"*\")"), "abcde*k");
    assert_eq!(text("REPLACE(\"2009\", 3, 2, \"10\")"), "2010");
    assert_eq!(text("REPLACE(\"abc\", 5, 1, \"x\")"), "abcx");
    assert!(is_error("REPLACE(\"abc\", 0, 1, \"x\")"));
    assert!(is_error("REPLACE(\"abc\", 1, -1, \"x\")"));
}

#[test]
fn trim_removes_only_spaces() {
    assert_eq!(text("TRIM(\" First Quarter   Earnings \")"), "First Quarter Earnings");
    assert_eq!(text("TRIM(CHAR(160) & \"a\")"), "\u{A0}a");
    assert_eq!(text("TRIM(\"a\" & CHAR(9) & \" b\")"), "a\t b");
}

#[test]
fn dollar_formats_as_excel() {
    assert_eq!(text("DOLLAR(1234.567, 2)"), "$1,234.57");
    assert_eq!(text("DOLLAR(1234.567, -2)"), "$1,200");
    assert_eq!(text("DOLLAR(-1234.567, -2)"), "($1,200)");
    assert_eq!(text("DOLLAR(-0.123, 4)"), "($0.1230)");
    assert_eq!(text("DOLLAR(99.888)"), "$99.89");
    assert_eq!(text("DOLLAR(0, 0.5)"), "$0");
    assert_eq!(text("DOLLAR(-0.001, 2)"), "($0.00)");
    assert_eq!(text("DOLLAR(2, 2.9)"), "$2.00");
}

#[test]
fn dec2_truncates_and_bessel_matches_excel() {
    assert_eq!(text("DEC2HEX(255.9)"), "FF");
    assert_eq!(text("DEC2BIN(9.99, 4)"), "1001");
    assert_eq!(text("DEC2OCT(-100.7)"), "7777777634");
    // Excel's documented answer, which bessel.js's fit shares; the exact value is 0.3299257277.
    close("BESSELJ(1.9, 2)", 0.329925829, 1e-9);
    close("BESSELY(2.5, 1)", 0.145918138, 1e-9);
    close("BESSELI(1.5, 1)", 0.981666428, 1e-7);
    close("BESSELK(1.5, 1)", 0.277387804, 1e-7);
}

#[test]
fn depreciation_npv_and_factorials_match_excel() {
    close("DB(1000000, 100000, 6, 1, 7)", 186083.33, 0.005);
    close("DB(1000000, 100000, 6, 2, 7)", 259639.42, 0.005);
    close("DB(1000000, 100000, 6, 7, 7)", 15845.10, 0.005);
    close("DDB(2400, 300, 10*365, 1)", 1.32, 0.005);
    close("DDB(2400, 300, 10*12, 1)", 40.0, 0.005);
    close("DDB(2400, 300, 10, 1)", 480.0, 0.005);
    close("DDB(2400, 300, 10, 2, 1.5)", 306.0, 0.005);
    close("DDB(2400, 300, 10, 10)", 22.12, 0.005);
    close("NPV(0.1, -10000, 3000, 4200, 6800)", 1188.44, 0.005);
    assert_eq!(num("FACT(5)"), 120.0);
    assert_eq!(num("FACT(1.9)"), 1.0);
    assert_eq!(num("FACT(0)"), 1.0);
    assert!(is_error("FACT(-1)"));
    assert_eq!(num("FACTDOUBLE(6)"), 48.0);
    assert_eq!(num("FACTDOUBLE(7)"), 105.0);
}

#[test]
fn seriessum_takes_one_coefficient_and_gestep_passes_errors() {
    assert_eq!(num("SERIESSUM(2, 1, 1, 5)"), 10.0);
    assert_eq!(num("SERIESSUM(2, 1, 1, SEQUENCE(3))"), 34.0);
    assert!(is_error("SERIESSUM(2, 1, 1, \"a\")"));
    assert_eq!(num("GESTEP(5, 4)"), 1.0);
    assert_eq!(num("GESTEP(-1)"), 0.0);
}

#[test]
fn an_error_from_any_function_is_the_answer() {
    for src in ["CONCAT(NA(), \"a\")", "LEN(NA())", "UPPER(NA())", "EXACT(NA(), \"a\")", "ENCODEBASE64(NA())"] {
        assert!(
            matches!(eval(src), V::Err(e) if e.code == solenoid_core::error_value::ErrorCode::NotAvailable),
            "{src}"
        );
    }
}

/// The author's Excel, 2026-11-01: the Analysis ToolPak date functions refuse a logical date or month count.
#[test]
fn toolpak_dates_refuse_logicals() {
    for src in [
        "EDATE(TRUE, 1)",
        "EOMONTH(TRUE, 1)",
        "EDATE(45000, TRUE)",
        "YEARFRAC(TRUE, 45000)",
        "WORKDAY(TRUE, 1)",
        "NETWORKDAYS(TRUE, 45000)",
    ] {
        assert!(matches!(eval(src), V::Err(e) if e.code == solenoid_core::error_value::ErrorCode::Value), "{src}");
    }
}

/// The author's Excel, 2026-11-01: UPPER keeps ß, and a cut never halves a character.
#[test]
fn upper_keeps_eszett_and_cuts_keep_characters_whole() {
    assert_eq!(text("UPPER(\"straße\")"), "STRAßE");
    assert_eq!(text("LEFT(\"😀x\", 1)"), "😀");
    assert_eq!(text("RIGHT(\"x😀\", 1)"), "😀");
    assert_eq!(text("MID(\"a😀b\", 3, 2)"), "😀b");
    assert_eq!(num("LEN(\"😀\")"), 2.0);
}

fn code(src: &str) -> String {
    match eval(src) {
        V::Err(e) => e.code.as_str().to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

/// The author's Excel, 2026-11-01: SWITCH answers an error only from the value or a case it reaches, a LAMBDA reads an
/// error argument as a value, COUNT skips an error and COUNTA counts it.
#[test]
fn errors_reach_the_bodies_that_read_them() {
    assert_eq!(num("SWITCH(1, 2, NA(), 9)"), 9.0);
    assert_eq!(num("SWITCH(1, 2, 1/0, 9)"), 9.0);
    assert_eq!(num("CHOOSE(2, NA(), 5)"), 5.0);
    assert_eq!(num("LAMBDA(x, IFERROR(x, 0))(NA())"), 0.0);
    assert_eq!(num("LAMBDA(x, IFERROR(x, 0))(1/0)"), 0.0);
    assert!(matches!(eval("LAMBDA(x, ISNA(x))(NA())"), V::Bool(true)));
    assert_eq!(num("COUNTA(1, NA())"), 2.0);
    assert_eq!(num("COUNT(1, NA())"), 1.0);
    assert_eq!(code("CONCAT(NA(), \"a\")"), "#N/A");
    assert_eq!(code("ROWS(VSTACK(1, NA(), 3))"), "#N/A");
    assert_eq!(code("INDEX(VSTACK(1, 1/0), 1)"), "#DIV/0!");
    assert_eq!(code("VSTACK(1, NA(), 3)"), "#N/A");
    assert_eq!(code("SWITCH(1, NA(), 5, 1, 9)"), "#N/A");
    assert_eq!(num("SWITCH(1, 1, 5, NA(), 9)"), 5.0);
    assert_eq!(code("SWITCH(NA(), 1, 5, 9)"), "#N/A");
}

/// The author's Excel, 2026-11-01: conditional sections of a TEXT format. A third section keeps the minus sign.
#[test]
fn text_conditional_sections() {
    assert_eq!(text("TEXT(-5, \"[>10]0;[<0]-0\")"), "-5");
    assert!(is_error("TEXT(5, \"[>10]0;[<0]0\")"));
    assert!(is_error("TEXT(5, \"0 days\")"));
    assert_eq!(text("TEXT(-5, \"[<0]-0;0\")"), "-5");
    assert_eq!(text("TEXT(-5, \"[>10]0;[>0]0;-0\")"), "--5");
}

/// The author's Excel, 2026-11-01: PCRE2 syntax the engine must read as Excel does. 1 and 0 are REGEXTEST's TRUE and
/// FALSE; recursion and branch reset aren't run yet (backlog), so they're left out.
#[test]
fn regex_syntax_reads_as_excel() {
    let n = |src: &str| num(src);
    assert!(is_error("REGEXTEST(\"[\", \"[[]\")"));
    assert_eq!(n("REGEXTEST(\"&\", \"[a&&b]\")"), 0.0);
    assert_eq!(n("REGEXTEST(\"-\", \"[a--b]\")"), 0.0);
    assert_eq!(n("REGEXTEST(\"~\", \"[a~~b]\")"), 0.0);
    assert_eq!(n("REGEXTEST(\"a b\", \"a\\hb\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"a\" & CHAR(10) & \"b\", \"a\\Rb\")"), 1.0);
    assert_eq!(text("REGEXREPLACE(\"foobar\", \"foo\\Kbar\", \"X\")"), "fooX");
    assert_eq!(n("REGEXTEST(\"axb\", \"a\\Q.\\Eb\")"), 0.0);
    assert_eq!(text("REGEXREPLACE(\"ab\", \"(?P<x>a)\", \"[${x}]\")"), "[a]b");
    assert_eq!(text("REGEXREPLACE(\"ab\", \"(?'x'a)\", \"[${x}]\")"), "[a]b");
    assert_eq!(n("REGEXTEST(\"A\", \"\\x{41}\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"A\", \"\\101\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"1\", \"[[:^alpha:]]\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"é\", \"^\\p{L}$\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"a\" & CHAR(10), \"a\\Z\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"a\" & CHAR(10), \"a\\z\")"), 0.0);
    assert_eq!(n("REGEXTEST(\"a\" & CHAR(10) & \"b\", \"a.b\")"), 0.0);
    assert_eq!(n("REGEXTEST(\"aB\", \"a(?i)b\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"é\", \"^\\w$\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"٣\", \"^\\d$\")"), 1.0);
    assert_eq!(n("REGEXTEST(\"SS\", \"ß\", 1)"), 0.0);
    assert_eq!(n("REGEXTEST(\"é\", \"\\bé\\b\")"), 1.0);
}

/// The author's Excel, 2026-11-01: everyday answers a port from JavaScript can drift on. Floating-point smoothing
/// (`0.1+0.2=0.3`, the zero snap, scientific text past 1E+20, typed digits past 15) differs today and is left out.
#[test]
fn everyday_answers_match_excel() {
    let nums = [
        ("ROUND(2.675, 2)", 2.68),
        ("ROUND(-2.5, 0)", -3.0),
        ("ROUND(1.005, 2)", 1.01),
        ("MOD(-7, 3)", 2.0),
        ("MOD(7, -3)", -2.0),
        ("MOD(5.5, 1)", 0.5),
        ("INT(-2.5)", -3.0),
        ("CEILING(-2.5, 1)", -2.0),
        ("FLOOR(-2.5, 1)", -3.0),
        ("MROUND(-5, -2)", -6.0),
        ("LEN(0.1 + 0.2)", 3.0),
        ("VALUE(\"1,234.5\")", 1234.5),
        ("VALUE(\"12%\")", 0.12),
        ("VALUE(\"$5\")", 5.0),
        ("VALUE(\" 5 \")", 5.0),
        ("VALUE(\"1e3\")", 1000.0),
        ("VALUE(\"(5)\")", -5.0),
        ("TRUE + TRUE", 2.0),
        ("FIND(\"\", \"abc\")", 1.0),
        ("SEARCH(\"a?c\", \"xabc\")", 2.0),
        ("CODE(\"é\")", 233.0),
        ("UNICODE(\"😀\")", 128_512.0),
        ("LEN(\"😀\")", 2.0),
        ("DATE(2024, 2, 30)", 45_352.0),
        ("DATEDIF(DATE(2024, 1, 31), DATE(2024, 2, 29), \"m\")", 0.0),
        ("WEEKNUM(DATE(2024, 1, 1), 21)", 1.0),
        ("DAYS360(DATE(2024, 2, 29), DATE(2024, 3, 31))", 30.0),
        ("MODE.SNGL(1, 2, 2, 3, 3)", 2.0),
        ("AVERAGE(TRUE, 1)", 1.0),
    ];
    for (src, want) in nums {
        close(src, want, 1e-12);
    }
    close("YEARFRAC(DATE(2024, 1, 1), DATE(2024, 12, 31), 1)", 0.99726776, 1e-8);
    for (src, want) in [
        ("LEFT(12.5, 2)", "12"),
        ("1/3 & \"\"", "0.333333333333333"),
        ("PROPER(\"hello wORLD o'neil 2nd\")", "Hello World O'Neil 2Nd"),
        ("SUBSTITUTE(\"aaa\", \"a\", \"b\", 2)", "aba"),
        ("REPT(\"ab\", 2.9)", "abab"),
    ] {
        assert_eq!(text(src), want, "{src}");
    }
}

/// The author's Excel, 2026-11-02: comparisons and criteria read numbers equal to 15 significant digits as equal;
/// XMATCH and EXACT don't change; text turns scientific from 1E+20 and keeps 0.00001 whole.
#[test]
fn near_equal_numbers_compare_as_excel() {
    let t = |src: &str| matches!(eval(src), V::Bool(true));
    assert!(t("0.1 + 0.2 = 0.3"));
    assert!(t("1 - 0.9 = 0.1"));
    assert!(!t("0.1 + 0.2 <> 0.3"));
    assert!(!t("0.1 + 0.2 > 0.3"));
    assert!(t("0.1 + 0.2 <= 0.3"));
    assert!(t("0.1 + 0.2 >= 0.3"));
    assert!(!t("0.3 < 0.1 + 0.2"));
    assert!(t("1E+15 + 0.4 = 1E+15"));
    assert!(!t("0.1 + 0.2 - 0.3 = 0"));
    assert_eq!(text("IF(0.1 + 0.2 = 0.3, \"same\", \"differ\")"), "same");
    assert_eq!(num("COUNTIF(VSTACK(0.1 + 0.2, 0.3), 0.3)"), 2.0);
    assert!(is_error("XMATCH(0.3, VSTACK(0.1, 0.1 + 0.2, 0.5))"));
    assert!(t("EXACT(0.1 + 0.2, 0.3)"));
    for (src, want) in [
        ("1E+19 & \"\"", "10000000000000000000"),
        ("1.5E+19 & \"\"", "15000000000000000000"),
        ("1E+20 & \"\"", "1E+20"),
        ("-1E+20 & \"\"", "-1E+20"),
        ("1E+100 & \"\"", "1E+100"),
        ("1E+15 & \"\"", "1000000000000000"),
        ("1E+16 & \"\"", "10000000000000000"),
        ("123456789012345 & \"\"", "123456789012345"),
        ("0.0001 & \"\"", "0.0001"),
        ("0.00001 & \"\"", "0.00001"),
        ("1.23456789012345E-10 & \"\"", "1.23456789012345E-10"),
        ("0.000001 & \"\"", "0.000001"),
        ("0.0000012345 & \"\"", "0.0000012345"),
        ("0.000000001 & \"\"", "0.000000001"),
        ("1.5E-10 & \"\"", "0.00000000015"),
        ("-1.5E-10 & \"\"", "-0.00000000015"),
        ("0.00012345678901234 & \"\"", "0.00012345678901234"),
        ("0.000123456789012345 & \"\"", "0.000123456789012345"),
        ("0.0000123456789012345 & \"\"", "1.23456789012345E-05"),
        ("0.00000000123456789012345 & \"\"", "1.23456789012345E-09"),
        ("0.000000000000000001 & \"\"", "0.000000000000000001"),
        ("0.00000000000000000001 & \"\"", "1E-20"),
        ("0.5 & \"\"", "0.5"),
        ("-0.25 & \"\"", "-0.25"),
        ("(0.1 + 0.2 - 0.3) & \"\"", "5.55111512312578E-17"),
        ("(0.1 + 0.2) & \"\"", "0.3"),
    ] {
        assert_eq!(text(src), want, "{src}");
    }
}

/// The author's Excel, 2026-11-02: a formula's last `+` or `-` that cancels to 15 digits is 0, as is SUM's; the same
/// cancellation inside parentheses wrapping the whole formula, a function's argument, a product or a comparison isn't.
#[test]
fn the_last_addition_snaps_as_excel() {
    for src in ["0.1+0.2-0.3", "1-0.9-0.1", "0.3-0.1-0.2", "(0.1+0.2)-0.3", "1E+15+0.3-1E+15", "SUM(0.1, 0.2, -0.3)"] {
        assert_eq!(num(src), 0.0, "{src}");
    }
    for src in ["(0.1+0.2-0.3)", "0.1+0.2-0.3+0", "ABS(0.1+0.2-0.3)"] {
        close(src, 5.551115123125783e-17, 1e-30);
    }
    close("(0.1+0.2-0.3)*1E+17", 5.551115123125783, 1e-12);
    assert_eq!(num("LAMBDA(x, x-0.3)(0.1+0.2)"), 0.0);
}

/// The unit-aware Expression path snaps its last `+` or `-` as a plain formula does.
#[test]
fn the_unit_expression_path_snaps_too() {
    let env: solenoid_core::eval::Env =
        [("a".to_string(), V::Num(0.1)), ("b".to_string(), V::Num(0.2))].into_iter().collect();
    let got = solenoid_core::unit_expression::expression_units("a+b-0.3", &env, &[]);
    assert!(matches!(got, Some(V::Num(n)) if n == 0.0), "{got:?}");
    let wrapped = solenoid_core::unit_expression::expression_units("(a+b-0.3)", &env, &[]);
    assert!(matches!(wrapped, Some(V::Num(n)) if n != 0.0), "{wrapped:?}");
}

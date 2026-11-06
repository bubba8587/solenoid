// Research prototype (branch research/mathlib-lens only): docs/audits/mathlib-lens-2026-11.md thread on the Type Settle.
//! On a graph without loops each port's type is a function of the ports upstream of it, so the settle's answer is
//! fixed by the wiring; only the number of passes depends on the visit order. Probes a chain of passthroughs listed
//! with and against the wiring.

use serde_json::json;
use solenoid_graph::conduit::Cable;
use solenoid_graph::settle::{node_from_json, settle, types_json};

fn chain(n: usize, backwards: bool) -> String {
    let mut facts = vec![json!({"id": "src", "ins": [], "outs": [["out", "number", "number", 0]], "pass": []})];
    let mut cables = Vec::new();
    for i in 0..n {
        facts.push(json!({
            "id": format!("p{i}"),
            "ins": [["in", "trueany", "trueany", 2]],
            "outs": [["out", "trueany", "trueany", 2]],
            "pass": [{"output": "out", "inputs": ["in"], "combine": "single"}],
        }));
        let from = if i == 0 { "src".to_string() } else { format!("p{}", i - 1) };
        cables.push(Cable { id: String::new(), source: from, source_output: "out".into(), target: format!("p{i}"), target_input: "in".into() });
    }
    if backwards {
        facts[1..].reverse();
    }
    let mut nodes: Vec<_> = facts.iter().map(node_from_json).collect();
    settle(&mut nodes, &cables);
    let types = types_json(&nodes);
    types[format!("p{}", n - 1)]["outs"]["out"].as_str().unwrap_or("?").to_string()
}

#[test]
fn a_chain_settles_whatever_the_order_within_the_caps() {
    for n in [5, 32, 33, 256, 257, 400] {
        let fwd = chain(n, false);
        let back = chain(n, true);
        println!("chain of {n:3}: listed with the wiring -> {fwd:8} listed against it -> {back}");
    }
}

fn cable(from: &str, out: &str, to: &str, input: &str) -> Cable {
    Cable { id: String::new(), source: from.into(), source_output: out.into(), target: to.into(), target_input: input.into() }
}

fn settled(facts: &[serde_json::Value], cables: &[Cable]) -> serde_json::Value {
    let mut nodes: Vec<_> = facts.iter().map(node_from_json).collect();
    settle(&mut nodes, cables);
    types_json(&nodes)
}

/// Loops (thread 6): an IF-like card whose one branch is a number and whose other branch is its own output, fed back
/// through a passthrough. Both "everything unknown" and "everything a number" are consistent typings; which one does
/// the settle pick, and does the visit order change it?
#[test]
fn a_loop_through_an_agreeing_card() {
    let src = json!({"id": "src", "ins": [], "outs": [["out", "number", "number", 0]], "pass": []});
    let iff = json!({
        "id": "if",
        "ins": [["t", "trueany", "trueany", 2], ["f", "trueany", "trueany", 2]],
        "outs": [["out", "trueany", "trueany", 2]],
        "pass": [{"output": "out", "inputs": ["t", "f"], "combine": "agree"}],
    });
    let back = json!({
        "id": "back",
        "ins": [["in", "trueany", "trueany", 2]],
        "outs": [["out", "trueany", "trueany", 2]],
        "pass": [{"output": "out", "inputs": ["in"], "combine": "single"}],
    });
    let cables = [cable("src", "out", "if", "t"), cable("if", "out", "back", "in"), cable("back", "out", "if", "f")];
    for order in [[&src, &iff, &back], [&back, &iff, &src], [&iff, &back, &src]] {
        let facts: Vec<_> = order.iter().map(|j| (*j).clone()).collect();
        let t = settled(&facts, &cables);
        println!(
            "order {:?}: if.out = {}, back.out = {}",
            order.iter().map(|j| j["id"].as_str().unwrap_or("")).collect::<Vec<_>>(),
            t["if"]["outs"]["out"],
            t["back"]["outs"]["out"]
        );
    }
}

/// A plain loop of two passthroughs with nothing feeding it from outside.
#[test]
fn a_loop_of_passthroughs_alone() {
    let p = |id: &str| json!({
        "id": id,
        "ins": [["in", "trueany", "trueany", 2]],
        "outs": [["out", "trueany", "trueany", 2]],
        "pass": [{"output": "out", "inputs": ["in"], "combine": "single"}],
    });
    let cables = [cable("a", "out", "b", "in"), cable("b", "out", "a", "in")];
    let t = settled(&[p("a"), p("b")], &cables);
    println!("two passthroughs in a loop: a.out = {}, b.out = {}", t["a"]["outs"]["out"], t["b"]["outs"]["out"]);
}

/// Thread 2: the widening order is a preorder over the concrete types once the combo-to-scalar narrowing is set aside,
/// and the narrowing edges do not compose.
#[test]
fn widening_is_a_preorder_and_narrowing_does_not_compose() {
    use solenoid_graph::lattice::{can_connect, is_wildcard_rung, lattice_rank, TYPES};
    let concrete: Vec<&str> = TYPES.iter().copied().filter(|t| !is_wildcard_rung(t) && *t != "trueany").collect();
    let narrowing = |a: &str, b: &str| matches!((lattice_rank(a), lattice_rank(b)), (Some(x), Some(y)) if x > y);
    let widens = |a: &str, b: &str| can_connect(a, b) && !narrowing(a, b);
    let mut broken = Vec::new();
    for a in &concrete {
        assert!(can_connect(a, a), "{a} reaches itself");
        for b in &concrete {
            for c in &concrete {
                if widens(a, b) && widens(b, c) && !widens(a, c) {
                    broken.push(format!("{a} -> {b} -> {c}"));
                }
            }
        }
    }
    assert!(broken.is_empty(), "widening chains that don't compose: {broken:?}");
    let narrow: Vec<String> = concrete
        .iter()
        .flat_map(|a| concrete.iter().filter(move |b| can_connect(a, b) && narrowing(a, b)).map(move |b| format!("{a}->{b}")))
        .collect();
    println!("{} concrete types; narrowing edges: {narrow:?}", concrete.len());
    assert!(can_connect("list", "numlist") && can_connect("numlist", "number") && !can_connect("list", "number"));
}

/// Thread 1 (F5): coercions agree along paths. For every widening chain A -> B -> C among the concrete types, a value
/// of type A coerced to B and then to C must equal the value coerced straight to C.
#[test]
fn coercions_agree_along_widening_paths() {
    use solenoid_core::excel_functions::V;
    use solenoid_core::nodes::Cv;
    use solenoid_graph::boundary_core::{coerce_all, Arrived, Facts};
    use solenoid_graph::lattice::{can_connect, is_wildcard_rung, lattice_rank, TYPES};
    use std::rc::Rc;
    let l = |xs: Vec<V>| V::List(Rc::new(xs));
    let samples: Vec<(&str, V)> = vec![
        ("number", V::Num(5.0)),
        ("list", l(vec![V::Num(1.0), V::Num(2.0)])),
        ("numlist", l(vec![V::Num(5.0)])),
        ("numlist", l(vec![V::Num(1.0), V::Null, V::Num(3.0)])),
        ("table", l(vec![l(vec![V::Num(1.0), V::Num(2.0)]), l(vec![V::Num(3.0), V::Num(4.0)])])),
        ("logical", V::Bool(true)),
        ("logicallist", l(vec![V::Bool(true), V::Bool(false)])),
        ("logicaltable", l(vec![l(vec![V::Bool(true)])])),
        ("string", V::str("a")),
        ("strlist", l(vec![V::str("a"), V::str("b")])),
        ("strtable", l(vec![l(vec![V::str("a")])])),
        ("date", V::Date(45000.0)),
        ("datelist", l(vec![V::Date(45000.0), V::Date(45001.0)])),
        ("list", l(Vec::new())),
        ("number", V::Null),
    ];
    let coerce = |rung: &str, v: &Cv| -> String {
        let rung_of = |k: &str| (k == "a").then(|| rung.to_string());
        match coerce_all(&Facts::default(), &rung_of, &[("a".to_string(), vec![Arrived { v: v.clone(), munit: None }])]) {
            Ok(out) => format!("{:?}", out[0].1[0].v),
            Err(_) => "thrown".into(),
        }
    };
    let coerce_cv = |rung: &str, v: &Cv| -> Option<Cv> {
        let rung_of = |k: &str| (k == "a").then(|| rung.to_string());
        coerce_all(&Facts::default(), &rung_of, &[("a".to_string(), vec![Arrived { v: v.clone(), munit: None }])])
            .ok()
            .map(|out| out[0].1[0].v.clone())
    };
    let concrete: Vec<&str> =
        TYPES.iter().copied().filter(|t| !is_wildcard_rung(t) && *t != "trueany" && !matches!(*t, "lambda" | "chart" | "document")).collect();
    let narrowing = |a: &str, b: &str| matches!((lattice_rank(a), lattice_rank(b)), (Some(x), Some(y)) if x > y);
    let widens = |a: &str, b: &str| can_connect(a, b) && !narrowing(a, b);
    let (mut checked, mut differ) = (0, Vec::new());
    for (a, v) in &samples {
        let v = Cv::V(v.clone());
        for b in &concrete {
            for c in &concrete {
                if b == c || !(widens(a, b) && widens(b, c) && widens(a, c)) {
                    continue;
                }
                let direct = coerce(c, &v);
                let Some(via) = coerce_cv(b, &v) else { continue };
                let through = coerce(c, &via);
                checked += 1;
                if direct != through {
                    differ.push(format!("{a} {:?}: via {b} to {c} gives {through}, straight gives {direct}", v));
                }
            }
        }
    }
    println!("{checked} paths checked, {} differ", differ.len());
    let fam = |t: &str| solenoid_graph::lattice::element_family(t).unwrap_or(t).to_string();
    let mut kinds: std::collections::BTreeMap<String, Vec<&String>> = Default::default();
    for d in &differ {
        let w: Vec<&str> = d.split_whitespace().collect();
        let (a, b, c) = (w[0], w[w.iter().position(|x| *x == "via").unwrap() + 1], w[w.iter().position(|x| *x == "to").unwrap() + 1]);
        let kind = if fam(b) != fam(a) && (fam(b) == "logical" || fam(a) == "logical") {
            "crosses the logical bridge"
        } else if ["logicaltable", "strtable", "datetable", "complextable"].contains(&c) || ["logicaltable", "strtable", "datetable", "complextable"].contains(&b) {
            "a non-number matrix rung"
        } else if c == "cube" && b == "frame" {
            "frame to cube keeps the column type"
        } else {
            "other"
        };
        kinds.entry(kind.to_string()).or_default().push(d);
    }
    for (k, ds) in &kinds {
        println!("{k}: {}", ds.len());
        if k != "crosses the logical bridge" {
            for d in ds.iter().take(8) {
                println!("    {}", d.chars().take(230).collect::<String>());
            }
        }
    }
}

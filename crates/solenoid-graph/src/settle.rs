// [[C10]] socketLattice, [[C130]] rustCore
//! The Type Settle: Conduit lane typing and adoption, run to a joint fixpoint over the graph
//! (`tree/specs/values/type-propagation-on-in-place-socket-retype.md`). Each node's facts are the app's
//! (`settleFacts.ts`); the order and the cables are the graph's.

use std::collections::{BTreeSet, HashMap};

use serde_json::{json, Value as Json};

use crate::conduit::Cable;
use crate::lattice::{adopt_type_for_base, agree_types, combo_of, project_type_to_base};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Fixed,
    Mutable,
    Adoptive,
}

pub struct Socket {
    pub key: String,
    pub now: String,
    pub base: String,
    pub kind: Kind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Combine {
    Single,
    Agree,
    Active,
}

/// How a passthrough reads a forwarded table: a frame or cube as the type named, another table as `trueany` or its
/// combo, anything else as its combo.
pub struct Project {
    pub frame: String,
    pub cube: String,
    pub tables_trueany: bool,
}

pub struct Pass {
    pub output: String,
    pub inputs: Vec<String>,
    pub combine: Combine,
    pub active: Option<f64>,
    pub project: Option<Project>,
}

pub struct Node {
    pub id: String,
    pub ins: Vec<Socket>,
    pub outs: Vec<Socket>,
    pub pass: Vec<Pass>,
    pub lanes: Option<Vec<(String, String)>>,
    pub error_only: bool,
}

pub struct Settled {
    pub conduit_changed: bool,
    pub adopted: BTreeSet<String>,
}

fn s(j: &Json) -> String {
    j.as_str().unwrap_or_default().to_string()
}

fn sockets(j: &Json) -> Vec<Socket> {
    j.as_array()
        .into_iter()
        .flatten()
        .map(|f| Socket {
            key: s(&f[0]),
            now: s(&f[1]),
            base: s(&f[2]),
            kind: match f[3].as_u64() {
                Some(2) => Kind::Adoptive,
                Some(1) => Kind::Mutable,
                _ => Kind::Fixed,
            },
        })
        .collect()
}

/// A node's facts as `settleFacts.ts` writes them.
pub fn node_from_json(j: &Json) -> Node {
    let pass = j["pass"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| Pass {
            output: s(&p["output"]),
            inputs: p["inputs"]
                .as_array()
                .into_iter()
                .flatten()
                .map(s)
                .collect(),
            combine: match p["combine"].as_str() {
                Some("agree") => Combine::Agree,
                Some("active") => Combine::Active,
                _ => Combine::Single,
            },
            active: p["active"].as_f64(),
            project: p.get("project").filter(|x| x.is_object()).map(|x| Project {
                frame: s(&x["frame"]),
                cube: s(&x["cube"]),
                tables_trueany: x["tables"].as_str() == Some("trueany"),
            }),
        })
        .collect();
    let lanes = j["lanes"]
        .as_array()
        .map(|ls| ls.iter().map(|l| (s(&l[0]), s(&l[1]))).collect());
    Node {
        id: s(&j["id"]),
        ins: sockets(&j["ins"]),
        outs: sockets(&j["outs"]),
        pass,
        lanes,
        error_only: j["errorOnly"].as_bool() == Some(true),
    }
}

struct Graph<'a> {
    cables: &'a [Cable],
    /// Each node's place in the order, and the first cable into each input.
    at: HashMap<&'a str, usize>,
    feeds: HashMap<(&'a str, &'a str), &'a Cable>,
}

impl Graph<'_> {
    fn feed(&self, target: &str, input: &str) -> Option<&Cable> {
        self.feeds.get(&(target, input)).copied()
    }

    fn index(&self, id: &str) -> Option<usize> {
        self.at.get(id).copied()
    }

    fn out_type(&self, nodes: &[Node], id: &str, key: &str) -> Option<String> {
        let n = &nodes[self.index(id)?];
        n.outs.iter().find(|o| o.key == key).map(|o| o.now.clone())
    }
}

fn conduits_once(nodes: &mut [Node], g: &Graph) -> bool {
    let mut changed = false;
    for i in 0..nodes.len() {
        let Some(lanes) = nodes[i].lanes.clone() else {
            continue;
        };
        for (in_key, out_key) in lanes {
            let Some(o) = nodes[i]
                .outs
                .iter()
                .position(|s| s.key == out_key && s.kind != Kind::Fixed)
            else {
                continue;
            };
            let is_conduit = |id: &str| g.index(id).is_some_and(|n| nodes[n].lanes.is_some());
            let want = g
                .feed(&nodes[i].id, &in_key)
                .and_then(|f| {
                    let (id, key) = crate::conduit::typed_source(
                        &is_conduit,
                        g.cables,
                        &f.source,
                        &f.source_output,
                    );
                    g.out_type(nodes, &id, &key)
                })
                .unwrap_or_else(|| "trueany".into());
            if nodes[i].outs[o].now != want {
                nodes[i].outs[o].now = want;
                changed = true;
            }
        }
    }
    changed
}

fn conduits(nodes: &mut [Node], g: &Graph) -> bool {
    let mut any = false;
    for _ in 0..32 {
        if !conduits_once(nodes, g) {
            break;
        }
        any = true;
    }
    any
}

fn project(p: &Project, t: &str) -> String {
    if t == "frame" {
        return p.frame.clone();
    }
    if t == "cube" {
        return p.cube.clone();
    }
    let two_d = t == "frame"
        || t == "cube"
        || (crate::lattice::lattice_rank(t) == Some(2) && t != "anydata");
    if p.tables_trueany && two_d {
        return "trueany".into();
    }
    combo_of(t).unwrap_or("trueany").to_string()
}

fn adoption_once(nodes: &mut [Node], g: &Graph) -> BTreeSet<String> {
    let mut changed = BTreeSet::new();
    for i in 0..nodes.len() {
        let id = nodes[i].id.clone();
        for k in 0..nodes[i].ins.len() {
            if nodes[i].ins[k].kind != Kind::Adoptive {
                continue;
            }
            let base = nodes[i].ins[k].base.clone();
            let want = match g.feed(&id, &nodes[i].ins[k].key) {
                Some(f) => match g.out_type(nodes, &f.source, &f.source_output) {
                    Some(out) => adopt_type_for_base(&base, &out).to_string(),
                    None => base,
                },
                None => base,
            };
            if nodes[i].ins[k].now != want {
                nodes[i].ins[k].now = want;
                changed.insert(id.clone());
            }
        }
        let vote = |nodes: &[Node], key: &str| -> Option<String> {
            let f = g.feed(&id, key)?;
            if g.index(&f.source).is_some_and(|s| nodes[s].error_only) {
                return None;
            }
            Some(
                nodes[i]
                    .ins
                    .iter()
                    .find(|s| s.key == key)
                    .map_or("trueany".into(), |s| s.now.clone()),
            )
        };
        for p in 0..nodes[i].pass.len() {
            let spec = &nodes[i].pass[p];
            let forwarded = match spec.combine {
                Combine::Single => spec
                    .inputs
                    .first()
                    .and_then(|k| vote(nodes, k))
                    .unwrap_or_else(|| "trueany".into()),
                Combine::Active => {
                    if spec.inputs.is_empty() {
                        "trueany".into()
                    } else {
                        let at = spec
                            .active
                            .unwrap_or(0.0)
                            .min((spec.inputs.len() - 1) as f64)
                            .max(0.0) as usize;
                        vote(nodes, &spec.inputs[at]).unwrap_or_else(|| "trueany".into())
                    }
                }
                Combine::Agree => {
                    let votes: Vec<Option<String>> =
                        spec.inputs.iter().map(|k| vote(nodes, k)).collect();
                    let refs: Vec<Option<&str>> = votes.iter().map(Option::as_deref).collect();
                    agree_types(&refs).to_string()
                }
            };
            let resolved = match &spec.project {
                Some(pr) => project(pr, &forwarded),
                None => forwarded,
            };
            let out_key = spec.output.clone();
            let Some(o) = nodes[i]
                .outs
                .iter()
                .position(|s| s.key == out_key && s.kind != Kind::Fixed)
            else {
                continue;
            };
            let sock = &nodes[i].outs[o];
            let want = if sock.kind == Kind::Adoptive {
                project_type_to_base(&sock.base, &resolved).to_string()
            } else {
                resolved
            };
            if nodes[i].outs[o].now != want {
                nodes[i].outs[o].now = want;
                changed.insert(id.clone());
            }
        }
    }
    changed
}

fn adoption(nodes: &mut [Node], g: &Graph) -> BTreeSet<String> {
    let mut all = BTreeSet::new();
    for _ in 0..32 {
        let changed = adoption_once(nodes, g);
        if changed.is_empty() {
            break;
        }
        all.extend(changed);
    }
    all
}

/// Settles every wildcard socket in `nodes` (in graph order) over `cables`: Conduit lanes and adoption alternate until
/// both settle, at most 8 rounds.
pub fn settle(nodes: &mut [Node], cables: &[Cable]) -> Settled {
    let ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let mut feeds = HashMap::new();
    for c in cables {
        feeds
            .entry((c.target.as_str(), c.target_input.as_str()))
            .or_insert(c);
    }
    let g = Graph {
        cables,
        at: ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect(),
        feeds,
    };
    let mut conduit_changed = false;
    let mut adopted = BTreeSet::new();
    for _ in 0..8 {
        let c = conduits(nodes, &g);
        let a = adoption(nodes, &g);
        conduit_changed |= c;
        let none = a.is_empty();
        adopted.extend(a);
        if !c && none {
            break;
        }
    }
    Settled {
        conduit_changed,
        adopted,
    }
}

/// Every socket's type, per node: `{ id: { ins: { key: type }, outs: { key: type } } }`.
pub fn types_json(nodes: &[Node]) -> Json {
    let side =
        |ss: &[Socket]| Json::Object(ss.iter().map(|s| (s.key.clone(), json!(s.now))).collect());
    Json::Object(
        nodes
            .iter()
            .map(|n| {
                (
                    n.id.clone(),
                    json!({ "ins": side(&n.ins), "outs": side(&n.outs) }),
                )
            })
            .collect(),
    )
}

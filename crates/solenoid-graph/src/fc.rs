// [[C25]] firstClassUnits, [[D102]] graphOnCore
//! The Format Controller reconcile (`tree/specs/values/type-propagation-on-in-place-socket-retype.md`): each FC's type,
//! from what it is docked on or wired to, and the from-unit a Convert ahead dictates to it; and each Convert's arrows.
//! Each node's facts are the app's (`fcFacts.ts`); the order and the cables are the graph's.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value as Json};

use crate::conduit::Cable;
use crate::lattice::is_wildcard_rung;

const TRUEANY: &str = "trueany";

pub struct Node {
    pub id: String,
    pub ins: HashMap<String, String>,
    pub outs: HashMap<String, String>,
    pub pure: bool,
    pub convert: Option<String>,
    /// An FC: `None` free, else docked on `(host, key, side is input)`.
    pub fc: Option<Option<(String, String, bool)>>,
}

fn types(j: &Json) -> HashMap<String, String> {
    j.as_object()
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string())))
        .collect()
}

/// A node's facts as `fcFacts.ts` writes them.
pub fn node_from_json(j: &Json) -> Node {
    let s = |x: &Json| x.as_str().unwrap_or_default().to_string();
    Node {
        id: s(&j["id"]),
        ins: types(&j["ins"]),
        outs: types(&j["outs"]),
        pure: j["pure"] == true,
        convert: j["convert"].as_str().map(String::from),
        fc: j.get("fc").filter(|f| f.is_object()).map(|f| {
            f["host"]
                .as_str()
                .filter(|h| !h.is_empty())
                .map(|h| (h.to_string(), s(&f["key"]), f["side"] == "input"))
        }),
    }
}

pub struct Reconciled {
    /// Each FC, in graph order: its type and its dictated from-unit (empty when none).
    pub fcs: Vec<(String, String, String)>,
    /// Each Convert, in graph order: whether its `in` and its `out` are wired.
    pub converts: Vec<(String, bool, bool)>,
}

struct Graph<'a> {
    at: HashMap<String, usize>,
    cables: &'a [Cable],
}

impl Graph<'_> {
    /// The first concrete type behind `id.key`, back through every wildcard and every input of a node that has one.
    fn concrete(
        &self,
        nodes: &[Node],
        id: &str,
        key: &str,
        seen: &mut HashSet<(String, String)>,
    ) -> String {
        if !seen.insert((id.to_string(), key.to_string())) {
            return TRUEANY.into();
        }
        let own = self.at.get(id).and_then(|&i| nodes[i].outs.get(key));
        if let Some(t) = own.filter(|t| !is_wildcard_rung(t)) {
            return t.clone();
        }
        for c in self.cables.iter().filter(|c| c.target == id) {
            let t = self.concrete(nodes, &c.source, &c.source_output, seen);
            if !is_wildcard_rung(&t) {
                return t;
            }
        }
        TRUEANY.into()
    }

    fn fc_type(&self, nodes: &[Node], i: usize) -> String {
        let id = &nodes[i].id;
        match &nodes[i].fc {
            Some(Some((host, key, false))) => self.concrete(nodes, host, key, &mut HashSet::new()),
            Some(Some((host, key, true))) => self
                .at
                .get(host.as_str())
                .and_then(|&h| nodes[h].ins.get(key))
                .filter(|t| !is_wildcard_rung(t))
                .cloned()
                .unwrap_or_else(|| TRUEANY.into()),
            _ => {
                for c in self.cables {
                    if c.target == *id && c.target_input == "in" {
                        let t =
                            self.concrete(nodes, &c.source, &c.source_output, &mut HashSet::new());
                        if !is_wildcard_rung(&t) {
                            return t;
                        }
                    } else if c.source == *id && c.source_output == "out" {
                        let t = self
                            .at
                            .get(c.target.as_str())
                            .and_then(|&n| nodes[n].ins.get(&c.target_input));
                        if let Some(t) = t.filter(|t| !is_wildcard_rung(t)) {
                            return t.clone();
                        }
                    }
                }
                TRUEANY.into()
            }
        }
    }

    /// The from-unit of the first Convert ahead of `id`, through pure passthroughs, at most 32 hops.
    fn dictated(&self, nodes: &[Node], id: &str) -> String {
        let mut nid = id.to_string();
        for _ in 0..32 {
            if nid.is_empty() {
                break;
            }
            let mut next = String::new();
            for c in self.cables.iter().filter(|c| c.source == nid) {
                let Some(&n) = self.at.get(c.target.as_str()) else {
                    continue;
                };
                if let Some(from) = &nodes[n].convert {
                    return from.clone();
                }
                if nodes[n].pure {
                    next = c.target.clone();
                    break;
                }
            }
            nid = next;
        }
        String::new()
    }
}

/// Reconciles every FC in graph order, each one's new type seen by the ones after it, and every Convert's arrows.
pub fn reconcile(nodes: &mut [Node], cables: &[Cable]) -> Reconciled {
    let g = Graph {
        at: nodes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.clone(), i))
            .collect(),
        cables,
    };
    let mut fcs = Vec::new();
    for i in 0..nodes.len() {
        if nodes[i].fc.is_none() {
            continue;
        }
        let t = g.fc_type(nodes, i);
        nodes[i].ins.insert("in".into(), t.clone());
        nodes[i].outs.insert("out".into(), t.clone());
        fcs.push((nodes[i].id.clone(), t, String::new()));
    }
    for fc in &mut fcs {
        fc.2 = g.dictated(nodes, &fc.0);
    }
    let converts = nodes
        .iter()
        .filter(|n| n.convert.is_some())
        .map(|n| {
            let up = cables
                .iter()
                .any(|c| c.target == n.id && c.target_input == "in");
            let down = cables
                .iter()
                .any(|c| c.source == n.id && c.source_output == "out");
            (n.id.clone(), up, down)
        })
        .collect();
    Reconciled { fcs, converts }
}

/// `{ fcs: [[id, type, dictated]], converts: [[id, up, down]] }`.
pub fn reconciled_json(r: &Reconciled) -> Json {
    json!({ "fcs": r.fcs, "converts": r.converts })
}

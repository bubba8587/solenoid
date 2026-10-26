// [[C25]] firstClassUnits, [[D41]] formatFlowsDownstream, [[D102]] graphOnCore
//! The annotation walk (`tree/specs/values/unit-flow.md` § The format annotation): the unit and format a value carries,
//! read upstream from where it was set, and the one downstream that governs an output; and where a value really comes
//! from. Each node's facts are the app's (`annotationFacts.ts`); an annotation is opaque here but for its unit,
//! format and custom unit.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value as Json};

use crate::conduit::Cable;

pub struct Node<'a> {
    pub id: String,
    pub facts: &'a Json,
}

fn s(j: &Json) -> Option<&str> {
    j.as_str()
}

fn is_date_style(format: &str) -> bool {
    format.starts_with("date_") || format.starts_with("time_") || format == "datetime"
}

/// The one annotation all of `anns` agree on (by unit, format and custom unit), if any.
fn combine(anns: Vec<Option<Json>>) -> Option<Json> {
    let real: Vec<Json> = anns.into_iter().flatten().collect();
    let key = |a: &Json| {
        (
            a["unit"].clone(),
            a["format"].clone(),
            a["customUnit"].clone(),
        )
    };
    let first = real.first()?;
    real.iter()
        .all(|a| key(a) == key(first))
        .then(|| first.clone())
}

/// A resolving node's annotation: its own, or, inheriting, the one upstream wearing its own unit.
fn resolve(f: &Json, inherited: Option<Json>) -> Json {
    match inherited {
        Some(mut a) if f["inherit"] == true => {
            a["unit"] = f["own"]["unit"].clone();
            a["customUnit"] = f["own"]["customUnit"].clone();
            a
        }
        _ => f["own"].clone(),
    }
}

pub struct Walk<'a> {
    nodes: HashMap<&'a str, &'a Json>,
    /// The cables into each node and out of each node, in cable order.
    into: HashMap<&'a str, Vec<&'a Cable>>,
    from: HashMap<&'a str, Vec<&'a Cable>>,
    memo: HashMap<(String, String), Option<Json>>,
    visiting: HashSet<(String, String)>,
    down_memo: HashMap<(String, String), Option<Json>>,
    down_visiting: HashSet<(String, String)>,
}

impl<'a> Walk<'a> {
    pub fn new(nodes: &'a [Node<'a>], cables: &'a [Cable]) -> Self {
        Walk {
            nodes: nodes.iter().map(|n| (n.id.as_str(), n.facts)).collect(),
            into: cables.iter().fold(HashMap::new(), |mut m, c| {
                m.entry(c.target.as_str()).or_insert_with(Vec::new).push(c);
                m
            }),
            from: cables.iter().fold(HashMap::new(), |mut m, c| {
                m.entry(c.source.as_str()).or_insert_with(Vec::new).push(c);
                m
            }),
            memo: HashMap::new(),
            visiting: HashSet::new(),
            down_memo: HashMap::new(),
            down_visiting: HashSet::new(),
        }
    }

    fn cables_into(&self, id: &str) -> &[&'a Cable] {
        self.into.get(id).map_or(&[], Vec::as_slice)
    }

    /// The annotation on the cable into `id.key`.
    pub fn in_annotation(&mut self, id: &str, key: &str) -> Option<Json> {
        let feed = *self
            .cables_into(id)
            .iter()
            .find(|c| c.target_input == key)?;
        let (source, output) = (feed.source.clone(), feed.source_output.clone());
        self.out_annotation(&source, &output)
    }

    pub fn out_annotation(&mut self, id: &str, key: &str) -> Option<Json> {
        let k = (id.to_string(), key.to_string());
        if let Some(a) = self.memo.get(&k) {
            return a.clone();
        }
        if !self.visiting.insert(k.clone()) {
            return None;
        }
        let a = self.compute(id, key);
        self.visiting.remove(&k);
        self.memo.insert(k, a.clone());
        a
    }

    fn compute(&mut self, id: &str, key: &str) -> Option<Json> {
        let f = *self.nodes.get(id)?;
        if f["convert"] == true {
            return None;
        }
        if let Some(a) = f["produced"].get(key) {
            return Some(a.clone());
        }
        if f["resolves"] == true {
            let inherited = self.in_annotation(id, "in");
            return Some(resolve(f, inherited));
        }
        if f.get("own").is_some() {
            return Some(f["own"].clone());
        }
        if let Some(pass) = f.get("pass") {
            if let Some(sel) = pass.get("selected").and_then(s).filter(|x| !x.is_empty()) {
                return self.in_annotation(id, sel);
            }
            let Some(keys) = pass["keys"].as_array() else {
                let first = *self.cables_into(id).first()?;
                let (source, output) = (first.source.clone(), first.source_output.clone());
                return self.out_annotation(&source, &output);
            };
            let keys: Vec<String> = keys.iter().filter_map(s).map(String::from).collect();
            let anns = keys.iter().map(|k| self.in_annotation(id, k)).collect();
            return combine(anns);
        }
        if f["lanes"] == true {
            if let Some(n) = key
                .strip_prefix("out_")
                .filter(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
            {
                return self.in_annotation(id, &format!("in_{n}"));
            }
        }
        self.carried(id, key, f)
    }

    fn carried(&mut self, id: &str, key: &str, f: &Json) -> Option<Json> {
        let spec = f["carry"].get(key)?;
        let out_family = s(&f["families"]["outs"][key])?;
        let mut eligible: Vec<Json> = Vec::new();
        for input in spec["inputs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(s)
        {
            let Some(ann) = self.in_annotation(id, input) else {
                continue;
            };
            if s(&f["families"]["ins"][input]) != Some(out_family) {
                continue;
            }
            eligible.push(ann);
        }
        let first = eligible.first()?;
        let date = |a: &Json| is_date_style(a["format"].as_str().unwrap_or_default());
        if spec["notDate"] == true && date(first) {
            return None;
        }
        if eligible.iter().filter(|a| date(a)).count() >= 2 {
            return None;
        }
        let mut out = first.clone();
        out["unit"] = json!("none");
        out["customUnit"] = json!("");
        Some(out)
    }

    /// The annotation that governs `id.key` from downstream: the first consumer that sets one, through pure
    /// passthroughs.
    pub fn downstream_annotation(&mut self, id: &str, key: &str) -> Option<Json> {
        let k = (id.to_string(), key.to_string());
        if let Some(a) = self.down_memo.get(&k) {
            return a.clone();
        }
        if !self.down_visiting.insert(k.clone()) {
            return None;
        }
        let mut found = None;
        let consumers: Vec<String> = self
            .from
            .get(id)
            .map_or(&[][..], Vec::as_slice)
            .iter()
            .filter(|c| c.source_output == key)
            .map(|c| c.target.clone())
            .collect();
        for target in consumers {
            let Some(f) = self.nodes.get(target.as_str()).copied() else {
                continue;
            };
            if f["resolves"] == true {
                let inherited = self.in_annotation(&target, "in");
                found = Some(resolve(f, inherited));
                break;
            }
            if f.get("own").is_some() {
                found = Some(f["own"].clone());
                break;
            }
            if f["pass"]["pure"] == true {
                let outs: Vec<String> = f["outs"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(s)
                    .map(String::from)
                    .collect();
                for ok in outs {
                    if let Some(a) = self.downstream_annotation(&target, &ok) {
                        found = Some(a);
                        break;
                    }
                }
                if found.is_some() {
                    break;
                }
            }
        }
        self.down_visiting.remove(&k);
        self.down_memo.insert(k, found.clone());
        found
    }

    /// Where `id`'s value really comes from: back through Format Controllers and passthroughs that forward one input.
    pub fn value_origin(&self, id: &str) -> String {
        let mut seen = HashSet::new();
        let mut id = id.to_string();
        while seen.insert(id.clone()) {
            let Some(f) = self.nodes.get(id.as_str()).copied() else {
                break;
            };
            if f["convert"] == true {
                break;
            }
            let in_key: Option<String> = if f["fc"] == true {
                Some("in".into())
            } else if let Some(pass) = f.get("pass") {
                match pass.get("selected") {
                    Some(Json::Null) => break,
                    Some(Json::String(sel)) => Some(sel.clone()),
                    _ => match pass["keys"].as_array() {
                        None => None,
                        Some(keys) => {
                            let keys: Vec<&str> = keys.iter().filter_map(s).collect();
                            let wired: Vec<&str> = keys
                                .into_iter()
                                .filter(|k| {
                                    self.cables_into(&id).iter().any(|c| c.target_input == *k)
                                })
                                .collect();
                            if wired.len() != 1 {
                                break;
                            }
                            Some(wired[0].to_string())
                        }
                    },
                }
            } else {
                break;
            };
            let Some(conn) = self
                .cables_into(&id)
                .iter()
                .find(|c| in_key.as_deref().is_none_or(|k| c.target_input == k))
            else {
                break;
            };
            id = conn.source.clone();
        }
        id
    }
}

/// Every port's annotation and every node's value origin:
/// `{ out: { "id.key": ann }, down: { .. }, in: { .. }, origin: { id: id } }`, null where none.
pub fn resolve_all(nodes: &[Node], cables: &[Cable]) -> Json {
    let mut w = Walk::new(nodes, cables);
    let (mut out, mut down, mut ins, mut origin) = (Map::new(), Map::new(), Map::new(), Map::new());
    for n in nodes {
        for k in n.facts["outs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(s)
        {
            out.insert(
                format!("{}.{k}", n.id),
                w.out_annotation(&n.id, k).unwrap_or(Json::Null),
            );
            down.insert(
                format!("{}.{k}", n.id),
                w.downstream_annotation(&n.id, k).unwrap_or(Json::Null),
            );
        }
        for k in n.facts["ins"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(s)
        {
            ins.insert(
                format!("{}.{k}", n.id),
                w.in_annotation(&n.id, k).unwrap_or(Json::Null),
            );
        }
        origin.insert(n.id.clone(), json!(w.value_origin(&n.id)));
    }
    json!({ "out": out, "down": down, "in": ins, "origin": origin })
}

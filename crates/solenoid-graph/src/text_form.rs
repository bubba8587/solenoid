// [[B12]] losslessSaves, [[B16]] oneFormulaSurface, [[C130]] rustCore
//! The text form a save passes through (`tree/specs/documents/save-format.md` § The text form): a line per node in
//! dependency order (`Name: Type field=value lit:key=n str:key="t" input<-Source.output`), then `---` and a JSON
//! sidecar of positions and side tables. The app names the nodes and owns the init field order (`textForm.ts`);
//! everything else is here.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value as Js};

pub type Obj = Map<String, Js>;

const SEPARATOR: &str = "---";
const EMPTY_LIT: &str = "lit:{}";
const EMPTY_STR: &str = "str:{}";

fn parse(text: &str) -> Result<Js, String> {
    serde_json::from_str(text).map_err(|e| e.to_string())
}

fn quote(s: &str) -> String {
    Js::from(s).to_string()
}

fn stringify(v: &Js) -> String {
    v.to_string()
}

fn field<'a>(v: &'a Js, key: &str) -> Option<&'a Js> {
    v.as_object().and_then(|o| o.get(key))
}

/// Truthiness as the app's saves mean it: null, false, 0, NaN and "" are false.
fn truthy(v: &Js) -> bool {
    match v {
        Js::Null => false,
        Js::Bool(b) => *b,
        Js::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        Js::String(s) => !s.is_empty(),
        Js::Array(_) | Js::Object(_) => true,
    }
}

fn is_bare_key(k: &str) -> bool {
    let mut cs = k.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// A socket or field key: bare when it's an identifier, else quoted, since a key can be user text.
fn key_token(k: &str) -> String {
    if is_bare_key(k) {
        k.into()
    } else {
        quote(k)
    }
}

fn output_token(k: &str) -> String {
    if !k.is_empty() && !k.contains(['"', '\\', ' ']) {
        k.into()
    } else {
        quote(k)
    }
}

fn s(v: Option<&Js>) -> &str {
    v.and_then(Js::as_str).unwrap_or("")
}

struct Conn<'a> {
    source: &'a str,
    source_output: &'a str,
    target: &'a str,
    target_input: &'a str,
}

/// Sources before their consumers; among the ready, by name. A cycle's nodes follow, by name.
fn topo_order<'a>(
    ids: &[&'a str],
    conns: &[Conn<'a>],
    name_of: &dyn Fn(&str) -> String,
) -> Vec<&'a str> {
    let mut indeg: HashMap<&str, i64> = ids.iter().map(|id| (*id, 0)).collect();
    let mut adj: HashMap<&str, Vec<&'a str>> = HashMap::new();
    for c in conns {
        if !indeg.contains_key(c.source) || !indeg.contains_key(c.target) {
            continue;
        }
        *indeg.get_mut(c.target).unwrap() += 1;
        adj.entry(c.source).or_default().push(c.target);
    }
    let by_name = |a: &&str, b: &&str| str::cmp(&name_of(a), &name_of(b));
    let mut ready: Vec<&'a str> = ids.iter().copied().filter(|id| indeg[id] == 0).collect();
    let mut done: HashSet<&str> = HashSet::new();
    let mut order = Vec::new();
    while !ready.is_empty() {
        ready.sort_by(by_name);
        let id = ready.remove(0);
        order.push(id);
        done.insert(id);
        for t in adj.get(id).map_or(&[][..], Vec::as_slice) {
            let d = indeg.get_mut(t).unwrap();
            *d -= 1;
            if *d == 0 {
                ready.push(t);
            }
        }
    }
    let mut seen = HashSet::new();
    let mut leftover: Vec<&'a str> = ids
        .iter()
        .copied()
        .filter(|id| !done.contains(id) && seen.insert(*id))
        .collect();
    leftover.sort_by(by_name);
    order.extend(leftover);
    order
}

fn map_names(v: &Js, name_of: &dyn Fn(&str) -> String) -> Js {
    match v {
        Js::Array(a) => Js::Array(
            a.iter()
                .map(|m| {
                    m.as_str()
                        .map_or_else(|| m.clone(), |n| Js::String(name_of(n)))
                })
                .collect(),
        ),
        v => v.clone(),
    }
}

/// `init`'s fields in the saved order: the app's order, then the rest by name.
fn canonical<'a>(init: &'a Obj, order: &'a [String]) -> Vec<(&'a str, &'a Js)> {
    let mut out: Vec<(&str, &Js)> = order
        .iter()
        .filter_map(|k| init.get(k).map(|v| (k.as_str(), v)))
        .collect();
    let listed: HashSet<&str> = order.iter().map(String::as_str).collect();
    let mut rest: Vec<(&str, &Js)> = init
        .iter()
        .map(|(k, v)| (k.as_str(), v))
        .filter(|(k, _)| !listed.contains(k))
        .collect();
    rest.sort_by(|a, b| str::cmp(a.0, b.0));
    out.extend(rest);
    out
}

/// `{ ...v, nodeId: name }` for a side-table row.
fn renamed(v: &Js, name_of: &dyn Fn(&str) -> String) -> Js {
    let mut o = v.as_object().cloned().unwrap_or_default();
    o.insert("nodeId".into(), Js::String(name_of(s(field(v, "nodeId")))));
    Js::Object(o)
}

/// The graph's text: `g` is the save as JSON, `names` each node's name in `g.nodes` order, `order` the init fields in
/// their saved order.
pub fn write(g: &Js, names: &[String], order: &[String]) -> String {
    let nodes = field(g, "nodes")
        .and_then(Js::as_array)
        .map_or(&[][..], Vec::as_slice);
    let conns_in = field(g, "connections")
        .and_then(Js::as_array)
        .map_or(&[][..], Vec::as_slice);
    let id_to_name: HashMap<&str, &str> = nodes
        .iter()
        .zip(names)
        .map(|(n, name)| (s(field(n, "id")), name.as_str()))
        .collect();
    let name_of = |id: &str| {
        id_to_name
            .get(id)
            .map_or_else(|| id.to_string(), |n| n.to_string())
    };
    let conns: Vec<Conn> = conns_in
        .iter()
        .map(|c| Conn {
            source: s(field(c, "source")),
            source_output: s(field(c, "sourceOutput")),
            target: s(field(c, "target")),
            target_input: s(field(c, "targetInput")),
        })
        .collect();
    let ids: Vec<&str> = nodes.iter().map(|n| s(field(n, "id"))).collect();
    let by_id: HashMap<&str, &Js> = nodes.iter().map(|n| (s(field(n, "id")), n)).collect();
    let mut lines = Vec::new();
    for id in topo_order(&ids, &conns, &name_of) {
        let sn = by_id[id];
        let mut parts = vec![
            format!("{}:", name_of(id)),
            s(field(sn, "type")).to_string(),
        ];
        let mut init = field(sn, "init")
            .and_then(Js::as_object)
            .cloned()
            .unwrap_or_default();
        if let Some(host) = init.get("hostNodeId").and_then(Js::as_str) {
            let host = name_of(host);
            init.insert("hostNodeId".into(), Js::String(host));
        }
        if let Some(m) = init.get("members").filter(|m| m.as_array().is_some()) {
            let m = map_names(m, &name_of);
            init.insert("members".into(), m);
        }
        if let Some(steps) = init.get("steps").and_then(Js::as_array) {
            let steps = steps
                .iter()
                .map(|step| {
                    let mut o = step.as_object().cloned().unwrap_or_default();
                    if let Some(ids) = field(step, "nodeIds") {
                        o.insert("nodeIds".into(), map_names(ids, &name_of));
                    }
                    Js::Object(o)
                })
                .collect();
            init.insert("steps".into(), Js::Array(steps));
        }
        for (k, v) in canonical(&init, order) {
            parts.push(format!("{}={}", key_token(k), stringify(v)));
        }
        for (key, tag, empty) in [
            ("literals", "lit", EMPTY_LIT),
            ("stringLiterals", "str", EMPTY_STR),
        ] {
            let Some(map) = field(sn, key).filter(|m| truthy(m)) else {
                continue;
            };
            let map = map.as_object().cloned().unwrap_or_default();
            if map.is_empty() {
                parts.push(empty.into());
            }
            let mut keys: Vec<&str> = map.keys().map(String::as_str).collect();
            keys.sort_by(|a, b| str::cmp(a, b));
            for k in keys {
                parts.push(format!(
                    "{tag}:{}={}",
                    key_token(k),
                    stringify(map.get(k).unwrap())
                ));
            }
        }
        let mut incoming: Vec<&Conn> = conns.iter().filter(|c| c.target == id).collect();
        incoming.sort_by(|a, b| str::cmp(a.target_input, b.target_input));
        for c in incoming {
            parts.push(format!(
                "{}<-{}.{}",
                key_token(c.target_input),
                name_of(c.source),
                output_token(c.source_output)
            ));
        }
        lines.push(parts.join(" "));
    }

    let mut positions = Obj::new();
    for id in &ids {
        let sn = by_id[id];
        let mut p = Obj::new();
        for k in ["x", "y"] {
            if let Some(v) = field(sn, k) {
                p.insert(k.into(), v.clone());
            }
        }
        if let Some(size) = field(sn, "size").filter(|x| truthy(x)) {
            let mut wh = Obj::new();
            for k in ["w", "h"] {
                if let Some(v) = field(size, k) {
                    wh.insert(k.into(), v.clone());
                }
            }
            p.insert("size".into(), Js::Object(wh));
        }
        for k in ["collapsed", "flipped"] {
            if field(sn, k).is_some_and(truthy) {
                p.insert(k.into(), Js::Bool(true));
            }
        }
        if let Some(sections) = field(sn, "sections").filter(|x| truthy(x)) {
            p.insert(
                "sections".into(),
                Js::Object(sections.as_object().cloned().unwrap_or_default()),
            );
        }
        positions.insert(name_of(id), Js::Object(p));
    }

    let mut side = Obj::new();
    if let Some(v) = field(g, "v") {
        side.insert("v".into(), v.clone());
    }
    side.insert("positions".into(), Js::Object(positions));
    let listed = |k: &str| field(g, k).and_then(Js::as_array).filter(|a| !a.is_empty());
    if let Some(standoffs) = listed("standoffs") {
        let end = |e: Option<&Js>| {
            let mut o = Obj::new();
            o.insert(
                "nodeId".into(),
                Js::String(name_of(s(e.and_then(|e| field(e, "nodeId"))))),
            );
            if let Some(a) = e.and_then(|e| field(e, "anchor")) {
                o.insert("anchor".into(), a.clone());
            }
            Js::Object(o)
        };
        let rows = standoffs
            .iter()
            .map(|st| {
                let mut o = Obj::new();
                o.insert("a".into(), end(field(st, "a")));
                o.insert("b".into(), end(field(st, "b")));
                for k in ["min", "max"] {
                    if let Some(v) = field(st, k) {
                        o.insert(k.into(), v.clone());
                    }
                }
                if field(st, "locked").is_some_and(truthy) {
                    o.insert("locked".into(), Js::Bool(true));
                }
                Js::Object(o)
            })
            .collect();
        side.insert("standoffs".into(), Js::Array(rows));
    }
    if let Some(cables) = listed("drawnCables") {
        side.insert("drawnCables".into(), Js::Array(cables.to_vec()));
    }
    if let Some(pins) = listed("pins") {
        let rows = pins
            .iter()
            .map(|p| {
                let mut o = Obj::new();
                o.insert("nodeId".into(), Js::String(name_of(s(field(p, "nodeId")))));
                if let Some(k) = field(p, "outputKey") {
                    o.insert("outputKey".into(), k.clone());
                }
                Js::Object(o)
            })
            .collect();
        side.insert("pins".into(), Js::Array(rows));
    }
    for k in ["comments", "frameFormats"] {
        if let Some(rows) = listed(k) {
            side.insert(
                k.into(),
                Js::Array(rows.iter().map(|r| renamed(r, &name_of)).collect()),
            );
        }
    }
    for k in ["palette", "reportPalette", "meta", "savedAt"] {
        if let Some(v) = field(g, k) {
            side.insert(k.into(), v.clone());
        }
    }
    if let Some(packs) = listed("packs") {
        side.insert("packs".into(), Js::Array(packs.to_vec()));
    }

    let header = if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    };
    format!(
        "{header}{SEPARATOR}\n{}\n",
        serde_json::to_string_pretty(&Js::Object(side)).unwrap_or_default()
    )
}

enum Target {
    Init,
    Lit,
    Str,
}

/// The end of a JSON string starting at `start`, just past its closing quote.
fn string_end(t: &[u8], start: usize) -> Option<usize> {
    let mut i = start + 1;
    while i < t.len() {
        match t[i] {
            b'\\' => i += 2,
            b'"' => return Some(i + 1),
            _ => i += 1,
        }
    }
    None
}

fn tokens(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let (mut out, mut i) = (Vec::new(), 0);
    while i < b.len() {
        while i < b.len() && b[i] == b' ' {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        let start = i;
        let mut in_str = false;
        while i < b.len() {
            match (in_str, b[i]) {
                (true, b'\\') => i += 2,
                (true, b'"') | (false, b'"') => {
                    in_str = !in_str;
                    i += 1;
                }
                (false, b' ') => break,
                _ => i += 1,
            }
        }
        out.push(&s[start..i.min(b.len())]);
    }
    out
}

fn malformed(token: &str) -> String {
    format!("textForm: malformed field \"{token}\"")
}

/// A field token: which map it fills, its key, `=` or `<-`, and what follows.
fn split_field(token: &str) -> Result<(Target, String, bool, &str), String> {
    let b = token.as_bytes();
    let prefix = ["lit:\"", "str:\""]
        .iter()
        .position(|p| token.starts_with(p));
    let at = if prefix.is_some() { 4 } else { 0 };
    if b.get(at) == Some(&b'"') {
        let end = string_end(b, at).ok_or_else(|| malformed(token))?;
        let arrow = token[end..].starts_with("<-");
        if !arrow && b.get(end) != Some(&b'=') || prefix.is_some() && arrow {
            return Err(malformed(token));
        }
        let key = match parse(&token[at..end]) {
            Ok(Js::String(k)) => k,
            _ => return Err(malformed(token)),
        };
        let map = match prefix {
            Some(0) => Target::Lit,
            Some(_) => Target::Str,
            None => Target::Init,
        };
        return Ok((map, key, arrow, &token[end + if arrow { 2 } else { 1 }..]));
    }
    let key_len = match b.first() {
        Some(c) if c.is_ascii_alphabetic() || *c == b'_' => {
            1 + b[1..]
                .iter()
                .take_while(|c| c.is_ascii_alphanumeric() || **c == b'_' || **c == b':')
                .count()
        }
        _ => return Err(malformed(token)),
    };
    let raw = &token[..key_len];
    let rest = &token[key_len..];
    let arrow = rest.starts_with("<-");
    if !arrow && !rest.starts_with('=') {
        return Err(malformed(token));
    }
    let map = if arrow {
        Target::Init
    } else if raw.starts_with("lit:") {
        Target::Lit
    } else if raw.starts_with("str:") {
        Target::Str
    } else {
        Target::Init
    };
    let key = if matches!(map, Target::Init) {
        raw
    } else {
        &raw[4..]
    };
    Ok((
        map,
        key.to_string(),
        arrow,
        &rest[if arrow { 2 } else { 1 }..],
    ))
}

fn value(text: &str, token: &str) -> Result<Js, String> {
    parse(text).map_err(|e| format!("textForm: malformed value in \"{token}\": {e}"))
}

pub struct Line {
    pub name: String,
    pub ty: String,
    pub init: Obj,
    pub literals: Option<Obj>,
    pub string_literals: Option<Obj>,
    /// Each wired input: its key, the source's name and the source's output.
    pub conns: Vec<(String, String, String)>,
}

/// One node line: `Name: Type` and its fields.
pub fn parse_line(line: &str) -> Result<Line, String> {
    let colon = line
        .find(": ")
        .ok_or_else(|| format!("textForm: malformed node line \"{line}\""))?;
    let rest = &line[colon + 2..];
    let (ty, fields) = rest.split_once(' ').unwrap_or((rest, ""));
    let mut l = Line {
        name: line[..colon].to_string(),
        ty: ty.to_string(),
        init: Obj::new(),
        literals: None,
        string_literals: None,
        conns: Vec::new(),
    };
    for token in tokens(fields) {
        if token == EMPTY_LIT {
            l.literals.get_or_insert_with(Obj::new);
            continue;
        }
        if token == EMPTY_STR {
            l.string_literals.get_or_insert_with(Obj::new);
            continue;
        }
        let (map, key, arrow, rest) = split_field(token)?;
        if arrow {
            let (source, out) = rest
                .split_once('.')
                .ok_or_else(|| format!("textForm: malformed connection \"{token}\""))?;
            let out = if out.starts_with('"') {
                match value(out, token)? {
                    Js::String(o) => o,
                    other => stringify(&other),
                }
            } else {
                out.to_string()
            };
            l.conns.push((key, source.to_string(), out));
            continue;
        }
        let v = value(rest, token)?;
        match map {
            Target::Lit => l
                .literals
                .get_or_insert_with(Obj::new)
                .insert(key.to_string(), v),
            Target::Str => l
                .string_literals
                .get_or_insert_with(Obj::new)
                .insert(key.to_string(), v),
            Target::Init => l.init.insert(key.to_string(), v),
        };
    }
    Ok(l)
}

/// `pos.k ?? 0`.
fn or_zero(pos: Option<&Js>, k: &str) -> Js {
    match pos.and_then(|p| field(p, k)) {
        None | Some(Js::Null) => json!(0),
        Some(v) => v.clone(),
    }
}

/// The graph a text holds, as the save's JSON; a sidecar without `v` reads as `version`.
pub fn read(text: &str, version: u32) -> Result<Js, String> {
    let all: Vec<&str> = text.split('\n').collect();
    let sep = all
        .iter()
        .position(|l| *l == SEPARATOR)
        .ok_or("textForm: missing \"---\" separator line")?;
    let side_text = all[sep + 1..].join("\n");
    let side = if side_text.trim().is_empty() {
        Js::Object(Obj::new())
    } else {
        parse(&side_text).map_err(|e| format!("textForm: the sidecar isn't JSON: {e}"))?
    };
    if side == Js::Null {
        return Err("textForm: the sidecar is null".into());
    }
    let mut lines = all[..sep]
        .iter()
        .filter(|l| !l.is_empty())
        .map(|l| parse_line(l))
        .collect::<Result<Vec<_>, _>>()?;
    let mut names = HashSet::new();
    for l in &lines {
        if !names.insert(l.name.as_str()) {
            return Err(format!("textForm: duplicate node name \"{}\"", l.name));
        }
    }
    let positions = field(&side, "positions").filter(|p| p.is_object());
    let mut nodes: Vec<(String, Js)> = lines
        .iter_mut()
        .map(|l| {
            let pos = positions.and_then(|p| field(p, &l.name));
            let mut sn = Obj::new();
            sn.insert("id".into(), Js::String(l.name.clone()));
            sn.insert("type".into(), Js::String(l.ty.clone()));
            sn.insert("name".into(), Js::String(l.name.clone()));
            sn.insert("x".into(), or_zero(pos, "x"));
            sn.insert("y".into(), or_zero(pos, "y"));
            sn.insert("init".into(), Js::Object(std::mem::take(&mut l.init)));
            if let Some(m) = l.literals.take() {
                sn.insert("literals".into(), Js::Object(m));
            }
            if let Some(m) = l.string_literals.take() {
                sn.insert("stringLiterals".into(), Js::Object(m));
            }
            if let Some(size) = pos.and_then(|p| field(p, "size")).filter(|x| truthy(x)) {
                sn.insert("size".into(), size.clone());
            }
            for k in ["collapsed", "flipped"] {
                if pos.and_then(|p| field(p, k)).is_some_and(truthy) {
                    sn.insert(k.into(), Js::Bool(true));
                }
            }
            if let Some(sec) = pos
                .and_then(|p| field(p, "sections"))
                .filter(|x| truthy(x) && x.is_object())
            {
                sn.insert(
                    "sections".into(),
                    Js::Object(sec.as_object().cloned().unwrap_or_default()),
                );
            }
            (l.name.clone(), Js::Object(sn))
        })
        .collect();
    // The positions table runs in stacking order; one that misses a node leaves the line order.
    if let Some(p) = positions.and_then(Js::as_object) {
        let rank: HashMap<&str, usize> =
            p.keys().enumerate().map(|(i, k)| (k.as_str(), i)).collect();
        if nodes.iter().all(|(n, _)| rank.contains_key(n.as_str())) {
            nodes.sort_by_key(|(n, _)| rank[n.as_str()]);
        }
    }
    let connections = lines
        .iter()
        .flat_map(|l| {
            l.conns.iter().map(|(input, source, output)| {
                let mut c = Obj::new();
                c.insert("source".into(), Js::String(source.clone()));
                c.insert("sourceOutput".into(), Js::String(output.clone()));
                c.insert("target".into(), Js::String(l.name.clone()));
                c.insert("targetInput".into(), Js::String(input.clone()));
                Js::Object(c)
            })
        })
        .collect();
    let mut g = Obj::new();
    g.insert(
        "v".into(),
        match field(&side, "v") {
            Some(v @ Js::Number(_)) => v.clone(),
            _ => json!(version),
        },
    );
    g.insert(
        "nodes".into(),
        Js::Array(nodes.into_iter().map(|(_, n)| n).collect()),
    );
    g.insert("connections".into(), Js::Array(connections));
    for k in [
        "standoffs",
        "drawnCables",
        "pins",
        "comments",
        "frameFormats",
    ] {
        if let Some(rows) = field(&side, k).filter(|r| r.as_array().is_some_and(|a| !a.is_empty()))
        {
            g.insert(k.into(), rows.clone());
        }
    }
    for k in ["palette", "reportPalette", "meta"] {
        if let Some(v) = field(&side, k) {
            g.insert(k.into(), v.clone());
        }
    }
    if let Some(v @ Js::Number(_)) = field(&side, "savedAt") {
        g.insert("savedAt".into(), v.clone());
    }
    if let Some(rows) =
        field(&side, "packs").filter(|r| r.as_array().is_some_and(|a| !a.is_empty()))
    {
        g.insert("packs".into(), rows.clone());
    }
    Ok(Js::Object(g))
}

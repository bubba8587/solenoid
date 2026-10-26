// [[B12]] losslessSaves, [[B16]] oneFormulaSurface, [[D102]] graphOnCore
//! The text form a save passes through (`tree/specs/documents/save-format.md` § The text form): a line per node in
//! dependency order (`Name: Type field=value lit:key=n str:key="t" input<-Source.output`), then `---` and a JSON
//! sidecar of positions and side tables. The app names the nodes and owns the init field order (`textForm.ts`);
//! everything else is here.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use solenoid_core::jsnum::{compare_utf16, js_trim};

use crate::js_json::{parse, quote, stringify, stringify_pretty, Js, Obj};

const SEPARATOR: &str = "---";
const EMPTY_LIT: &str = "lit:{}";
const EMPTY_STR: &str = "str:{}";

fn by_utf16(a: &str, b: &str) -> Ordering {
    compare_utf16(a, b)
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
    v.and_then(Js::str).unwrap_or("")
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
    let by_name = |a: &&str, b: &&str| by_utf16(&name_of(a), &name_of(b));
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
        Js::Arr(a) => Js::Arr(
            a.iter()
                .map(|m| m.str().map_or_else(|| m.clone(), |n| Js::Str(name_of(n))))
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
    let mut rest: Vec<(&str, &Js)> = init.iter().filter(|(k, _)| !listed.contains(k)).collect();
    rest.sort_by(|a, b| by_utf16(a.0, b.0));
    out.extend(rest);
    out
}

/// `{ ...v, nodeId: name }` for a side-table row.
fn renamed(v: &Js, name_of: &dyn Fn(&str) -> String) -> Js {
    let mut o = v.obj().cloned().unwrap_or_default();
    o.set("nodeId", Js::Str(name_of(s(v.field("nodeId")))));
    Js::Obj(o)
}

/// The graph's text: `g` is the save as JSON, `names` each node's name in `g.nodes` order, `order` the init fields in
/// their saved order.
pub fn write(g: &Js, names: &[String], order: &[String]) -> String {
    let nodes = g.field("nodes").and_then(Js::arr).unwrap_or(&[]);
    let conns_in = g.field("connections").and_then(Js::arr).unwrap_or(&[]);
    let id_to_name: HashMap<&str, &str> = nodes
        .iter()
        .zip(names)
        .map(|(n, name)| (s(n.field("id")), name.as_str()))
        .collect();
    let name_of = |id: &str| {
        id_to_name
            .get(id)
            .map_or_else(|| id.to_string(), |n| n.to_string())
    };
    let conns: Vec<Conn> = conns_in
        .iter()
        .map(|c| Conn {
            source: s(c.field("source")),
            source_output: s(c.field("sourceOutput")),
            target: s(c.field("target")),
            target_input: s(c.field("targetInput")),
        })
        .collect();
    let ids: Vec<&str> = nodes.iter().map(|n| s(n.field("id"))).collect();
    let by_id: HashMap<&str, &Js> = nodes.iter().map(|n| (s(n.field("id")), n)).collect();
    let mut lines = Vec::new();
    for id in topo_order(&ids, &conns, &name_of) {
        let sn = by_id[id];
        let mut parts = vec![format!("{}:", name_of(id)), s(sn.field("type")).to_string()];
        let mut init = sn
            .field("init")
            .and_then(Js::obj)
            .cloned()
            .unwrap_or_default();
        if let Some(host) = init.get("hostNodeId").and_then(Js::str) {
            let host = name_of(host);
            init.set("hostNodeId", Js::Str(host));
        }
        if let Some(m) = init.get("members").filter(|m| m.arr().is_some()) {
            let m = map_names(m, &name_of);
            init.set("members", m);
        }
        if let Some(steps) = init.get("steps").and_then(Js::arr) {
            let steps = steps
                .iter()
                .map(|step| {
                    let mut o = step.obj().cloned().unwrap_or_default();
                    if let Some(ids) = step.field("nodeIds") {
                        o.set("nodeIds", map_names(ids, &name_of));
                    }
                    Js::Obj(o)
                })
                .collect();
            init.set("steps", Js::Arr(steps));
        }
        for (k, v) in canonical(&init, order) {
            parts.push(format!("{}={}", key_token(k), stringify(v)));
        }
        for (field, tag, empty) in [
            ("literals", "lit", EMPTY_LIT),
            ("stringLiterals", "str", EMPTY_STR),
        ] {
            let Some(map) = sn.field(field).filter(|m| m.truthy()) else {
                continue;
            };
            let map = map.obj().cloned().unwrap_or_default();
            if map.is_empty() {
                parts.push(empty.into());
            }
            let mut keys: Vec<&str> = map.keys().collect();
            keys.sort_by(|a, b| by_utf16(a, b));
            for k in keys {
                parts.push(format!(
                    "{tag}:{}={}",
                    key_token(k),
                    stringify(map.get(k).unwrap())
                ));
            }
        }
        let mut incoming: Vec<&Conn> = conns.iter().filter(|c| c.target == id).collect();
        incoming.sort_by(|a, b| by_utf16(a.target_input, b.target_input));
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
            if let Some(v) = sn.field(k) {
                p.set(k, v.clone());
            }
        }
        if let Some(size) = sn.field("size").filter(|x| x.truthy()) {
            let mut wh = Obj::new();
            for k in ["w", "h"] {
                if let Some(v) = size.field(k) {
                    wh.set(k, v.clone());
                }
            }
            p.set("size", Js::Obj(wh));
        }
        for k in ["collapsed", "flipped"] {
            if sn.field(k).is_some_and(Js::truthy) {
                p.set(k, Js::Bool(true));
            }
        }
        if let Some(sections) = sn.field("sections").filter(|x| x.truthy()) {
            p.set(
                "sections",
                Js::Obj(sections.obj().cloned().unwrap_or_default()),
            );
        }
        positions.set(&name_of(id), Js::Obj(p));
    }

    let mut side = Obj::new();
    if let Some(v) = g.field("v") {
        side.set("v", v.clone());
    }
    side.set("positions", Js::Obj(positions));
    let listed = |k: &str| g.field(k).and_then(Js::arr).filter(|a| !a.is_empty());
    if let Some(standoffs) = listed("standoffs") {
        let end = |e: Option<&Js>| {
            let mut o = Obj::new();
            o.set(
                "nodeId",
                Js::Str(name_of(s(e.and_then(|e| e.field("nodeId"))))),
            );
            if let Some(a) = e.and_then(|e| e.field("anchor")) {
                o.set("anchor", a.clone());
            }
            Js::Obj(o)
        };
        let rows = standoffs
            .iter()
            .map(|st| {
                let mut o = Obj::new();
                o.set("a", end(st.field("a")));
                o.set("b", end(st.field("b")));
                for k in ["min", "max"] {
                    if let Some(v) = st.field(k) {
                        o.set(k, v.clone());
                    }
                }
                if st.field("locked").is_some_and(Js::truthy) {
                    o.set("locked", Js::Bool(true));
                }
                Js::Obj(o)
            })
            .collect();
        side.set("standoffs", Js::Arr(rows));
    }
    if let Some(cables) = listed("drawnCables") {
        side.set("drawnCables", Js::Arr(cables.to_vec()));
    }
    if let Some(pins) = listed("pins") {
        let rows = pins
            .iter()
            .map(|p| {
                let mut o = Obj::new();
                o.set("nodeId", Js::Str(name_of(s(p.field("nodeId")))));
                if let Some(k) = p.field("outputKey") {
                    o.set("outputKey", k.clone());
                }
                Js::Obj(o)
            })
            .collect();
        side.set("pins", Js::Arr(rows));
    }
    for k in ["comments", "frameFormats"] {
        if let Some(rows) = listed(k) {
            side.set(
                k,
                Js::Arr(rows.iter().map(|r| renamed(r, &name_of)).collect()),
            );
        }
    }
    for k in ["palette", "reportPalette", "meta", "savedAt"] {
        if let Some(v) = g.field(k) {
            side.set(k, v.clone());
        }
    }
    if let Some(packs) = listed("packs") {
        side.set("packs", Js::Arr(packs.to_vec()));
    }

    let header = if lines.is_empty() {
        String::new()
    } else {
        lines.join("\n") + "\n"
    };
    format!(
        "{header}{SEPARATOR}\n{}\n",
        stringify_pretty(&Js::Obj(side))
    )
}

enum Map {
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
fn split_field(token: &str) -> Result<(Map, String, bool, &str), String> {
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
            Ok(Js::Str(k)) => k,
            _ => return Err(malformed(token)),
        };
        let map = match prefix {
            Some(0) => Map::Lit,
            Some(_) => Map::Str,
            None => Map::Init,
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
        Map::Init
    } else if raw.starts_with("lit:") {
        Map::Lit
    } else if raw.starts_with("str:") {
        Map::Str
    } else {
        Map::Init
    };
    let key = if matches!(map, Map::Init) {
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
                    Js::Str(o) => o,
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
            Map::Lit => l.literals.get_or_insert_with(Obj::new).set(&key, v),
            Map::Str => l.string_literals.get_or_insert_with(Obj::new).set(&key, v),
            Map::Init => l.init.set(&key, v),
        }
    }
    Ok(l)
}

/// `pos.k ?? 0`.
fn or_zero(pos: Option<&Js>, k: &str) -> Js {
    match pos.and_then(|p| p.field(k)) {
        None | Some(Js::Null) => Js::Num(0.0),
        Some(v) => v.clone(),
    }
}

/// The graph a text holds, as the save's JSON; a sidecar without `v` reads as `version`.
pub fn read(text: &str, version: f64) -> Result<Js, String> {
    let all: Vec<&str> = text.split('\n').collect();
    let sep = all
        .iter()
        .position(|l| *l == SEPARATOR)
        .ok_or("textForm: missing \"---\" separator line")?;
    let side_text = all[sep + 1..].join("\n");
    let side = if js_trim(&side_text).is_empty() {
        Js::Obj(Obj::new())
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
    let positions = side
        .field("positions")
        .filter(|p| p.truthy() && p.is_object());
    let mut nodes: Vec<(String, Js)> = lines
        .iter_mut()
        .map(|l| {
            let pos = positions.and_then(|p| p.field(&l.name));
            let mut sn = Obj::new();
            sn.set("id", Js::Str(l.name.clone()));
            sn.set("type", Js::Str(l.ty.clone()));
            sn.set("name", Js::Str(l.name.clone()));
            sn.set("x", or_zero(pos, "x"));
            sn.set("y", or_zero(pos, "y"));
            sn.set("init", Js::Obj(std::mem::take(&mut l.init)));
            if let Some(m) = l.literals.take() {
                sn.set("literals", Js::Obj(m));
            }
            if let Some(m) = l.string_literals.take() {
                sn.set("stringLiterals", Js::Obj(m));
            }
            if let Some(size) = pos.and_then(|p| p.field("size")).filter(|x| x.truthy()) {
                sn.set("size", size.clone());
            }
            for k in ["collapsed", "flipped"] {
                if pos.and_then(|p| p.field(k)).is_some_and(Js::truthy) {
                    sn.set(k, Js::Bool(true));
                }
            }
            if let Some(sec) = pos
                .and_then(|p| p.field("sections"))
                .filter(|x| x.truthy() && x.is_object())
            {
                sn.set("sections", Js::Obj(sec.obj().cloned().unwrap_or_default()));
            }
            (l.name.clone(), Js::Obj(sn))
        })
        .collect();
    // The positions table runs in stacking order; one that misses a node leaves the line order.
    if let Some(p) = positions {
        let keys: Vec<String> = match p {
            Js::Obj(o) => o.keys().map(String::from).collect(),
            Js::Arr(a) => (0..a.len()).map(|i| i.to_string()).collect(),
            _ => Vec::new(),
        };
        let rank: HashMap<&str, usize> = keys
            .iter()
            .enumerate()
            .map(|(i, k)| (k.as_str(), i))
            .collect();
        if nodes.iter().all(|(n, _)| rank.contains_key(n.as_str())) {
            nodes.sort_by_key(|(n, _)| rank[n.as_str()]);
        }
    }
    let connections = lines
        .iter()
        .flat_map(|l| {
            l.conns.iter().map(|(input, source, output)| {
                let mut c = Obj::new();
                c.set("source", Js::Str(source.clone()));
                c.set("sourceOutput", Js::Str(output.clone()));
                c.set("target", Js::Str(l.name.clone()));
                c.set("targetInput", Js::Str(input.clone()));
                Js::Obj(c)
            })
        })
        .collect();
    let mut g = Obj::new();
    g.set(
        "v",
        match side.field("v") {
            Some(v @ Js::Num(_)) => v.clone(),
            _ => Js::Num(version),
        },
    );
    g.set(
        "nodes",
        Js::Arr(nodes.into_iter().map(|(_, n)| n).collect()),
    );
    g.set("connections", Js::Arr(connections));
    for k in [
        "standoffs",
        "drawnCables",
        "pins",
        "comments",
        "frameFormats",
    ] {
        if let Some(rows) = side
            .field(k)
            .filter(|r| r.arr().is_some_and(|a| !a.is_empty()))
        {
            g.set(k, rows.clone());
        }
    }
    for k in ["palette", "reportPalette", "meta"] {
        if let Some(v) = side.field(k) {
            g.set(k, v.clone());
        }
    }
    if let Some(v @ Js::Num(_)) = side.field("savedAt") {
        g.set("savedAt", v.clone());
    }
    if let Some(rows) = side
        .field("packs")
        .filter(|r| r.arr().is_some_and(|a| !a.is_empty()))
    {
        g.set("packs", rows.clone());
    }
    Ok(Js::Obj(g))
}

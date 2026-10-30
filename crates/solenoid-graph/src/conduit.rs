// [[C10]] socketLattice, [[C130]] rustCore
//! The walks through Conduits (`tree/specs/canvas/cable-rendering-knobs.md`): where an output's value really comes from,
//! and the whole run a cable belongs to, from the producer through every Conduit it crosses to each consumer. A
//! Conduit's lane `out_i` forwards `in_i`.

pub struct Cable {
    pub id: String,
    pub source: String,
    pub source_output: String,
    pub target: String,
    pub target_input: String,
}

/// The lane a Conduit key names: `in_3` or `out_3` is lane 3.
fn lane(key: &str, prefix: &str) -> Option<String> {
    let n = key.strip_prefix(prefix)?;
    n.parse::<u32>().ok().map(|i| i.to_string())
}

/// The output an output's value comes from: through every Conduit lane back to the producer, at most 16 deep (a
/// Conduit loop is a `#CIRC!` graph).
pub fn typed_source(
    is_conduit: &dyn Fn(&str) -> bool,
    cables: &[Cable],
    id: &str,
    key: &str,
) -> (String, String) {
    let (mut id, mut key) = (id.to_string(), key.to_string());
    for _ in 0..16 {
        if !is_conduit(&id) {
            break;
        }
        let Some(i) = lane(&key, "out_") else { break };
        let in_key = format!("in_{i}");
        let Some(feed) = cables
            .iter()
            .find(|c| c.target == id && c.target_input == in_key)
        else {
            break;
        };
        id = feed.source.clone();
        key = feed.source_output.clone();
    }
    (id, key)
}

pub struct Path {
    pub conn_ids: Vec<String>,
    pub origin: (String, String),
    pub terminals: Vec<(String, String)>,
    pub conduits: Vec<String>,
}

const MAX_HOPS: usize = 512;

/// The run `cable` belongs to: climbs to the cable leaving the producer, then fans out through every Conduit.
pub fn conduit_path(is_conduit: &dyn Fn(&str) -> bool, cables: &[Cable], cable: &Cable) -> Path {
    let mut climbed = vec![cable.id.as_str()];
    let mut head = cable;
    for _ in 0..MAX_HOPS {
        if !is_conduit(&head.source) {
            break;
        }
        let Some(i) = lane(&head.source_output, "out_") else {
            break;
        };
        let in_key = format!("in_{i}");
        let Some(feed) = cables
            .iter()
            .find(|c| c.target == head.source && c.target_input == in_key)
        else {
            break;
        };
        if climbed.contains(&feed.id.as_str()) {
            break;
        }
        climbed.push(&feed.id);
        head = feed;
    }
    let mut conn_ids = vec![head.id.clone()];
    let mut seen = vec![head.id.as_str()];
    let mut conduits: Vec<String> = Vec::new();
    let mut terminals = Vec::new();
    let mut queue = std::collections::VecDeque::from([head]);
    let mut hops = 0;
    while let Some(cur) = queue.pop_front() {
        if hops >= MAX_HOPS {
            break;
        }
        hops += 1;
        let lane_in = if is_conduit(&cur.target) {
            lane(&cur.target_input, "in_")
        } else {
            None
        };
        let Some(i) = lane_in else {
            terminals.push((cur.target.clone(), cur.target_input.clone()));
            continue;
        };
        let out_key = format!("out_{i}");
        let outs: Vec<&Cable> = cables
            .iter()
            .filter(|c| {
                c.source == cur.target
                    && c.source_output == out_key
                    && !seen.contains(&c.id.as_str())
            })
            .collect();
        if outs.is_empty() {
            terminals.push((cur.target.clone(), cur.target_input.clone()));
            continue;
        }
        if !conduits.contains(&cur.target) {
            conduits.push(cur.target.clone());
        }
        for o in outs {
            seen.push(&o.id);
            conn_ids.push(o.id.clone());
            queue.push_back(o);
        }
    }
    Path {
        conn_ids,
        origin: (head.source.clone(), head.source_output.clone()),
        terminals,
        conduits,
    }
}

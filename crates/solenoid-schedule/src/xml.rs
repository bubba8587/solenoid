// [[C69]] ganttPackages
//! The small XML reader the plan files need: elements, attributes, text, CDATA, comments and entities, with no
//! dependencies. A close tag that does not match its element is an error.

use crate::num::{is_js_space, js_trim};
use crate::ScheduleError;

#[derive(Clone, Debug, Default)]
pub struct XmlNode {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<XmlNode>,
    pub text: String,
}

impl XmlNode {
    pub fn child(&self, name: &str) -> Option<&XmlNode> {
        self.children.iter().find(|c| c.name == name)
    }

    pub fn children<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a XmlNode> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// The trimmed text of the first child called `name`.
    pub fn text_of(&self, name: &str) -> Option<&str> {
        self.child(name).map(|c| js_trim(&c.text))
    }

    /// The last value given for the attribute `name`.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

fn entity(e: &str) -> Option<char> {
    if let Some(num) = e.strip_prefix('#') {
        let (digits, radix) = match num.strip_prefix(['x', 'X']) {
            Some(hex) => (hex, 16),
            None => (num, 10),
        };
        if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
            return None;
        }
        return u32::from_str_radix(digits, radix).ok().and_then(char::from_u32);
    }
    Some(match e.to_ascii_lowercase().as_str() {
        "lt" => '<',
        "gt" => '>',
        "amp" => '&',
        "quot" => '"',
        "apos" => '\'',
        _ => return None,
    })
}

/// Decodes the five named entities and character references; anything else stays as written.
pub fn decode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let decoded = rest[1..].find(';').and_then(|semi| entity(&rest[1..=semi]).map(|c| (c, semi + 2)));
        match decoded {
            Some((c, len)) => {
                out.push(c);
                rest = &rest[len..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The end of a tag that starts at `from`: the first `>` outside a quoted attribute value.
fn tag_end(src: &str, from: usize) -> Option<usize> {
    let mut quote = None;
    for (i, c) in src[from..].char_indices() {
        match (quote, c) {
            (None, '"' | '\'') => quote = Some(c),
            (Some(q), _) if c == q => quote = None,
            (None, '>') => return Some(from + i),
            _ => {}
        }
    }
    None
}

fn attributes(mut rest: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    loop {
        rest = rest.trim_start_matches(is_js_space);
        if rest.is_empty() {
            return out;
        }
        let name_end = rest.find(|c: char| c == '=' || is_js_space(c)).unwrap_or(rest.len());
        let name = &rest[..name_end];
        rest = rest[name_end..].trim_start_matches(is_js_space);
        let Some(after) = rest.strip_prefix('=') else { continue };
        rest = after.trim_start_matches(is_js_space);
        match rest.chars().next() {
            Some(q @ ('"' | '\'')) => {
                let close = rest[1..].find(q).map_or(rest.len(), |k| k + 1);
                if !name.is_empty() {
                    out.push((name.to_string(), decode(&rest[1..close])));
                }
                rest = rest.get(close + 1..).unwrap_or("");
            }
            _ => rest = &rest[rest.find(is_js_space).unwrap_or(rest.len())..],
        }
    }
}

/// The document's root element; an empty unnamed node when there is none.
pub fn parse(src: &str) -> Result<XmlNode, ScheduleError> {
    let mut stack = vec![XmlNode::default()];
    let mut i = 0;
    let n = src.len();
    while i < n {
        let Some(lt) = src[i..].find('<').map(|k| k + i) else {
            stack.last_mut().unwrap().text.push_str(&decode(&src[i..]));
            break;
        };
        if lt > i {
            stack.last_mut().unwrap().text.push_str(&decode(&src[i..lt]));
        }
        let at = &src[lt..];
        if at.starts_with("<!--") {
            i = src[lt + 4..].find("-->").map_or(n, |e| lt + 4 + e + 3);
            continue;
        }
        if let Some(body) = at.strip_prefix("<![CDATA[") {
            let e = body.find("]]>");
            stack.last_mut().unwrap().text.push_str(&body[..e.unwrap_or(body.len())]);
            i = e.map_or(n, |e| lt + 9 + e + 3);
            continue;
        }
        if at.starts_with("<?") || at.starts_with("<!") {
            i = src[lt..].find('>').map_or(n, |e| lt + e + 1);
            continue;
        }
        let Some(gt) = tag_end(src, lt + 1) else { break };
        let raw = js_trim(&src[lt + 1..gt]);
        i = gt + 1;
        if let Some(close) = raw.strip_prefix('/') {
            let name = js_trim(close);
            if stack.len() < 2 || stack.last().unwrap().name != name {
                return Err(ScheduleError::new(format!("XML: unexpected </{name}>")));
            }
            let done = stack.pop().unwrap();
            stack.last_mut().unwrap().children.push(done);
            continue;
        }
        let self_closing = raw.ends_with('/');
        let body = if self_closing { &raw[..raw.len() - 1] } else { raw };
        let name_end = body.find(is_js_space).unwrap_or(body.len());
        let node =
            XmlNode { name: body[..name_end].to_string(), attrs: attributes(&body[name_end..]), ..XmlNode::default() };
        if self_closing {
            stack.last_mut().unwrap().children.push(node);
        } else {
            stack.push(node);
        }
    }
    while stack.len() > 1 {
        let open = stack.pop().unwrap();
        stack.last_mut().unwrap().children.push(open);
    }
    let mut root = stack.pop().unwrap();
    Ok(if root.children.is_empty() { root } else { root.children.swap_remove(0) })
}

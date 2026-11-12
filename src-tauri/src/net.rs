// [[B18]] safeToShare, [[C103]] untrustedContentSeams
//! The desktop's network fetch. A document someone else wrote never reaches this computer or the local network: the
//! host is checked on the request and on every redirect, and a name is checked by the address it resolves to, at the
//! moment the connection is made, so no spelling of a private address and no name pointing inward gets through.
use std::error::Error as StdError;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use url::{Host, Url};

pub const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;
/// The webview reads a refusal by this word (`httpBridge.ts`).
pub const REFUSED: &str = "local-network-refused";

#[derive(Debug, Deserialize)]
pub struct NetRequest {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<String>,
    /// The user's own document may reach this computer and the local network (TaskNotes on localhost).
    #[serde(default)]
    pub local: bool,
    /// Answer the body as base64 (`body_base64`) rather than text, for a file that isn't text (a workbook).
    #[serde(default)]
    pub binary: bool,
}

#[derive(Debug, Serialize)]
pub struct NetReply {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    /// The body's bytes as base64, when the request asked for `binary`; `body` is empty then.
    pub body_base64: Option<String>,
}

#[derive(Debug)]
struct Refused(String);

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{REFUSED}: {}", self.0)
    }
}

impl StdError for Refused {}

/// Whether an address is on the public internet. An address that carries an IPv4 one inside it (mapped, compatible,
/// NAT64, 6to4) is judged by the IPv4 address.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => public_v6(v6),
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0
        || (o[0] == 100 && (o[1] & 0xc0) == 64)
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 198 && (o[1] & 0xfe) == 18)
        || o[0] >= 240)
}

fn embedded_v4(hi: u16, lo: u16) -> Ipv4Addr {
    Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
        return false;
    }
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let s = ip.segments();
    if s[..6] == [0; 6] || (s[0] == 0x64 && s[1] == 0xff9b && s[2..6] == [0; 4]) {
        return public_v4(embedded_v4(s[6], s[7]));
    }
    if s[0] == 0x2002 {
        return public_v4(embedded_v4(s[1], s[2]));
    }
    let unique_local = (s[0] & 0xfe00) == 0xfc00;
    let link_local = (s[0] & 0xffc0) == 0xfe80;
    let site_local = (s[0] & 0xffc0) == 0xfec0;
    let documentation = s[0] == 0x2001 && s[1] == 0x0db8;
    !(unique_local || link_local || site_local || documentation)
}

/// The request's own check: the scheme, and a host written as an address or as a `localhost` name. A name is
/// checked again by what it resolves to (`PublicOnly`).
fn check_url(url: &Url, local: bool) -> Result<(), Refused> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(Refused(format!("{} is not a web address", url.scheme())));
    }
    if local {
        return Ok(());
    }
    let inward = match url.host() {
        None => true,
        Some(Host::Ipv4(ip)) => !public_v4(ip),
        Some(Host::Ipv6(ip)) => !public_v6(ip),
        Some(Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            d == "localhost" || d.ends_with(".localhost")
        }
    };
    if inward {
        return Err(Refused(url.host_str().unwrap_or("").to_string()));
    }
    Ok(())
}

/// Resolves a name and refuses it when any address it answers is not public, so a name that points inward (or a
/// rebinding answer mixing the two) never connects.
struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let host = name.as_str().to_string();
            let addrs: Vec<SocketAddr> =
                tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            if addrs.iter().any(|a| !is_public(a.ip())) {
                return Err(Box::new(Refused(host)) as Box<dyn StdError + Send + Sync>);
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn refusal_in(e: &(dyn StdError + 'static)) -> Option<String> {
    let mut cur: Option<&(dyn StdError + 'static)> = Some(e);
    while let Some(err) = cur {
        if let Some(r) = err.downcast_ref::<Refused>() {
            return Some(r.to_string());
        }
        cur = err.source();
    }
    None
}

fn client(local: bool) -> reqwest::Result<reqwest::Client> {
    let policy = Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("too many redirects")
        } else if let Err(r) = check_url(attempt.url(), local) {
            attempt.error(r)
        } else {
            attempt.follow()
        }
    });
    let mut builder = reqwest::Client::builder()
        .redirect(policy)
        .connect_timeout(Duration::from_secs(30));
    if !local {
        // A proxy resolves the name itself, out of the resolver's reach.
        builder = builder.no_proxy().dns_resolver(Arc::new(PublicOnly));
    }
    builder.build()
}

pub async fn fetch(req: NetRequest) -> Result<NetReply, String> {
    let url = Url::parse(&req.url).map_err(|e| format!("Not a web address: {e}"))?;
    check_url(&url, req.local).map_err(|r| r.to_string())?;
    let method = reqwest::Method::from_bytes(req.method.as_deref().unwrap_or("GET").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut request = client(req.local)
        .map_err(|e| e.to_string())?
        .request(method, url);
    for (k, v) in &req.headers {
        request = request.header(k, v);
    }
    if let Some(body) = req.body {
        request = request.body(body);
    }
    let read = |e: reqwest::Error| refusal_in(&e).unwrap_or_else(|| e.to_string());
    let mut res = request.send().await.map_err(read)?;
    if res
        .content_length()
        .is_some_and(|n| n > MAX_BODY_BYTES as u64)
    {
        return Err(too_large(res.content_length().unwrap_or(0) as usize));
    }
    let status = res.status();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(read)? {
        if bytes.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(too_large(bytes.len() + chunk.len()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(NetReply {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body: if req.binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        },
        body_base64: req
            .binary
            .then(|| base64::engine::general_purpose::STANDARD.encode(&bytes)),
    })
}

fn too_large(bytes: usize) -> String {
    format!(
        "Response is too large ({} MB, over the {} MB limit). Refusing to load it into memory.",
        (bytes as f64 / 1e6).round(),
        MAX_BODY_BYTES / 1_000_000
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn refused(url: &str) -> bool {
        check_url(&Url::parse(url).unwrap(), false).is_err()
    }

    #[test]
    fn every_spelling_of_an_inward_address_is_refused() {
        for u in [
            "http://localhost:8080/",
            "http://localhost./",
            "http://LOCALHOST/",
            "http://app.localhost/",
            "http://127.0.0.1/",
            "http://127.1/",
            "http://2130706433/",
            "http://0x7f000001/",
            "http://0.0.0.0/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://192.168.1.1/",
            "http://169.254.169.254/",
            "http://100.64.0.1/",
            "http://[::1]/",
            "http://[::]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:192.168.0.1]/",
            "http://[::127.0.0.1]/",
            "http://[64:ff9b::7f00:1]/",
            "http://[2002:c0a8:0101::]/",
            "http://[fd00::1]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
        ] {
            assert!(refused(u), "{u} got through");
        }
    }

    #[test]
    fn public_addresses_and_names_pass() {
        for u in [
            "https://example.com/",
            "http://8.8.8.8/",
            "http://[2606:4700:4700::1111]/",
            "http://100.128.0.1/",
            "http://[::ffff:8.8.8.8]/",
        ] {
            assert!(!refused(u), "{u} was refused");
        }
    }

    #[test]
    fn the_users_own_document_reaches_the_local_network() {
        assert!(check_url(&Url::parse("http://localhost:8080/").unwrap(), true).is_ok());
        assert!(check_url(&Url::parse("file:///etc/passwd").unwrap(), true).is_err());
    }

    #[tokio::test]
    async fn a_name_resolving_inward_is_refused() {
        let err = PublicOnly
            .resolve(Name::from_str("localhost").unwrap())
            .await
            .err()
            .expect("localhost resolved");
        assert!(refusal_in(err.as_ref()).is_some());
    }

    #[tokio::test]
    async fn a_redirect_or_name_inward_never_connects() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    use tokio::io::{AsyncReadExt, AsyncWriteExt};
                    let mut buf = [0u8; 1024];
                    let _ = sock.read(&mut buf).await;
                    let _ = sock
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                        )
                        .await;
                });
            }
        });
        let get = |url: String, local: bool| {
            fetch(NetRequest {
                url,
                method: None,
                headers: vec![],
                body: None,
                local,
                binary: false,
            })
        };
        let own = get(format!("http://127.0.0.1:{port}/"), true)
            .await
            .unwrap();
        assert_eq!((own.status, own.body.as_str()), (200, "ok"));
        let foreign = get(format!("http://127.0.0.1:{port}/"), false)
            .await
            .unwrap_err();
        assert!(foreign.starts_with(REFUSED), "{foreign}");
        let by_name = get(format!("http://localhost.:{port}/"), false)
            .await
            .unwrap_err();
        assert!(by_name.starts_with(REFUSED), "{by_name}");
    }
}

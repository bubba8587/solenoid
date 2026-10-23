// [[C130]] rustCore, [[D99]] rustIsSpec, [[C17]] shareImpl
//! Port of `src/graph/nodes/hashOps.ts`: the digests HASH offers and base64. UTF-8 in, lowercase hex out; text a
//! JS string holds reaches here well formed, and a lone surrogate encodes as U+FFFD either way (`TextEncoder`).

use base64::engine::general_purpose::{GeneralPurpose, NO_PAD, STANDARD};
use base64::Engine;
use sha2::Digest;

/// `HASH_ALGORITHM_META`'s keys, in its order.
pub const HASH_ALGORITHMS: &[&str] = &["sha256", "sha1", "md5", "crc32", "fnv1a32", "fnv1a64"];

fn hex32(n: u32) -> String {
    format!("{n:08x}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn md5_hex(text: &str) -> String {
    hex(&md5::Md5::digest(text.as_bytes()))
}

pub fn sha1_hex(text: &str) -> String {
    hex(&sha1::Sha1::digest(text.as_bytes()))
}

pub fn sha256_hex(text: &str) -> String {
    hex(&sha2::Sha256::digest(text.as_bytes()))
}

pub fn crc32_hex(text: &str) -> String {
    hex32(crc32fast::hash(text.as_bytes()))
}

pub fn fnv1a32_hex(text: &str) -> String {
    hex32(text.bytes().fold(0x811c9dc5u32, |h, b| (h ^ u32::from(b)).wrapping_mul(0x01000193)))
}

pub fn fnv1a64_hex(text: &str) -> String {
    format!("{:016x}", text.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100000001b3)))
}

/// `hashText`, for one of `HASH_ALGORITHMS`.
pub fn hash_text(text: &str, algorithm: &str) -> Option<String> {
    Some(match algorithm {
        "sha256" => sha256_hex(text),
        "sha1" => sha1_hex(text),
        "md5" => md5_hex(text),
        "crc32" => crc32_hex(text),
        "fnv1a32" => fnv1a32_hex(text),
        "fnv1a64" => fnv1a64_hex(text),
        _ => return None,
    })
}

pub fn base64_encode(text: &str) -> String {
    STANDARD.encode(text.as_bytes())
}

/// The padding is checked here, so the body decodes bare; stray low bits in its last symbol are dropped, as the TS does.
const BODY: GeneralPurpose =
    GeneralPurpose::new(&base64::alphabet::STANDARD, NO_PAD.with_decode_allow_trailing_bits(true));

/// `None` for text that is not valid base64, or bytes that aren't UTF-8 (`TextDecoder`'s `fatal`).
pub fn base64_decode(text: &str) -> Option<String> {
    let clean: String = text
        .chars()
        .filter(|&c| !crate::jsnum::is_js_space(c))
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .collect();
    // `^[A-Za-z0-9+/]*={0,2}$`
    let body_end = clean.trim_end_matches('=').len();
    let pads = clean.len() - body_end;
    if pads > 2
        || !clean[..body_end].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/')
        || clean.len() % 4 == 1
    {
        return None;
    }
    // A last symbol alone in its quantum carries no whole byte, and the TS drops it.
    let body = &clean[..body_end - usize::from(body_end % 4 == 1)];
    let bytes = BODY.decode(body).ok()?;
    // `TextDecoder` drops a leading byte-order mark.
    let start = if bytes.starts_with(&[0xef, 0xbb, 0xbf]) { 3 } else { 0 };
    String::from_utf8(bytes[start..].to_vec()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digests_match_known_vectors() {
        assert_eq!(md5_hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(sha1_hex("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(sha256_hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(crc32_hex("123456789"), "cbf43926");
        assert_eq!(fnv1a32_hex("a"), "e40c292c");
        assert_eq!(fnv1a64_hex("a"), "af63dc4c8601ec8c");
        assert_eq!(base64_decode(&base64_encode("héllo 😀")).as_deref(), Some("héllo 😀"));
    }
}

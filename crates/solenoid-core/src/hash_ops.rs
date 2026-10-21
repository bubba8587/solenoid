// [[C130]] rustCore, [[D99]] rustIsSpec, [[C17]] shareImpl
//! Port of `src/graph/nodes/hashOps.ts`: the digests HASH offers and base64. UTF-8 in, lowercase hex out; text a
//! JS string holds reaches here well formed, and a lone surrogate encodes as U+FFFD either way (`TextEncoder`).

/// `HASH_ALGORITHM_META`'s keys, in its order.
pub const HASH_ALGORITHMS: &[&str] = &["sha256", "sha1", "md5", "crc32", "fnv1a32", "fnv1a64"];

fn hex32(n: u32) -> String {
    format!("{n:08x}")
}

/// Pad to the Merkle–Damgård block layout: 0x80, zeros, 64-bit bit-length (BE for SHA, LE for MD5).
fn padded(bytes: &[u8], little_endian_length: bool) -> Vec<u8> {
    let total = (bytes.len() + 9).div_ceil(64) * 64;
    let mut buf = vec![0u8; total];
    buf[..bytes.len()].copy_from_slice(bytes);
    buf[bytes.len()] = 0x80;
    let bits = (bytes.len() as u64).wrapping_mul(8);
    let len = if little_endian_length { bits.to_le_bytes() } else { bits.to_be_bytes() };
    buf[total - 8..].copy_from_slice(&len);
    buf
}

const MD5_S: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/// `floor(abs(sin(i + 1)) * 2^32)`, as the TS computes it.
const MD5_K: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

pub fn md5_hex(text: &str) -> String {
    let buf = padded(text.as_bytes(), true);
    let (mut h0, mut h1, mut h2, mut h3) = (0x67452301u32, 0xefcdab89u32, 0x98badcfeu32, 0x10325476u32);
    let mut m = [0u32; 16];
    for block in buf.chunks(64) {
        for (i, w) in m.iter_mut().enumerate() {
            *w = u32::from_le_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]);
        }
        let (mut a, mut b, mut c, mut d) = (h0, h1, h2, h3);
        for i in 0..64 {
            let (f, g) = if i < 16 {
                ((b & c) | (!b & d), i)
            } else if i < 32 {
                ((d & b) | (!d & c), (5 * i + 1) % 16)
            } else if i < 48 {
                (b ^ c ^ d, (3 * i + 5) % 16)
            } else {
                (c ^ (b | !d), (7 * i) % 16)
            };
            let tmp = d;
            d = c;
            c = b;
            b = b.wrapping_add(a.wrapping_add(f).wrapping_add(MD5_K[i]).wrapping_add(m[g]).rotate_left(MD5_S[i]));
            a = tmp;
        }
        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
    }
    [h0, h1, h2, h3].iter().map(|h| hex32(h.swap_bytes())).collect()
}

pub fn sha1_hex(text: &str) -> String {
    let buf = padded(text.as_bytes(), false);
    let mut h = [0x67452301u32, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    let mut w = [0u32; 80];
    for block in buf.chunks(64) {
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = if i < 20 {
                ((b & c) | (!b & d), 0x5a827999)
            } else if i < 40 {
                (b ^ c ^ d, 0x6ed9eba1)
            } else if i < 60 {
                ((b & c) | (b & d) | (c & d), 0x8f1bbcdc)
            } else {
                (b ^ c ^ d, 0xca62c1d6)
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        for (x, y) in h.iter_mut().zip([a, b, c, d, e]) {
            *x = x.wrapping_add(y);
        }
    }
    h.iter().map(|x| hex32(*x)).collect()
}

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub fn sha256_hex(text: &str) -> String {
    let buf = padded(text.as_bytes(), false);
    let mut hh = [0x6a09e667u32, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut w = [0u32; 64];
    for block in buf.chunks(64) {
        for i in 0..16 {
            w[i] = u32::from_be_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = hh;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(SHA256_K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (x, y) in hh.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *x = x.wrapping_add(y);
        }
    }
    hh.iter().map(|x| hex32(*x)).collect()
}

pub fn crc32_hex(text: &str) -> String {
    let table: Vec<u32> = (0..256u32)
        .map(|n| (0..8).fold(n, |c, _| if c & 1 != 0 { 0xedb88320 ^ (c >> 1) } else { c >> 1 }))
        .collect();
    let c = text.bytes().fold(0xffffffffu32, |c, b| table[((c ^ u32::from(b)) & 0xff) as usize] ^ (c >> 8));
    hex32(c ^ 0xffffffff)
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

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for (i, chunk) in bytes.chunks(3).enumerate() {
        let at = |j: usize| u32::from(chunk.get(j).copied().unwrap_or(0));
        let n = (at(0) << 16) | (at(1) << 8) | at(2);
        let i = i * 3;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if i + 1 < bytes.len() { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if i + 2 < bytes.len() { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

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
    if pads > 2 || !clean[..body_end].bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/') || clean.len() % 4 == 1 {
        return None;
    }
    let mut bytes = Vec::with_capacity(body_end * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for ch in clean[..body_end].bytes() {
        let idx = B64.iter().position(|&b| b == ch).unwrap_or(0) as u32;
        acc = (acc << 6) | idx;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((acc >> bits) & 0xff) as u8);
        }
    }
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

//! [[D99]] rustIsSpec: the QR encoder the QR Code card draws with, a port of the `qrcode` package (1.5.4,
//! `lib/core/`): a text split into numeric, alphanumeric and byte segments by the shortest path through every mode
//! each run could take (`segments.js`, with `dijkstrajs`), the smallest version that holds them, the codewords with
//! their Reed-Solomon blocks, and the mask whose penalty is lowest. Kanji mode is off, as the package leaves it without
//! a Shift JIS converter. Held to the package's symbols by `tests/qr.rs` (`fixtures/core/qr-encoder.json.gz`).

/// An error correction level, by its format bits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    L,
    M,
    Q,
    H,
}

impl Level {
    fn bit(self) -> u32 {
        match self {
            Level::L => 1,
            Level::M => 0,
            Level::Q => 3,
            Level::H => 2,
        }
    }
    fn column(self) -> usize {
        match self {
            Level::L => 0,
            Level::M => 1,
            Level::Q => 2,
            Level::H => 3,
        }
    }
}

/// A symbol: its version, its mask, and its modules row by row, 1 dark.
#[derive(Debug, Clone)]
pub struct Symbol {
    pub version: usize,
    pub mask: u32,
    pub size: usize,
    pub modules: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Numeric,
    Alphanumeric,
    Byte,
}

impl Mode {
    fn bit(self) -> u32 {
        match self {
            Mode::Numeric => 1,
            Mode::Alphanumeric => 2,
            Mode::Byte => 4,
        }
    }
    /// `getCharCountIndicator`.
    fn count_bits(self, version: usize) -> usize {
        let at = if version < 10 { 0 } else if version < 27 { 1 } else { 2 };
        match self {
            Mode::Numeric => [10, 12, 14][at],
            Mode::Alphanumeric => [9, 11, 13][at],
            Mode::Byte => [8, 16, 16][at],
        }
    }
    /// `getSegmentBitsLength`.
    fn data_bits(self, length: usize) -> usize {
        match self {
            Mode::Numeric => 10 * (length / 3) + if !length.is_multiple_of(3) { (length % 3) * 3 + 1 } else { 0 },
            Mode::Alphanumeric => 11 * (length / 2) + 6 * (length % 2),
            Mode::Byte => length * 8,
        }
    }
}

const ALPHANUMERIC: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const CODEWORDS: [usize; 41] = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085, 1156, 1258, 1364,
    1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
];

const EC_BLOCKS: [usize; 160] = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 2, 2, 4, 1, 2, 4, 4, 2, 4, 4, 4, 2, 4, 6, 5, 2, 4, 6, 6, 2, 5, 8, 8, 4, 5, 8, 8, 4, 5,
    8, 11, 4, 8, 10, 11, 4, 9, 12, 16, 4, 9, 16, 16, 6, 10, 12, 18, 6, 10, 17, 16, 6, 11, 16, 19, 6, 13, 18, 21, 7, 14, 21,
    25, 8, 16, 20, 25, 8, 17, 23, 25, 9, 17, 23, 34, 9, 18, 25, 30, 10, 20, 27, 32, 12, 21, 29, 35, 12, 23, 34, 37, 12, 25,
    34, 40, 13, 26, 35, 42, 14, 28, 38, 45, 15, 29, 40, 48, 16, 31, 43, 51, 17, 33, 45, 54, 18, 35, 48, 57, 19, 37, 51, 60,
    19, 38, 53, 63, 20, 40, 56, 66, 21, 43, 59, 70, 22, 45, 62, 74, 24, 47, 65, 77, 25, 49, 68, 81,
];

const EC_CODEWORDS: [usize; 160] = [
    7, 10, 13, 17, 10, 16, 22, 28, 15, 26, 36, 44, 20, 36, 52, 64, 26, 48, 72, 88, 36, 64, 96, 112, 40, 72, 108, 130, 48,
    88, 132, 156, 60, 110, 160, 192, 72, 130, 192, 224, 80, 150, 224, 264, 96, 176, 260, 308, 104, 198, 288, 352, 120, 216,
    320, 384, 132, 240, 360, 432, 144, 280, 408, 480, 168, 308, 448, 532, 180, 338, 504, 588, 196, 364, 546, 650, 224, 416,
    600, 700, 224, 442, 644, 750, 252, 476, 690, 816, 270, 504, 750, 900, 300, 560, 810, 960, 312, 588, 870, 1050, 336, 644,
    952, 1110, 360, 700, 1020, 1200, 390, 728, 1050, 1260, 420, 784, 1140, 1350, 450, 812, 1200, 1440, 480, 868, 1290, 1530,
    510, 924, 1350, 1620, 540, 980, 1440, 1710, 570, 1036, 1530, 1800, 570, 1064, 1590, 1890, 600, 1120, 1680, 1980, 630,
    1204, 1770, 2100, 660, 1260, 1860, 2220, 720, 1316, 1950, 2310, 750, 1372, 2040, 2430,
];

fn ec_blocks(version: usize, level: Level) -> usize {
    EC_BLOCKS[(version - 1) * 4 + level.column()]
}

fn ec_codewords(version: usize, level: Level) -> usize {
    EC_CODEWORDS[(version - 1) * 4 + level.column()]
}

fn data_capacity_bits(version: usize, level: Level) -> usize {
    (CODEWORDS[version] - ec_codewords(version, level)) * 8
}

/// `Version.getCapacity`: how many characters of one mode the version holds.
fn capacity(version: usize, level: Level, mode: Mode) -> f64 {
    let usable = data_capacity_bits(version, level) as f64 - (mode.count_bits(version) + 4) as f64;
    match mode {
        Mode::Numeric => (usable / 10.0 * 3.0).floor(),
        Mode::Alphanumeric => (usable / 11.0 * 2.0).floor(),
        Mode::Byte => (usable / 8.0).floor(),
    }
}

/// A segment as the encoder writes it: its mode and its text.
#[derive(Clone, Debug)]
struct Segment {
    mode: Mode,
    data: String,
}

impl Segment {
    /// `getLength`: characters, or bytes in byte mode.
    fn length(&self) -> usize {
        match self.mode {
            Mode::Byte => self.data.len(),
            _ => self.data.chars().count(),
        }
    }
    fn bits(&self) -> usize {
        self.mode.data_bits(self.length())
    }
}

fn char_mode(c: char) -> Mode {
    if c.is_ascii_digit() {
        Mode::Numeric
    } else if c.is_ascii() && ALPHANUMERIC.contains(&(c as u8)) {
        Mode::Alphanumeric
    } else {
        Mode::Byte
    }
}

/// `getSegmentsFromString`: the runs of digits, of the other alphanumeric characters, and of the rest.
fn raw_segments(text: &str) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    for c in text.chars() {
        let mode = char_mode(c);
        match out.last_mut() {
            Some(s) if s.mode == mode => s.data.push(c),
            _ => out.push(Segment { mode, data: c.to_string() }),
        }
    }
    out
}

/// `getBestVersionForData`.
fn best_version(segments: &[Segment], level: Level) -> Option<usize> {
    match segments {
        [] => Some(1),
        [one] => (1..=40).find(|&v| one.length() as f64 <= capacity(v, level, one.mode)),
        many => (1..=40).find(|&v| many.iter().map(|s| s.mode.count_bits(v) + 4 + s.bits()).sum::<usize>() <= data_capacity_bits(v, level)),
    }
}

/// `Segments.fromString`: the cheapest sequence of modes, by `dijkstrajs` over the package's graph, its weights and
/// its ties included (a mode's run count carries across a group's other nodes, as `buildGraph` keeps it).
fn optimal_segments(text: &str, version: usize) -> Vec<Segment> {
    let raw = raw_segments(text);
    let groups: Vec<Vec<(Mode, usize)>> = raw
        .iter()
        .map(|s| {
            let n = s.data.len();
            match s.mode {
                Mode::Numeric => vec![(Mode::Numeric, n), (Mode::Alphanumeric, n), (Mode::Byte, n)],
                Mode::Alphanumeric => vec![(Mode::Alphanumeric, n), (Mode::Byte, n)],
                Mode::Byte => vec![(Mode::Byte, n)],
            }
        })
        .collect();
    // Node 0 is the start, then each group's nodes in order, then the end.
    let mut ids: Vec<(usize, usize)> = Vec::new();
    let mut edges: Vec<Vec<(usize, i64)>> = vec![Vec::new()];
    let mut last_count: Vec<usize> = vec![0];
    let mut prev: Vec<usize> = vec![0];
    for (i, group) in groups.iter().enumerate() {
        let mut current = Vec::new();
        for (j, &(mode, length)) in group.iter().enumerate() {
            let id = ids.len() + 1;
            ids.push((i, j));
            edges.push(Vec::new());
            last_count.push(0);
            current.push(id);
            for &p in &prev {
                let prev_mode = if p == 0 { None } else { Some(groups[ids[p - 1].0][ids[p - 1].1].0) };
                let weight = if prev_mode == Some(mode) {
                    let w = mode.data_bits(last_count[p] + length) as i64 - mode.data_bits(last_count[p]) as i64;
                    last_count[p] += length;
                    w
                } else {
                    if p != 0 {
                        last_count[p] = length;
                    }
                    (mode.data_bits(length) + 4 + mode.count_bits(version)) as i64
                };
                edges[p].push((id, weight));
            }
        }
        prev = current;
    }
    let end = ids.len() + 1;
    edges.push(Vec::new());
    for &p in &prev {
        edges[p].push((end, 0));
    }
    // `single_source_shortest_paths`: a queue kept sorted by cost, stably (a push goes after its equals), popped from
    // the front.
    let mut costs: Vec<Option<i64>> = vec![None; end + 1];
    let mut pred: Vec<Option<usize>> = vec![None; end + 1];
    costs[0] = Some(0);
    let mut open: std::collections::VecDeque<(usize, i64)> = [(0, 0)].into_iter().collect();
    while let Some((u, cost_u)) = open.pop_front() {
        for &(v, e) in &edges[u] {
            let through = cost_u + e;
            if costs[v].is_none_or(|c| c > through) {
                costs[v] = Some(through);
                let at = open.partition_point(|&(_, c)| c <= through);
                open.insert(at, (v, through));
                pred[v] = Some(u);
            }
        }
    }
    let mut path = Vec::new();
    let mut u = pred[end];
    while let Some(n) = u.filter(|&n| n != 0) {
        path.push(n);
        u = pred[n];
    }
    path.reverse();
    // `mergeSegments`, then each segment as `buildSingleSegment` reads it.
    let mut out: Vec<Segment> = Vec::new();
    for n in path {
        let (i, j) = ids[n - 1];
        let mode = groups[i][j].0;
        match out.last_mut() {
            Some(s) if s.mode == mode => s.data.push_str(&raw[i].data),
            _ => out.push(Segment { mode, data: raw[i].data.clone() }),
        }
    }
    out
}

/// `BitBuffer`.
struct Bits {
    buffer: Vec<u8>,
    length: usize,
}

impl Bits {
    fn put(&mut self, num: u32, length: usize) {
        for i in 0..length {
            self.put_bit((num >> (length - i - 1)) & 1 == 1);
        }
    }
    fn put_bit(&mut self, bit: bool) {
        let at = self.length / 8;
        if self.buffer.len() <= at {
            self.buffer.push(0);
        }
        if bit {
            self.buffer[at] |= 0x80 >> (self.length % 8);
        }
        self.length += 1;
    }
}

/// `galois-field.js`: exp and log tables over GF(256) modulo 0x11D, the exp table doubled.
fn gf_tables() -> ([u8; 512], [u8; 256]) {
    let (mut exp, mut log) = ([0u8; 512], [0u8; 256]);
    let mut x: u32 = 1;
    for i in 0..255 {
        exp[i] = x as u8;
        log[x as usize] = i as u8;
        x <<= 1;
        if x & 0x100 != 0 {
            x ^= 0x11D;
        }
    }
    for i in 255..512 {
        exp[i] = exp[i - 255];
    }
    (exp, log)
}

struct Gf {
    exp: [u8; 512],
    log: [u8; 256],
}

impl Gf {
    fn mul(&self, x: u8, y: u8) -> u8 {
        if x == 0 || y == 0 {
            0
        } else {
            self.exp[self.log[x as usize] as usize + self.log[y as usize] as usize]
        }
    }
    fn poly_mul(&self, p1: &[u8], p2: &[u8]) -> Vec<u8> {
        let mut c = vec![0u8; p1.len() + p2.len() - 1];
        for (i, &a) in p1.iter().enumerate() {
            for (j, &b) in p2.iter().enumerate() {
                c[i + j] ^= self.mul(a, b);
            }
        }
        c
    }
    /// `generateECPolynomial`.
    fn generator(&self, degree: usize) -> Vec<u8> {
        let mut poly = vec![1u8];
        for i in 0..degree {
            poly = self.poly_mul(&poly, &[1, self.exp[i]]);
        }
        poly
    }
    /// `ReedSolomonEncoder.encode`: the remainder of the data shifted by the generator's degree, padded to it.
    fn encode(&self, data: &[u8], gen: &[u8]) -> Vec<u8> {
        let degree = gen.len() - 1;
        let mut result: Vec<u8> = data.iter().copied().chain(std::iter::repeat_n(0, degree)).collect();
        while result.len() >= gen.len() {
            let coeff = result[0];
            for (i, &g) in gen.iter().enumerate() {
                result[i] ^= self.mul(g, coeff);
            }
            let offset = result.iter().position(|&b| b != 0).unwrap_or(result.len());
            result.drain(..offset);
        }
        let mut out = vec![0u8; degree - result.len()];
        out.extend(result);
        out
    }
}

/// `createData` and `createCodewords`: the segments' bits, terminated and padded, split into blocks with their
/// error correction, interleaved.
fn codewords(version: usize, level: Level, segments: &[Segment]) -> Vec<u8> {
    let mut bits = Bits { buffer: Vec::new(), length: 0 };
    for s in segments {
        bits.put(s.mode.bit(), 4);
        bits.put(s.length() as u32, s.mode.count_bits(version));
        match s.mode {
            Mode::Numeric => {
                let d = s.data.as_bytes();
                let mut i = 0;
                while i + 3 <= d.len() {
                    bits.put(digits(&d[i..i + 3]), 10);
                    i += 3;
                }
                if d.len() > i {
                    bits.put(digits(&d[i..]), (d.len() - i) * 3 + 1);
                }
            }
            Mode::Alphanumeric => {
                let d = s.data.as_bytes();
                let at = |b: u8| ALPHANUMERIC.iter().position(|&a| a == b).unwrap_or(0) as u32;
                let mut i = 0;
                while i + 2 <= d.len() {
                    bits.put(at(d[i]) * 45 + at(d[i + 1]), 11);
                    i += 2;
                }
                if d.len() % 2 == 1 {
                    bits.put(at(d[i]), 6);
                }
            }
            Mode::Byte => {
                for &b in s.data.as_bytes() {
                    bits.put(b as u32, 8);
                }
            }
        }
    }
    let total = CODEWORDS[version];
    let ec_total = ec_codewords(version, level);
    let data_total = total - ec_total;
    let capacity_bits = data_total * 8;
    if bits.length + 4 <= capacity_bits {
        bits.put(0, 4);
    }
    while !bits.length.is_multiple_of(8) {
        bits.put_bit(false);
    }
    let remaining = (capacity_bits - bits.length) / 8;
    for i in 0..remaining {
        bits.put(if i % 2 == 1 { 0x11 } else { 0xEC }, 8);
    }
    let blocks = ec_blocks(version, level);
    let in_group2 = total % blocks;
    let in_group1 = blocks - in_group2;
    let total_in_group1 = total / blocks;
    let data_in_group1 = data_total / blocks;
    let ec_count = total_in_group1 - data_in_group1;
    let (exp, log) = gf_tables();
    let gf = Gf { exp, log };
    let gen = gf.generator(ec_count);
    let mut offset = 0;
    let mut dc: Vec<&[u8]> = Vec::with_capacity(blocks);
    let mut ec: Vec<Vec<u8>> = Vec::with_capacity(blocks);
    let mut max_data = 0;
    for b in 0..blocks {
        let size = if b < in_group1 { data_in_group1 } else { data_in_group1 + 1 };
        let block = &bits.buffer[offset..offset + size];
        ec.push(gf.encode(block, &gen));
        dc.push(block);
        offset += size;
        max_data = max_data.max(size);
    }
    let mut out = Vec::with_capacity(total);
    for i in 0..max_data {
        for block in &dc {
            if let Some(&b) = block.get(i) {
                out.push(b);
            }
        }
    }
    for i in 0..ec_count {
        for block in &ec {
            out.push(block[i]);
        }
    }
    out
}

fn digits(d: &[u8]) -> u32 {
    d.iter().fold(0, |n, &b| n * 10 + (b - b'0') as u32)
}

/// `BitMatrix`: the modules and which of them the mask leaves alone.
struct Matrix {
    size: usize,
    data: Vec<u8>,
    reserved: Vec<bool>,
}

impl Matrix {
    fn set(&mut self, row: usize, col: usize, dark: bool, reserved: bool) {
        let at = row * self.size + col;
        self.data[at] = dark as u8;
        if reserved {
            self.reserved[at] = true;
        }
    }
    fn get(&self, row: usize, col: usize) -> u8 {
        self.data[row * self.size + col]
    }
}

fn bch_digit(mut data: u32) -> i32 {
    let mut digit = 0;
    while data != 0 {
        digit += 1;
        data >>= 1;
    }
    digit
}

fn finder_patterns(m: &mut Matrix) {
    let size = m.size as i64;
    for (row, col) in [(0i64, 0i64), (size - 7, 0), (0, size - 7)] {
        for r in -1..=7i64 {
            if row + r <= -1 || size <= row + r {
                continue;
            }
            for c in -1..=7i64 {
                if col + c <= -1 || size <= col + c {
                    continue;
                }
                let dark = ((0..=6).contains(&r) && (c == 0 || c == 6)) || ((0..=6).contains(&c) && (r == 0 || r == 6)) || ((2..=4).contains(&r) && (2..=4).contains(&c));
                m.set((row + r) as usize, (col + c) as usize, dark, true);
            }
        }
    }
}

fn timing_pattern(m: &mut Matrix) {
    for r in 8..m.size - 8 {
        m.set(r, 6, r % 2 == 0, true);
        m.set(6, r, r % 2 == 0, true);
    }
}

/// `AlignmentPattern.getRowColCoords`.
fn alignment_coords(version: usize) -> Vec<usize> {
    if version == 1 {
        return Vec::new();
    }
    let count = version / 7 + 2;
    let size = version * 4 + 17;
    let interval = if size == 145 { 26 } else { (size - 13).div_ceil(2 * count - 2) * 2 };
    let mut positions = vec![size - 7];
    for i in 1..count - 1 {
        positions.push(positions[i - 1] - interval);
    }
    positions.push(6);
    positions.reverse();
    positions
}

fn alignment_patterns(m: &mut Matrix, version: usize) {
    let pos = alignment_coords(version);
    let n = pos.len();
    for i in 0..n {
        for j in 0..n {
            if (i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0) {
                continue;
            }
            let (row, col) = (pos[i] as i64, pos[j] as i64);
            for r in -2..=2i64 {
                for c in -2..=2i64 {
                    let dark = r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0);
                    m.set((row + r) as usize, (col + c) as usize, dark, true);
                }
            }
        }
    }
}

fn version_info(m: &mut Matrix, version: usize) {
    const G18: u32 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | 1;
    let g18_bch = bch_digit(G18);
    let mut d = (version as u32) << 12;
    while bch_digit(d) - g18_bch >= 0 {
        d ^= G18 << (bch_digit(d) - g18_bch);
    }
    let bits = ((version as u32) << 12) | d;
    let size = m.size;
    for i in 0..18 {
        let row = i / 3;
        let col = i % 3 + size - 8 - 3;
        let dark = (bits >> i) & 1 == 1;
        m.set(row, col, dark, true);
        m.set(col, row, dark, true);
    }
}

fn format_info(m: &mut Matrix, level: Level, mask: u32) {
    const G15: u32 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | 1;
    const G15_MASK: u32 = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
    let g15_bch = bch_digit(G15);
    let data = (level.bit() << 3) | mask;
    let mut d = data << 10;
    while bch_digit(d) - g15_bch >= 0 {
        d ^= G15 << (bch_digit(d) - g15_bch);
    }
    let bits = ((data << 10) | d) ^ G15_MASK;
    let size = m.size;
    for i in 0..15 {
        let dark = (bits >> i) & 1 == 1;
        if i < 6 {
            m.set(i, 8, dark, true);
        } else if i < 8 {
            m.set(i + 1, 8, dark, true);
        } else {
            m.set(size - 15 + i, 8, dark, true);
        }
        if i < 8 {
            m.set(8, size - i - 1, dark, true);
        } else if i < 9 {
            m.set(8, 15 - i, dark, true);
        } else {
            m.set(8, 15 - i - 1, dark, true);
        }
    }
    m.set(size - 8, 8, true, true);
}

/// `setupData`: the codewords' bits up and down the two-module columns, right to left, around what is reserved.
fn place_data(m: &mut Matrix, data: &[u8]) {
    let size = m.size as i64;
    let mut inc = -1i64;
    let mut row = size - 1;
    let mut bit = 7i32;
    let mut byte = 0usize;
    let mut col = size - 1;
    while col > 0 {
        if col == 6 {
            col -= 1;
        }
        loop {
            for c in 0..2 {
                let (r, k) = (row as usize, (col - c) as usize);
                if !m.reserved[r * m.size + k] {
                    let dark = byte < data.len() && (data[byte] >> bit) & 1 == 1;
                    m.set(r, k, dark, false);
                    bit -= 1;
                    if bit == -1 {
                        byte += 1;
                        bit = 7;
                    }
                }
            }
            row += inc;
            if row < 0 || size <= row {
                row -= inc;
                inc = -inc;
                break;
            }
        }
        col -= 2;
    }
}

fn mask_at(mask: u32, i: usize, j: usize) -> bool {
    match mask {
        0 => (i + j).is_multiple_of(2),
        1 => i.is_multiple_of(2),
        2 => j.is_multiple_of(3),
        3 => (i + j).is_multiple_of(3),
        4 => (i / 2 + j / 3).is_multiple_of(2),
        5 => (i * j) % 2 + (i * j) % 3 == 0,
        6 => ((i * j) % 2 + (i * j) % 3).is_multiple_of(2),
        _ => ((i * j) % 3 + (i + j) % 2).is_multiple_of(2),
    }
}

fn apply_mask(m: &mut Matrix, mask: u32) {
    for row in 0..m.size {
        for col in 0..m.size {
            let at = row * m.size + col;
            if !m.reserved[at] {
                m.data[at] ^= mask_at(mask, row, col) as u8;
            }
        }
    }
}

/// `getPenaltyN1` to `getPenaltyN4`, summed.
fn penalty(m: &Matrix) -> f64 {
    let size = m.size;
    let mut n1 = 0usize;
    for row in 0..size {
        let (mut count_col, mut count_row) = (0usize, 0usize);
        let (mut last_col, mut last_row): (Option<u8>, Option<u8>) = (None, None);
        for col in 0..size {
            let module = m.get(row, col);
            if Some(module) == last_col {
                count_col += 1;
            } else {
                if count_col >= 5 {
                    n1 += 3 + (count_col - 5);
                }
                last_col = Some(module);
                count_col = 1;
            }
            let module = m.get(col, row);
            if Some(module) == last_row {
                count_row += 1;
            } else {
                if count_row >= 5 {
                    n1 += 3 + (count_row - 5);
                }
                last_row = Some(module);
                count_row = 1;
            }
        }
        if count_col >= 5 {
            n1 += 3 + (count_col - 5);
        }
        if count_row >= 5 {
            n1 += 3 + (count_row - 5);
        }
    }
    let mut n2 = 0usize;
    for row in 0..size - 1 {
        for col in 0..size - 1 {
            let last = m.get(row, col) + m.get(row, col + 1) + m.get(row + 1, col) + m.get(row + 1, col + 1);
            if last == 4 || last == 0 {
                n2 += 1;
            }
        }
    }
    let mut n3 = 0usize;
    for row in 0..size {
        let (mut bits_col, mut bits_row) = (0u32, 0u32);
        for col in 0..size {
            bits_col = ((bits_col << 1) & 0x7FF) | m.get(row, col) as u32;
            if col >= 10 && (bits_col == 0x5D0 || bits_col == 0x05D) {
                n3 += 1;
            }
            bits_row = ((bits_row << 1) & 0x7FF) | m.get(col, row) as u32;
            if col >= 10 && (bits_row == 0x5D0 || bits_row == 0x05D) {
                n3 += 1;
            }
        }
    }
    let dark: usize = m.data.iter().map(|&d| d as usize).sum();
    let k = ((dark as f64 * 100.0 / m.data.len() as f64) / 5.0).ceil() - 10.0;
    (n1 + n2 * 3 + n3 * 40) as f64 + k.abs() * 10.0
}

/// `QRCode.create(text, { errorCorrectionLevel })`: the symbol, or the package's error.
pub fn encode(text: &str, level: Level) -> Result<Symbol, String> {
    if text.is_empty() {
        return Err("No input text".into());
    }
    let estimated = best_version(&raw_segments(text), level);
    let segments = optimal_segments(text, estimated.unwrap_or(40));
    let Some(version) = best_version(&segments, level) else {
        return Err("The amount of data is too big to be stored in a QR Code".into());
    };
    let data = codewords(version, level, &segments);
    let size = version * 4 + 17;
    let mut m = Matrix { size, data: vec![0; size * size], reserved: vec![false; size * size] };
    finder_patterns(&mut m);
    timing_pattern(&mut m);
    alignment_patterns(&mut m, version);
    format_info(&mut m, level, 0);
    if version >= 7 {
        version_info(&mut m, version);
    }
    place_data(&mut m, &data);
    let (mut best, mut lowest) = (0, f64::INFINITY);
    for p in 0..8 {
        format_info(&mut m, level, p);
        apply_mask(&mut m, p);
        let score = penalty(&m);
        apply_mask(&mut m, p);
        if score < lowest {
            lowest = score;
            best = p;
        }
    }
    apply_mask(&mut m, best);
    format_info(&mut m, level, best);
    Ok(Symbol { version, mask: best, size, modules: m.data })
}

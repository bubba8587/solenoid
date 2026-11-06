//! Sums rounded once, at the end (Shewchuk's partials, as Python's `math.fsum`), then snapped to 0 where the numbers
//! as written cancel (`snap`): order-free ([[C120]] linearWork, `tree/specs/computation/formula-language.md` § Sums).

/// A running exact sum, held as non-overlapping partials, its infinities and NaNs counted beside them.
#[derive(Clone, Debug, Default)]
pub struct ExactSum {
    partials: Vec<f64>,
    up: usize,
    down: usize,
    nan: usize,
    /// The finite magnitudes' plain sum: how far rounding the numbers as written can have moved the total (`snap`).
    abs: f64,
}

impl ExactSum {
    pub fn add(&mut self, x: f64) {
        if !x.is_finite() {
            self.count(x, true);
            return;
        }
        self.abs += x.abs();
        self.exact(x);
    }

    /// Takes a number added before back out.
    pub fn remove(&mut self, x: f64) {
        if x.is_finite() {
            self.abs -= x.abs();
            self.exact(-x);
        } else {
            self.count(x, false);
        }
    }

    fn count(&mut self, x: f64, on: bool) {
        let c = if x.is_nan() {
            &mut self.nan
        } else if x > 0.0 {
            &mut self.up
        } else {
            &mut self.down
        };
        *c = if on { *c + 1 } else { c.saturating_sub(1) };
    }

    fn exact(&mut self, mut x: f64) {
        let mut i = 0;
        for k in 0..self.partials.len() {
            let mut y = self.partials[k];
            if x.abs() < y.abs() {
                std::mem::swap(&mut x, &mut y);
            }
            let hi = x + y;
            if !hi.is_finite() {
                // Past the largest double: the total is that infinity, as plain adding gives.
                self.count(hi, true);
                self.partials.truncate(i);
                return;
            }
            let lo = y - (hi - x);
            if lo != 0.0 {
                self.partials[i] = lo;
                i += 1;
            }
            x = hi;
        }
        self.partials.truncate(i);
        self.partials.push(x);
    }

    /// Adds another sum's numbers, or with `minus` takes them away; still exact.
    pub fn merge(&mut self, other: &ExactSum, minus: bool) {
        for &p in &other.partials {
            self.exact(if minus { -p } else { p });
        }
        for (mine, theirs) in [(&mut self.up, other.up), (&mut self.down, other.down), (&mut self.nan, other.nan)] {
            *mine = if minus { mine.saturating_sub(theirs) } else { *mine + theirs };
        }
        self.abs += if minus { -other.abs } else { other.abs };
    }

    /// The total, rounded once. An empty sum, or one of zeros, is +0; an infinity wins, and both kinds are NaN.
    pub fn value(&self) -> f64 {
        if self.nan > 0 || (self.up > 0 && self.down > 0) {
            return f64::NAN;
        }
        if self.up > 0 {
            return f64::INFINITY;
        }
        if self.down > 0 {
            return f64::NEG_INFINITY;
        }
        let p = &self.partials;
        let Some(&last) = p.last() else { return 0.0 };
        let (mut hi, mut lo, mut n) = (last, 0.0, p.len() - 1);
        while n > 0 {
            let x = hi;
            let y = p[n - 1];
            n -= 1;
            hi = x + y;
            lo = y - (hi - x);
            if lo != 0.0 {
                break;
            }
        }
        // Round half to even past the partial that broke the tie.
        if n > 0 && ((lo < 0.0 && p[n - 1] < 0.0) || (lo > 0.0 && p[n - 1] > 0.0)) {
            let y = lo * 2.0;
            let x = hi + y;
            if y == x - hi {
                hi = x;
            }
        }
        hi + 0.0
    }

    /// The total, snapped where the numbers added, `terms`, cancel as written.
    pub fn total<I: IntoIterator<Item = f64>>(&self, terms: impl FnOnce() -> I) -> f64 {
        self.total_by(|| written_cancel(terms()))
    }

    /// The total, snapped where `cancels` says the numbers added cancel as written. It asks only of a total small
    /// enough that rounding the numbers as written into doubles could have left it: each moves at most half its last
    /// place.
    pub fn total_by(&self, cancels: impl FnOnce() -> bool) -> f64 {
        let total = self.value();
        if total != 0.0 && total.is_finite() && total.abs() <= self.abs * f64::EPSILON && cancels() {
            0.0
        } else {
            total
        }
    }
}

/// Numbers as written, summed exactly: each read as the shortest decimal that gives it back (as it shows and as it was
/// typed), its digits summed per power of ten. `0.1 + 0.2 - 0.3` cancels as written, though its doubles leave 2.8E-17,
/// so its total snaps to 0; `1E297 - 1E297 - 0.089061` leaves -0.089061, which stays (where Excel snaps each addition,
/// `snapped_sum`). A sliding or running sum keeps one and brings it up to date only when it asks, so every number is
/// read once.
#[derive(Clone, Debug, Default)]
pub struct Written {
    by_power: std::collections::BTreeMap<i32, i128>,
    /// A number past what the digit sums hold, or not finite: never cancels.
    broken: bool,
}

impl Written {
    pub fn add(&mut self, x: f64) {
        self.put(x, false);
    }

    pub fn remove(&mut self, x: f64) {
        self.put(x, true);
    }

    fn put(&mut self, x: f64, minus: bool) {
        if !x.is_finite() {
            self.broken = true;
            return;
        }
        if x == 0.0 {
            return;
        }
        let text = format!("{:e}", x.abs());
        let read = text.split_once('e').and_then(|(mantissa, power)| {
            let (whole, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
            Some((format!("{whole}{frac}").parse::<i128>().ok()?, power.parse::<i32>().ok()? - frac.len() as i32))
        });
        let Some((digits, power)) = read else {
            self.broken = true;
            return;
        };
        let signed = if (x < 0.0) != minus { -digits } else { digits };
        let at = self.by_power.entry(power).or_default();
        match at.checked_add(signed) {
            Some(sum) => *at = sum,
            None => self.broken = true,
        }
    }

    pub fn merge(&mut self, other: &Written, minus: bool) {
        self.broken |= other.broken;
        for (&power, &sum) in &other.by_power {
            let at = self.by_power.entry(power).or_default();
            match at.checked_add(if minus { -sum } else { sum }) {
                Some(v) => *at = v,
                None => self.broken = true,
            }
        }
    }

    /// Whether the numbers sum to exactly 0: from the lowest power up, what each power holds carries whole into the
    /// next, and nothing is left.
    pub fn cancels(&self) -> bool {
        if self.broken {
            return false;
        }
        let mut carry: i128 = 0;
        let mut powers = self.by_power.iter().peekable();
        while let Some((&power, &sum)) = powers.next() {
            let Some(v) = sum.checked_add(carry) else { return false };
            let Some(&(&next, _)) = powers.peek() else { return v == 0 };
            match 10i128.checked_pow((next - power) as u32) {
                Some(step) if v % step == 0 => carry = v / step,
                None if v == 0 => carry = 0,
                _ => return false,
            }
        }
        true
    }

    pub fn of(xs: impl IntoIterator<Item = f64>) -> Written {
        let mut w = Written::default();
        xs.into_iter().for_each(|x| w.add(x));
        w
    }
}

fn written_cancel(xs: impl IntoIterator<Item = f64>) -> bool {
    Written::of(xs).cancels()
}

/// The exact total of `xs`, rounded once and snapped.
pub fn exact_sum(xs: &[f64]) -> f64 {
    let mut s = ExactSum::default();
    xs.iter().for_each(|&x| s.add(x));
    s.total(|| xs.iter().copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounds_once() {
        assert_eq!(exact_sum(&[0.1; 10]), 1.0);
        assert_eq!(exact_sum(&[1e100, 1.0, -1e100]), 1.0);
        assert_eq!(exact_sum(&[0.1, 0.2, -0.3]), 0.0);
        assert_eq!(exact_sum(&[1.1, 2.2, -3.3]), 0.0);
        assert_eq!(exact_sum(&[1e297, -1e297, -0.089061]), -0.089061);
        assert_eq!(exact_sum(&[1e15, 0.3, -1e15]), 0.3);
        assert_eq!(exact_sum(&[f64::INFINITY, 1.0]), f64::INFINITY);
        assert!(exact_sum(&[f64::INFINITY, f64::NEG_INFINITY]).is_nan());
        assert_eq!(exact_sum(&[f64::MAX, f64::MAX]), f64::INFINITY);
        assert_eq!(exact_sum(&[0.1, 0.2]), 0.30000000000000004);
        assert_eq!(exact_sum(&[1.0, 1e-16, 1e-16]), 1.0000000000000002);
        assert!(exact_sum(&[-0.0]).is_sign_positive());
        assert_eq!(exact_sum(&[]), 0.0);
        assert!(written_cancel([1e-300, -1e300, 1e300, -1e-300]));
        assert!(!written_cancel([1e-300, -1e300, 1e300]));
    }

    /// A sum slid along a list snaps as a fresh sum of its window does.
    #[test]
    fn a_sliding_sum_snaps_as_a_fresh_one() {
        let xs = [0.1, 0.2, -0.3, 0.1, 0.2, -0.3, 1e297, -1e297, -0.089061, 5.0, -5.0, 0.7, 0.1];
        for width in 1..=4 {
            let (mut s, mut w) = (ExactSum::default(), Written::default());
            for p in 0..xs.len() {
                s.add(xs[p]);
                w.add(xs[p]);
                if p >= width {
                    s.remove(xs[p - width]);
                    w.remove(xs[p - width]);
                }
                let window = &xs[(p + 1).saturating_sub(width)..=p];
                assert_eq!(s.total_by(|| w.cancels()).to_bits(), exact_sum(window).to_bits(), "{width} {p}");
            }
        }
    }

    #[test]
    fn any_order_and_any_split_agree() {
        let xs: Vec<f64> = (0..500).map(|i| ((i * 7919) % 1000) as f64 * 0.013 - 6.1).collect();
        let want = exact_sum(&xs);
        let mut rev = xs.clone();
        rev.reverse();
        assert_eq!(exact_sum(&rev), want);
        let (mut a, mut b, mut whole) = (ExactSum::default(), ExactSum::default(), ExactSum::default());
        xs[..200].iter().for_each(|&x| a.add(x));
        xs[200..].iter().for_each(|&x| b.add(x));
        xs.iter().for_each(|&x| whole.add(x));
        a.merge(&b, false);
        assert_eq!(a.total(|| xs.iter().copied()), want);
        whole.merge(&b, true);
        assert_eq!(whole.total(|| xs[..200].iter().copied()), exact_sum(&xs[..200]));
    }
}

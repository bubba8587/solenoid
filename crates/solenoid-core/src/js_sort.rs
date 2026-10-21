// [[C130]] rustCore
//! `Array.prototype.sort` with a comparator: stable, and total over any comparator. A comparator
//! that isn't a strict weak order (a NaN, mixed kinds compared as text) must not panic the engine,
//! as `slice::sort_by` may.

use std::cmp::Ordering;

pub fn js_sort_by<T: Clone>(v: &mut Vec<T>, mut cmp: impl FnMut(&T, &T) -> Ordering) {
    let n = v.len();
    if n < 2 {
        return;
    }
    // Insertion-sort runs of 16, then merge bottom-up; every step only asks "is b before a?".
    const RUN: usize = 16;
    for start in (0..n).step_by(RUN) {
        let end = (start + RUN).min(n);
        for i in start + 1..end {
            let mut j = i;
            while j > start && cmp(&v[j], &v[j - 1]) == Ordering::Less {
                v.swap(j, j - 1);
                j -= 1;
            }
        }
    }
    let mut buf: Vec<T> = Vec::with_capacity(n);
    let mut width = RUN;
    while width < n {
        buf.clear();
        let mut lo = 0;
        while lo < n {
            let mid = (lo + width).min(n);
            let hi = (lo + 2 * width).min(n);
            let (mut i, mut j) = (lo, mid);
            while i < mid && j < hi {
                if cmp(&v[j], &v[i]) == Ordering::Less {
                    buf.push(v[j].clone());
                    j += 1;
                } else {
                    buf.push(v[i].clone());
                    i += 1;
                }
            }
            buf.extend_from_slice(&v[i..mid]);
            buf.extend_from_slice(&v[j..hi]);
            lo = hi;
        }
        std::mem::swap(v, &mut buf);
        width *= 2;
    }
}

/// V8's sort below 64 items, exact for any comparator (a NaN reads as 0): one run found by `CountAndMakeRun`, the
/// rest placed by binary insertion. None at 64 or more, where V8 merges runs.
pub fn v8_sort_short<T>(v: &mut [T], mut cmp: impl FnMut(&T, &T) -> f64) -> Option<()> {
    let n = v.len();
    if n >= 64 {
        return None;
    }
    if n < 2 {
        return Some(());
    }
    let mut c = |a: &T, b: &T| { let o = cmp(a, b); if o.is_nan() { 0.0 } else { o } };
    let descending = c(&v[1], &v[0]) < 0.0;
    let mut run = 2;
    while run < n {
        let o = c(&v[run], &v[run - 1]);
        if if descending { o >= 0.0 } else { o < 0.0 } {
            break;
        }
        run += 1;
    }
    if descending {
        v[..run].reverse();
    }
    for start in run..n {
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if c(&v[start], &v[mid]) < 0.0 { right = mid } else { left = mid + 1 }
        }
        v[left..=start].rotate_right(1);
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_and_total() {
        let mut v: Vec<(i32, usize)> = (0..1000).map(|i| ((i * 7919 % 13) as i32, i)).collect();
        js_sort_by(&mut v, |a, b| a.0.cmp(&b.0));
        assert!(v.windows(2).all(|w| w[0].0 < w[1].0 || (w[0].0 == w[1].0 && w[0].1 < w[1].1)));
        let mut w: Vec<f64> = (0..500).map(|i| if i % 3 == 0 { f64::NAN } else { (i % 17) as f64 }).collect();
        js_sort_by(&mut w, |a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    }
}

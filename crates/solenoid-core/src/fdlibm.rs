// [[C16]] polarsEngine
//! The fdlibm routines V8 runs `Math.exp`, `Math.log`, `Math.log10` and `Math.pow` on (`src/base/ieee754.cc`),
//! ported so a formula's answer matches the JS one bit for bit. The platform `exp`/`ln`/`powf` round differently in
//! the last place on some inputs. Sun Microsystems' notice: "Permission to use, copy, modify, and distribute this
//! software is freely granted, provided that this notice is preserved."

#![allow(clippy::excessive_precision, clippy::many_single_char_names, clippy::approx_constant)]

fn hi(x: f64) -> i32 {
    (x.to_bits() >> 32) as i32
}

fn lo(x: f64) -> u32 {
    x.to_bits() as u32
}

fn from_words(hi: i32, lo: u32) -> f64 {
    f64::from_bits((u64::from(hi as u32) << 32) | u64::from(lo))
}

fn with_hi(x: f64, h: i32) -> f64 {
    from_words(h, lo(x))
}

fn with_lo(x: f64, l: u32) -> f64 {
    from_words(hi(x), l)
}

const HUGE: f64 = 1.0e300;
const TINY: f64 = 1.0e-300;
const TWOM1000: f64 = 9.33263618503218878990e-302;
const LN2_HI: [f64; 2] = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
const LN2_LO: [f64; 2] = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const HALF: [f64; 2] = [0.5, -0.5];
const INVLN2: f64 = 1.44269504088896338700e+00;
const P1: f64 = 1.66666666666666019037e-01;
const P2: f64 = -2.77777777770155933842e-03;
const P3: f64 = 6.61375632143793436117e-05;
const P4: f64 = -1.65339022054652515390e-06;
const P5: f64 = 4.13813679705723846039e-08;

pub fn exp(x: f64) -> f64 {
    const O_THRESHOLD: f64 = 7.09782712893383973096e+02;
    const U_THRESHOLD: f64 = -7.45133219101941108420e+02;
    let mut x = x;
    let (mut hi_, mut lo_) = (0.0, 0.0);
    let mut k: i32 = 0;
    let mut hx = hi(x) as u32;
    let xsb = ((hx >> 31) & 1) as usize;
    hx &= 0x7fff_ffff;
    if hx >= 0x4086_2E42 {
        if hx >= 0x7ff0_0000 {
            if ((hx & 0xfffff) | lo(x)) != 0 {
                return x + x;
            }
            return if xsb == 0 { x } else { 0.0 };
        }
        if x > O_THRESHOLD {
            return f64::INFINITY;
        }
        if x < U_THRESHOLD {
            return 0.0;
        }
    }
    if hx > 0x3fd6_2e42 {
        if hx < 0x3FF0_A2B2 {
            // V8's own fix: the reduction below gets the last bit of exp(1) wrong.
            if x == 1.0 {
                return std::f64::consts::E;
            }
            hi_ = x - LN2_HI[xsb];
            lo_ = LN2_LO[xsb];
            k = 1 - xsb as i32 - xsb as i32;
        } else {
            k = (INVLN2 * x + HALF[xsb]) as i32;
            let t = f64::from(k);
            hi_ = x - t * LN2_HI[0];
            lo_ = t * LN2_LO[0];
        }
        x = hi_ - lo_;
    } else if hx < 0x3e30_0000 {
        if HUGE + x > 1.0 {
            return 1.0 + x;
        }
    } else {
        k = 0;
    }
    let t = x * x;
    let twopk = if k >= -1021 { from_words(0x3ff0_0000 + (k << 20), 0) } else { from_words(0x3ff0_0000 + ((k + 1000) << 20), 0) };
    let c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo_ - (x * c) / (2.0 - c)) - hi_);
    if k >= -1021 {
        if k == 1024 {
            return y * 2.0 * f64::from_bits(0x7fe0_0000_0000_0000);
        }
        y * twopk
    } else {
        y * twopk * TWOM1000
    }
}

pub fn log(x: f64) -> f64 {
    const LN2_HI1: f64 = 6.93147180369123816490e-01;
    const LN2_LO1: f64 = 1.90821492927058770002e-10;
    const TWO54: f64 = 1.80143985094819840000e+16;
    const LG1: f64 = 6.666666666666735130e-01;
    const LG2: f64 = 3.999999999940941908e-01;
    const LG3: f64 = 2.857142874366239149e-01;
    const LG4: f64 = 2.222219843214978396e-01;
    const LG5: f64 = 1.818357216161805012e-01;
    const LG6: f64 = 1.531383769920937332e-01;
    const LG7: f64 = 1.479819860511658591e-01;
    let mut x = x;
    let mut hx = hi(x);
    let lx = lo(x);
    let mut k: i32 = 0;
    if hx < 0x0010_0000 {
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return f64::NEG_INFINITY;
        }
        if hx < 0 {
            return f64::NAN;
        }
        k -= 54;
        x *= TWO54;
        hx = hi(x);
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000f_ffff;
    let i = (hx + 0x95f64) & 0x10_0000;
    x = with_hi(x, hx | (i ^ 0x3ff0_0000));
    k += i >> 20;
    let f = x - 1.0;
    if (0x000f_ffff & (2 + hx)) < 3 {
        if f == 0.0 {
            if k == 0 {
                return 0.0;
            }
            let dk = f64::from(k);
            return dk * LN2_HI1 + dk * LN2_LO1;
        }
        let r = f * f * (0.5 - 0.33333333333333333 * f);
        if k == 0 {
            return f - r;
        }
        let dk = f64::from(k);
        return dk * LN2_HI1 - ((r - dk * LN2_LO1) - f);
    }
    let s = f / (2.0 + f);
    let dk = f64::from(k);
    let z = s * s;
    let mut i = hx - 0x6147a;
    let w = z * z;
    let j = 0x6b851 - hx;
    let t1 = w * (LG2 + w * (LG4 + w * LG6));
    let t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    i |= j;
    let r = t2 + t1;
    if i > 0 {
        let hfsq = 0.5 * f * f;
        if k == 0 {
            f - (hfsq - s * (hfsq + r))
        } else {
            dk * LN2_HI1 - ((hfsq - (s * (hfsq + r) + dk * LN2_LO1)) - f)
        }
    } else if k == 0 {
        f - s * (f - r)
    } else {
        dk * LN2_HI1 - ((s * (f - r) - dk * LN2_LO1) - f)
    }
}

pub fn log10(x: f64) -> f64 {
    const TWO54: f64 = 1.80143985094819840000e+16;
    const IVLN10: f64 = 4.34294481903251816668e-01;
    const LOG10_2HI: f64 = 3.01029995663611771306e-01;
    const LOG10_2LO: f64 = 3.69423907715893078616e-13;
    let mut x = x;
    let mut hx = hi(x);
    let mut lx = lo(x);
    let mut k: i32 = 0;
    if hx < 0x0010_0000 {
        if ((hx & 0x7fff_ffff) as u32 | lx) == 0 {
            return f64::NEG_INFINITY;
        }
        if hx < 0 {
            return f64::NAN;
        }
        k -= 54;
        x *= TWO54;
        hx = hi(x);
        lx = lo(x);
    }
    if hx >= 0x7ff0_0000 {
        return x + x;
    }
    if hx == 0x3ff0_0000 && lx == 0 {
        return 0.0;
    }
    k += (hx >> 20) - 1023;
    let i = ((k as u32 & 0x8000_0000) >> 31) as i32;
    hx = (hx & 0x000f_ffff) | ((0x3ff - i) << 20);
    let y = f64::from(k + i);
    x = from_words(hx, lx);
    let z = y * LOG10_2LO + IVLN10 * log(x);
    z + y * LOG10_2HI
}

fn scalbn(x: f64, n: i32) -> f64 {
    let mut y = x;
    let mut n = n;
    if n > 1023 {
        y *= f64::from_bits(0x7fe0_0000_0000_0000);
        n -= 1023;
        if n > 1023 {
            y *= f64::from_bits(0x7fe0_0000_0000_0000);
            n -= 1023;
            if n > 1023 {
                n = 1023;
            }
        }
    } else if n < -1022 {
        y *= f64::from_bits(0x0010_0000_0000_0000) * f64::from_bits(0x4340_0000_0000_0000);
        n += 1022 - 53;
        if n < -1022 {
            y *= f64::from_bits(0x0010_0000_0000_0000) * f64::from_bits(0x4340_0000_0000_0000);
            n += 1022 - 53;
            if n < -1022 {
                n = -1022;
            }
        }
    }
    y * f64::from_bits(((0x3ff + n) as u64) << 52)
}

pub fn pow(x: f64, y: f64) -> f64 {
    const BP: [f64; 2] = [1.0, 1.5];
    const DP_H: [f64; 2] = [0.0, 5.84962487220764160156e-01];
    const DP_L: [f64; 2] = [0.0, 1.35003920212974897128e-08];
    const TWO53: f64 = 9007199254740992.0;
    const L1: f64 = 5.99999999999994648725e-01;
    const L2: f64 = 4.28571428578550184252e-01;
    const L3: f64 = 3.33333329818377432918e-01;
    const L4: f64 = 2.72728123808534006489e-01;
    const L5: f64 = 2.30660745775561754067e-01;
    const L6: f64 = 2.06975017800338417784e-01;
    const LG2: f64 = 6.93147180559945286227e-01;
    const LG2_H: f64 = 6.93147182464599609375e-01;
    const LG2_L: f64 = -1.90465429995776804525e-09;
    const OVT: f64 = 8.0085662595372944372e-17;
    const CP: f64 = 9.61796693925975554329e-01;
    const CP_H: f64 = 9.61796700954437255859e-01;
    const CP_L: f64 = -7.02846165095275826516e-09;
    const IVLN2: f64 = 1.44269504088896338700e+00;
    const IVLN2_H: f64 = 1.44269502162933349609e+00;
    const IVLN2_L: f64 = 1.92596299112661746887e-08;

    let (hx, lx) = (hi(x), lo(x));
    let (hy, ly) = (hi(y), lo(y));
    let mut ix = hx & 0x7fff_ffff;
    let iy = hy & 0x7fff_ffff;

    if (iy as u32 | ly) == 0 {
        return 1.0;
    }
    if hx == 0x3ff0_0000 && lx == 0 {
        return 1.0;
    }
    if ix > 0x7ff0_0000 || (ix == 0x7ff0_0000 && lx != 0) || iy > 0x7ff0_0000 || (iy == 0x7ff0_0000 && ly != 0) {
        return x + y;
    }

    let mut yisint = 0;
    if hx < 0 {
        if iy >= 0x4340_0000 {
            yisint = 2;
        } else if iy >= 0x3ff0_0000 {
            let k = (iy >> 20) - 0x3ff;
            if k > 20 {
                let j = ly >> (52 - k);
                if (j << (52 - k)) == ly {
                    yisint = 2 - (j & 1) as i32;
                }
            } else if ly == 0 {
                let j = iy >> (20 - k);
                if (j << (20 - k)) == iy {
                    yisint = 2 - (j & 1);
                }
            }
        }
    }

    if ly == 0 {
        if iy == 0x7ff0_0000 {
            if ((ix - 0x3ff0_0000) as u32 | lx) == 0 {
                return 1.0;
            } else if ix >= 0x3ff0_0000 {
                return if hy >= 0 { y } else { 0.0 };
            } else {
                return if hy < 0 { -y } else { 0.0 };
            }
        }
        if iy == 0x3ff0_0000 {
            return if hy < 0 { 1.0 / x } else { x };
        }
        if hy == 0x4000_0000 {
            return x * x;
        }
        if hy == 0x3fe0_0000 && hx >= 0 {
            return x.sqrt();
        }
    }

    let mut ax = x.abs();
    if lx == 0 && (ix == 0x7ff0_0000 || ix == 0 || ix == 0x3ff0_0000) {
        let mut z = ax;
        if hy < 0 {
            z = 1.0 / z;
        }
        if hx < 0 {
            if ((ix - 0x3ff0_0000) | yisint) == 0 {
                z = f64::NAN;
            } else if yisint == 1 {
                z = -z;
            }
        }
        return z;
    }

    let mut n: i32 = ((hx as u32) >> 31) as i32 - 1;
    if (n | yisint) == 0 {
        return f64::NAN;
    }
    let mut s = 1.0;
    if (n | (yisint - 1)) == 0 {
        s = -1.0;
    }

    let (t1, t2);
    if iy > 0x41e0_0000 {
        if iy > 0x43f0_0000 {
            if ix <= 0x3fef_ffff {
                return if hy < 0 { HUGE * HUGE } else { TINY * TINY };
            }
            if ix >= 0x3ff0_0000 {
                return if hy > 0 { HUGE * HUGE } else { TINY * TINY };
            }
        }
        if ix < 0x3fef_ffff {
            return if hy < 0 { s * HUGE * HUGE } else { s * TINY * TINY };
        }
        if ix > 0x3ff0_0000 {
            return if hy > 0 { s * HUGE * HUGE } else { s * TINY * TINY };
        }
        let t = ax - 1.0;
        let w = (t * t) * (0.5 - t * (3.3333333333333331e-01 - t * 0.25));
        let u = IVLN2_H * t;
        let v = t * IVLN2_L - w * IVLN2;
        t1 = with_lo(u + v, 0);
        t2 = v - (t1 - u);
    } else {
        n = 0;
        if ix < 0x0010_0000 {
            ax *= TWO53;
            n -= 53;
            ix = hi(ax);
        }
        n += (ix >> 20) - 0x3ff;
        let j = ix & 0x000f_ffff;
        ix = j | 0x3ff0_0000;
        let k: usize;
        if j <= 0x3988E {
            k = 0;
        } else if j < 0xBB67A {
            k = 1;
        } else {
            k = 0;
            n += 1;
            ix -= 0x0010_0000;
        }
        ax = with_hi(ax, ix);

        let u = ax - BP[k];
        let v = 1.0 / (ax + BP[k]);
        let ss = u * v;
        let s_h = with_lo(ss, 0);
        let t_h = from_words(((ix >> 1) | 0x2000_0000) + 0x0008_0000 + ((k as i32) << 18), 0);
        let t_l = ax - (t_h - BP[k]);
        let s_l = v * ((u - s_h * t_h) - s_h * t_l);
        let mut s2 = ss * ss;
        let mut r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
        r += s_l * (s_h + ss);
        s2 = s_h * s_h;
        let t_h = with_lo(3.0 + s2 + r, 0);
        let t_l = r - ((t_h - 3.0) - s2);
        let u = s_h * t_h;
        let v = s_l * t_h + t_l * ss;
        let p_h = with_lo(u + v, 0);
        let p_l = v - (p_h - u);
        let z_h = CP_H * p_h;
        let z_l = CP_L * p_h + p_l * CP + DP_L[k];
        let t = f64::from(n);
        t1 = with_lo(((z_h + z_l) + DP_H[k]) + t, 0);
        t2 = z_l - (((t1 - t) - DP_H[k]) - z_h);
    }

    let y1 = with_lo(y, 0);
    let p_l = (y - y1) * t1 + y * t2;
    let mut p_h = y1 * t1;
    let z = p_l + p_h;
    let (j, i) = (hi(z), lo(z));
    if j >= 0x4090_0000 {
        if ((j - 0x4090_0000) as u32 | i) != 0 || p_l + OVT > z - p_h {
            return s * HUGE * HUGE;
        }
    } else if (j & 0x7fff_ffff) >= 0x4090_cc00 && (((j as u32).wrapping_sub(0xc090_cc00)) | i != 0 || p_l <= z - p_h) {
        return s * TINY * TINY;
    }

    let i = j & 0x7fff_ffff;
    let mut k = (i >> 20) - 0x3ff;
    let mut n: i32 = 0;
    if i > 0x3fe0_0000 {
        n = j + (0x0010_0000 >> (k + 1));
        k = ((n & 0x7fff_ffff) >> 20) - 0x3ff;
        let t = from_words(n & !(0x000f_ffff >> k), 0);
        n = ((n & 0x000f_ffff) | 0x0010_0000) >> (20 - k);
        if j < 0 {
            n = -n;
        }
        p_h -= t;
    }
    let t = with_lo(p_l + p_h, 0);
    let u = t * LG2_H;
    let v = (p_l - (t - p_h)) * LG2 + t * LG2_L;
    let z = u + v;
    let w = v - (z - u);
    let t = z * z;
    let t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    // V8 groups this as (z*t1) / ((t1-2) - (w+z*w)), where fdlibm subtracts (w+z*w) after the division.
    let r = (z * t1) / ((t1 - 2.0) - (w + z * w));
    let mut z = 1.0 - (r - z);
    let mut j = hi(z);
    j = j.wrapping_add(n << 20);
    if (j >> 20) <= 0 {
        z = scalbn(z, n);
    } else {
        z = with_hi(z, j);
    }
    s * z
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_values() {
        assert_eq!(exp(1.0), std::f64::consts::E);
        assert_eq!(log(std::f64::consts::E), 1.0);
        assert_eq!(log10(1000.0), 3.0);
        assert_eq!(pow(2.0, 10.0), 1024.0);
        assert!(pow(-8.0, 1.0 / 3.0).is_nan());
        assert_eq!(pow(10.0, -2.0), 0.01);
    }
}

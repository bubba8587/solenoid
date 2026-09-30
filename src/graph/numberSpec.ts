// [[C96]] chartOptionsAreMatplotlib
// A Python format spec as seaborn's `fmt` takes it: `[+][,][.N][f|e|g|d|%]`, e.g. `.2f`, `,.0f`, `.1%`, `d`.

const SPEC = /^(\+)?(,)?(?:\.(\d{1,2}))?([fFeEgGd%])?$/;

export function isNumberSpec(spec: string): boolean {
  const s = spec.trim();
  return s !== "" && SPEC.test(s);
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function withGrouping(text: string, comma: boolean): string {
  if (!comma) return text;
  const m = /^(-?)(\d+)(.*)$/.exec(text);
  return m ? `${m[1]}${group(m[2])}${m[3]}` : text;
}

function pyExp(v: number, digits: number): string {
  const [mant, exp] = v.toExponential(digits).split("e");
  const e = Number(exp);
  return `${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

/** `v` formatted by the spec, or null when the spec is not one this reads. */
export function formatNumberSpec(v: number, spec: string): string | null {
  const m = SPEC.exec(spec.trim());
  if (!m || spec.trim() === "") return null;
  if (!Number.isFinite(v)) return String(v);
  const [, plus, comma, precText, typeRaw] = m;
  const prec = precText === undefined ? undefined : Number(precText);
  const type = (typeRaw ?? "g").toLowerCase();
  let out: string;
  switch (type) {
    case "d": out = withGrouping(Math.round(v).toString(), !!comma); break;
    case "f": out = withGrouping(v.toFixed(prec ?? 6), !!comma); break;
    case "%": out = `${withGrouping((v * 100).toFixed(prec ?? 6), !!comma)}%`; break;
    case "e": out = pyExp(v, prec ?? 6); break;
    default: {
      const p = Math.max(1, prec ?? 6);
      if (v === 0) { out = "0"; break; }
      const exp = Math.floor(Math.log10(Math.abs(Number(v.toPrecision(p)))));
      if (exp < -4 || exp >= p) {
        out = pyExp(v, p - 1).replace(/\.?0+e/, "e");
      } else {
        out = v.toFixed(Math.max(0, p - 1 - exp));
        if (out.includes(".")) out = out.replace(/\.?0+$/, "");
        out = withGrouping(out, !!comma);
      }
    }
  }
  return plus && v >= 0 ? `+${out}` : out;
}

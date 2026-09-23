// [[D5]] searchWiderThanLabel
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let qi = 0, score = 0, last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += last === ti - 1 ? 3 : 1;
      last = ti;
      qi++;
    }
  }
  return qi === q.length ? score : null;
}

export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  if (la === lb) {
    while (a[i] === b[i]) i++;
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [s, l] = la < lb ? [a, b] : [b, a];
  while (i < s.length && s[i] === l[i]) i++;
  return s.slice(i) === l.slice(i + 1);
}

export function tokenWordScore(token: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === token) return 150;
    if (w.startsWith(token)) best = Math.max(best, 100);
    else if (best < 90 && token.length >= 4 && withinOneEdit(token, w)) best = 90;
  }
  return best;
}

export function fieldScore(query: string, field: string): number | null {
  const sub = fuzzyScore(query, field);
  if (sub === null) return null;
  const q = query.toLowerCase().replace(/\s+/g, "");
  const f = field.toLowerCase();
  let tier = 0;
  if (f === q) tier = 1000;
  else if (f.startsWith(q)) tier = 400;
  else if (f.split(/\s+/).some((w) => w.startsWith(q))) tier = 150;
  return tier + sub;
}

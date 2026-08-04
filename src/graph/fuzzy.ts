// Subsequence fuzzy match: returns a score (higher = better, consecutive runs
// weighted) or null when the query isn't a subsequence of the text.
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

// Tiered match quality for one field: exact ≫ prefix ≫ word-start ≫ subsequence.
// Returns the contiguity score plus a tier bonus, or null when the query isn't
// even a subsequence. Lets exact/prefix hits float above incidental matches.
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

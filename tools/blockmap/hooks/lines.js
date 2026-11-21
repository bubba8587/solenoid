// How many lines a Claude Code edit added and removed. Pure, so the tests can call it.

// Lines an edit added and removed: from the structured patch Claude Code returns when there is one, else from
// the strings the edit swapped, else (a whole-file write) every line counts as added.
export function lineCounts(tool, input = {}, response = {}) {
  const patch = response?.structuredPatch;
  if (Array.isArray(patch) && patch.length) {
    let add = 0;
    let del = 0;
    for (const hunk of patch) {
      for (const line of hunk.lines || []) {
        if (line.startsWith('+')) add++;
        else if (line.startsWith('-')) del++;
      }
    }
    return { add, del };
  }
  const count = (text) => (text ? String(text).split('\n').length : 0);
  const pair = (a, b) => {
    const x = count(a);
    const y = count(b);
    const same = Math.min(x, y) && String(a).split('\n').filter((l) => String(b).split('\n').includes(l)).length;
    return { add: y - (same || 0), del: x - (same || 0) };
  };
  if (tool === 'Edit') return pair(input.old_string, input.new_string);
  if (tool === 'MultiEdit') {
    return (input.edits || []).reduce((acc, e) => {
      const c = pair(e.old_string, e.new_string);
      return { add: acc.add + c.add, del: acc.del + c.del };
    }, { add: 0, del: 0 });
  }
  if (tool === 'Write') return { add: count(input.content), del: 0 };
  return {};
}

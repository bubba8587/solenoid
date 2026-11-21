// What the Claude Code hook reads from a tool call: the lines an edit added and removed, and whether a test run
// passed. Pure, so the tests can call it.

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
  const lines = (text) => (text ? String(text).split('\n') : []);
  const count = (text) => lines(text).length;
  // Lines are matched one to one, as a multiset: a new line with no unmatched copy among the old ones was added,
  // and an old line left without a match was removed.
  const pair = (a, b) => {
    const left = new Map();
    for (const l of lines(a)) left.set(l, (left.get(l) || 0) + 1);
    let add = 0;
    for (const l of lines(b)) {
      const n = left.get(l) || 0;
      if (n) left.set(l, n - 1);
      else add++;
    }
    let del = 0;
    for (const n of left.values()) del += n;
    return { add, del };
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

// Whether a test run passed, from what the runner printed, or null when it can't tell. Every result line counts:
// cargo prints one per test binary, and the run passes only if none of them failed.
export function testVerdict(response) {
  const text = typeof response === 'string' ? response : [response?.stdout, response?.stderr, response?.output].filter(Boolean).join('\n');
  if (!text) return null;
  const cargo = [...text.matchAll(/test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/g)];
  if (cargo.length) {
    const passed = cargo.reduce((n, m) => n + Number(m[2]), 0);
    const failed = cargo.reduce((n, m) => n + Number(m[3]), 0);
    const broke = failed > 0 || cargo.some((m) => m[1] === 'FAILED') || /^error: (?:test failed|\d+ targets? failed)/m.test(text);
    return broke ? { ok: false, summary: `${failed || 'some'} failed, ${passed} passed` } : { ok: true, summary: `${passed} passed` };
  }
  // node --test ends with "# pass N" and "# fail N" (or ℹ in the spec reporter).
  const nodeFail = /^[#ℹ] fail (\d+)$/m.exec(text);
  const nodePass = /^[#ℹ] pass (\d+)$/m.exec(text);
  if (nodeFail || nodePass) {
    if (nodeFail && nodeFail[1] !== '0') return { ok: false, summary: `${nodeFail[1]} failed` };
    if (nodePass) return { ok: true, summary: `${nodePass[1]} passed` };
  }
  // vitest and jest print a "Tests" line under "Test Files"; it's the count people mean.
  const tests = text.match(/^\s*Tests:?\s+.*$/gm);
  const hay = tests ? tests.join('\n') : text;
  const failed = [...hay.matchAll(/(\d+)\s+(?:failed|failing)\b/gi)].find((m) => m[1] !== '0') || (!tests && /\bFAIL\b/.exec(hay));
  const passed = /(\d+)\s+(?:passed|passing)\b/i.exec(hay);
  if (failed) return { ok: false, summary: tail(failed[0]) };
  if (passed) return { ok: true, summary: tail(passed[0]) };
  return null;
}

function tail(s) {
  return String(s).slice(0, 80);
}

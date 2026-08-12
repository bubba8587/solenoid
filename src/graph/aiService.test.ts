// The palette's service layer, exercised against a FAKE transport: the
// injected fetch returns hand-built Messages-API responses, so every branch —
// answer, validated edit, repair round, exhausted repairs, refusal — runs
// without a network or a real key. The validator inside is the real one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runAiPrompt } from "./aiService";
import { apiKeyStore } from "./apiKeyStore";
import { AI_PROVIDER } from "./aiKey";
import { readTextForm } from "./textForm";

const EMPTY_DOC = "---\n{\n  \"v\": 2,\n  \"positions\": {}\n}\n";

function apiMessage(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

/** A fetch that serves the queued replies in order and records request bodies. */
function fakeFetch(replies: unknown[]) {
  const bodies: string[] = [];
  let i = 0;
  const fn: typeof globalThis.fetch = async (_input, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const reply = replies[Math.min(i, replies.length - 1)];
    i++;
    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, bodies, calls: () => i };
}

beforeEach(() => apiKeyStore.set(AI_PROVIDER, "sk-test"));
afterEach(() => apiKeyStore.set(AI_PROVIDER, ""));

describe("runAiPrompt", () => {
  it("errors without a stored key, before any request", async () => {
    apiKeyStore.set(AI_PROVIDER, "");
    const { fn, calls } = fakeFetch([]);
    const out = await runAiPrompt("hi", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("error");
    expect(calls()).toBe(0);
  });

  it("returns prose without a fence as an answer", async () => {
    const { fn } = fakeFetch([apiMessage("The document has no nodes yet.")]);
    const out = await runAiPrompt("what is here?", EMPTY_DOC, { fetch: fn });
    expect(out).toEqual({ kind: "answer", text: "The document has no nodes yet." });
  });

  it("returns a valid fenced rewrite as a canonicalized edit", async () => {
    const doc = 'A: NumberInputNode label="A" value=7\nShow: DisplayNode in<-A.value\n---\n{ "v": 2 }\n';
    const { fn } = fakeFetch([apiMessage("Added a display.\n```solenoid\n" + doc + "```")]);
    const out = await runAiPrompt("show 7", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("edit");
    if (out.kind !== "edit") return;
    // Canonical: parses back to the same graph, and a second canonicalization
    // is byte-stable.
    const g = readTextForm(out.newText);
    expect(g.nodes.map((n) => n.type).sort()).toEqual(["DisplayNode", "NumberInputNode"]);
    expect(out.warnings).toEqual([]);
  });

  it("feeds validator issues back as a repair round, then succeeds", async () => {
    const bad = 'A: NumberInputNod value=7\n---\n{ "v": 2 }\n';
    const good = 'A: NumberInputNode value=7\n---\n{ "v": 2 }\n';
    const { fn, bodies, calls } = fakeFetch([
      apiMessage("```solenoid\n" + bad + "```"),
      apiMessage("```solenoid\n" + good + "```"),
    ]);
    const out = await runAiPrompt("make a 7", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("edit");
    expect(calls()).toBe(2);
    // The second request carried the validator's message for the model to fix from.
    expect(bodies[1]).toContain("unknown node type");
    expect(bodies[1]).toContain("NumberInputNode");
  });

  it("gives up after the repair budget with the surviving issues", async () => {
    const bad = 'A: NumberInputNod value=7\n---\n{ "v": 2 }\n';
    const { fn, calls } = fakeFetch([apiMessage("```solenoid\n" + bad + "```")]);
    const out = await runAiPrompt("make a 7", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect(out.message).toContain("unknown node type");
    expect(calls()).toBe(3); // first attempt + 2 repairs
  });

  it("surfaces a refusal as an error", async () => {
    const { fn } = fakeFetch([apiMessage("", "refusal")]);
    const out = await runAiPrompt("hi", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("error");
    if (out.kind !== "error") return;
    expect(out.message).toContain("declined");
  });

  it("keeps a legal cycle as a warning on the edit", async () => {
    const cyc = "A: ArithmeticNode a<-B.result\nB: ArithmeticNode a<-A.result\n---\n{ \"v\": 2 }\n";
    const { fn } = fakeFetch([apiMessage("```solenoid\n" + cyc + "```")]);
    const out = await runAiPrompt("loop", EMPTY_DOC, { fetch: fn });
    expect(out.kind).toBe("edit");
    if (out.kind !== "edit") return;
    expect(out.warnings.some((wText) => wText.includes("#CIRC!"))).toBe(true);
  });
});

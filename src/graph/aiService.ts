// The AI command palette's service layer (D27/D28): one prompt in, either a
// prose answer about the graph or a validated whole-document rewrite out.
// The model reads the document's current text form and emits a FULL
// replacement inside a ```solenoid fence; the strict validator gates every
// candidate, hard issues go back to the model as a repair round, and only a
// clean result reaches the approval diff. Modify actions never touch the doc
// from here — the palette shows the old→new diff and applies on explicit
// approval (the cage rule: an AI edit goes through the same governed path as
// a human edit).
//
// Provider: Anthropic (author call, 2026-08-01). The key is the user's own,
// pasted in Settings ▸ AI (`aiKey.ts` → localStorage) — so the browser build
// calls the API directly with the SDK's explicit browser opt-in, which sends
// the CORS opt-in header. The desktop webview takes the same path (its CSP
// allowlists api.anthropic.com). Requests carry a server-side refusal
// fallback ("default") and cache the big grounding-spec system block, which
// is byte-identical across requests by construction.

import Anthropic from "@anthropic-ai/sdk";
import { getAiKey } from "./aiKey";
import { DEMO_KEY, makeDemoFetch } from "./aiDemo";
import { groundingSpec } from "./aiGrounding";
import { validateText, formatIssues, hardIssues } from "./graphValidate";
import { writeTextForm, readTextForm } from "./textForm";

export const AI_MODEL = "claude-opus-5";
/** Repair rounds after the first attempt — each feeds the validator's issues back. */
const MAX_REPAIRS = 2;

export type AiOutcome =
  | { kind: "answer"; text: string }
  /** A validated rewrite: `newText` is the CANONICAL text form (round-tripped
   *  through the reader/writer, so the apply diff never shows formatting-only
   *  noise) and `warnings` carries the soft findings (e.g. a #CIRC! cycle). */
  | { kind: "edit"; newText: string; warnings: string[] }
  | { kind: "error"; message: string };

const FENCE_RE = /```solenoid\n([\s\S]*?)```/;

function systemPrompt(): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    {
      type: "text",
      text:
        `You are the AI assistant inside Solenoid, a node-graph alternative to Excel ` +
        `for data tables. The user's document is given as its text form; the spec below ` +
        `is the complete authoring vocabulary.\n\n` +
        `Respond in exactly one of two ways:\n` +
        `1. A question about the document or about Solenoid: answer in plain prose. ` +
        `Keep it short and concrete; no headings.\n` +
        `2. A request to create or change the document: reply with the FULL replacement ` +
        `text form (every node line plus the sidecar, not a fragment) inside a fenced ` +
        `block starting \`\`\`solenoid. One sentence before the fence saying what changed ` +
        `is welcome; nothing after it.\n\n` +
        `Rewrite rules:\n` +
        `- Keep every node the user did not ask to change, byte-identical where possible ` +
        `(names, init fields, literals, wiring).\n` +
        `- Preserve the sidecar of kept nodes exactly (positions, sizes, standoffs, pins, ` +
        `comments). New nodes may omit positions; place them near related nodes when you ` +
        `do position them.\n` +
        `- Use only node types, socket keys, init fields, and ops from the spec. Respect ` +
        `the socket lattice; insert a Cast where families differ.\n` +
        `- If the request cannot be done with the available nodes, say so in prose ` +
        `instead of guessing.`,
    },
    {
      type: "text",
      text: groundingSpec(),
      // The spec is ~30k tokens and byte-identical every call — the classic
      // cacheable prefix. The breakpoint sits after it; only the (small,
      // varying) user turn is billed at full rate on later requests.
      cache_control: { type: "ephemeral" },
    },
  ];
}

function userTurn(prompt: string, currentText: string): string {
  return (
    `Current document (text form):\n\`\`\`solenoid\n${currentText}\`\`\`\n\n` +
    `Request: ${prompt}`
  );
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Run one palette prompt against the model. `currentText` is the document's
 * text form (the writer's canonical output). `fetch` is injectable for tests.
 */
export async function runAiPrompt(
  prompt: string,
  currentText: string,
  opts?: { fetch?: typeof globalThis.fetch },
): Promise<AiOutcome> {
  const apiKey = getAiKey();
  if (!apiKey) return { kind: "error", message: "No AI key is stored. Add one in Settings." };

  // Typing `demo` instead of a key swaps the transport for the canned local
  // model (aiDemo.ts) — every layer above the wire (validator, repair rounds,
  // canonicalization, diff) still runs for real.
  const fetchImpl = opts?.fetch ?? (apiKey === DEMO_KEY ? makeDemoFetch() : undefined);
  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // the key is the user's own, stored on this device
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: userTurn(prompt, currentText) },
  ];

  try {
    for (let attempt = 0; ; attempt++) {
      const response = await client.beta.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        system: systemPrompt(),
        messages,
        // Safety classifiers can decline a request; "default" re-runs it on
        // Anthropic's recommended fallback model server-side.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        return { kind: "error", message: "The model declined this request." };
      }
      const text = textOf(response);
      if (response.stop_reason === "max_tokens") {
        return { kind: "error", message: "The reply was cut off at the length limit. Try a narrower request." };
      }

      const fence = FENCE_RE.exec(text);
      if (!fence) {
        const answer = text.trim();
        if (!answer) return { kind: "error", message: "The model sent an empty reply. Try again." };
        return { kind: "answer", text: answer };
      }

      const candidate = fence[1];
      const { issues, graph } = validateText(candidate);
      const hard = hardIssues(issues);
      if (hard.length === 0 && graph) {
        // Canonicalize through the real writer so the approval diff shows
        // semantic changes only, and applying is byte-stable.
        const canonical = writeTextForm(readTextForm(candidate));
        return {
          kind: "edit",
          newText: canonical,
          warnings: issues.filter((i) => i.severity === "warning").map((i) => i.message),
        };
      }

      if (attempt >= MAX_REPAIRS) {
        return {
          kind: "error",
          message:
            `The rewrite still fails validation after ${MAX_REPAIRS + 1} attempts:\n` +
            formatIssues(hard),
        };
      }

      // Repair round: the validator's messages are written to be fixed from.
      messages.push(
        { role: "assistant", content: response.content },
        {
          role: "user",
          content:
            `The strict validator rejected that document:\n${formatIssues(hard)}\n\n` +
            `Send the corrected FULL text form in a \`\`\`solenoid fence.`,
        },
      );
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { kind: "error", message: "The API key was rejected. Check it in Settings." };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { kind: "error", message: "Rate limited. Wait a moment and try again." };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { kind: "error", message: "Couldn't reach the AI service. Check your connection." };
    }
    if (e instanceof Anthropic.APIError) {
      return { kind: "error", message: `The AI service returned an error: ${e.message}` };
    }
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

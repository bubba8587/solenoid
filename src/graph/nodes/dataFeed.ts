import { ClassicPreset } from "rete";
import { frameOut } from "./shared";
import { connectionStore, scheduleConnectionRecalc } from "../connectionStore";
import { fetchText } from "../httpBridge";
import { frameRowCount, type FrameValue } from "../frame";
import { apiKeyStore } from "../apiKeyStore";
import { getProvider, type ProviderId, type ProviderPreset } from "../dataProviders";

// One node for every market/economic data provider. Like WebSourceNode, data() must
// stay SYNCHRONOUS — a Promise-returning source sits on the engine's critical path
// forever — so it serves the cached frame and fires one background fetch per key.

export class DataFeedNode extends ClassicPreset.Node {
  label: string;
  provider: ProviderId;
  // The series id / ticker, in stringLiterals so it round-trips + renders a field.
  stringLiterals: Record<string, string> = { input: "" };
  /** Auto-refresh interval in minutes (0 = off) — the component runs the timer. */
  refreshMinutes: number;
  cachedResult: FrameValue | null = null;
  width = 260; height = 190;

  // Transient (never persisted): last-fetched + in-flight cache keys.
  private lastKey: string | undefined;
  private inflightKey: string | undefined;

  constructor(init?: { label?: string; provider?: ProviderId; refreshMinutes?: number }) {
    super("DataFeed");
    this.label = init?.label ?? "Data Feed";
    this.provider = init?.provider ?? "fred";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
  }

  /** The active provider preset. */
  preset(): ProviderPreset {
    return getProvider(this.provider);
  }

  /** True when the provider needs an API key that isn't stored yet. */
  needsKey(): boolean {
    const p = this.preset();
    return p.needsKey && !apiKeyStore.has(p.keyProvider ?? p.id);
  }

  data(): { frame: FrameValue | null } {
    const p = this.preset();
    const input = (this.stringLiterals.input ?? "").trim();
    if (input === "") {
      this.cachedResult = null;
      connectionStore.setState(this.id, { status: "idle" });
      return { frame: null };
    }
    if (this.needsKey()) {
      this.cachedResult = null;
      connectionStore.setState(this.id, { status: "error", message: `Add a ${p.label} API key in Settings.` });
      return { frame: null };
    }
    const key = p.needsKey ? apiKeyStore.get(p.keyProvider ?? p.id) : "";
    // These ride in the URL, hence the cache key, so changing any of them re-fetches.
    const url = p.buildUrl(input, key, {
      start: this.stringLiterals.start?.trim() || undefined,
      end: this.stringLiterals.end?.trim() || undefined,
      freq: this.stringLiterals.freq?.trim() || undefined,
    });
    // The key folds in the provider so switching provider re-fetches.
    const cacheKey = connectionStore.key(this.id, `${this.provider}:${url}`);
    if (cacheKey === this.lastKey) return { frame: this.cachedResult };
    if (this.inflightKey !== cacheKey) {
      this.inflightKey = cacheKey;
      void this.fetchFrame(url, cacheKey).then(() => scheduleConnectionRecalc());
    }
    return { frame: this.cachedResult }; // stale/null until the fetch resolves
  }

  private async fetchFrame(url: string, cacheKey: string): Promise<void> {
    connectionStore.setState(this.id, { status: "loading" });
    try {
      const { text } = await fetchText(url);
      const frame = this.preset().parse(text);
      this.cachedResult = frame;
      this.lastKey = cacheKey;
      connectionStore.setState(this.id, {
        status: "ok",
        rows: frameRowCount(frame),
        cols: frame.columns.length,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      this.cachedResult = null;
      this.lastKey = cacheKey;
      connectionStore.setState(this.id, { status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

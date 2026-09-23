// [[D32]] refreshOutsideRebuild, [[C28]] literalsIffEditable, [[C103]] untrustedContentSeams, [[D50]] everyFieldClassified
import { ClassicPreset } from "rete";
import { frameOut } from "./shared";
import { connectionStore, scheduleConnectionRecalc, requestNetwork } from "../connectionStore";
import { fetchText } from "../httpBridge";
import { frameRowCount, type FrameValue } from "../frame";
import { apiKeyStore } from "../apiKeyStore";
import { getProvider, type ProviderId, type ProviderPreset } from "../dataProviders";


export class DataFeedNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    frame: "The project file stores the series id, not the data. Refresh to re-pull.",
  };
  label: string;
  provider: ProviderId;
  stringLiterals: Record<string, string> = { input: "" };
  refreshMinutes: number;
  cachedResult: FrameValue | null = null;
  width = 260; height = 190;

  private lastKey: string | undefined;
  private inflightKey: string | undefined;

  constructor(init?: { label?: string; provider?: ProviderId; refreshMinutes?: number }) {
    super("DataFeed");
    this.label = init?.label ?? "Data Feed";
    this.provider = init?.provider ?? "fred";
    this.refreshMinutes = init?.refreshMinutes ?? 0;
    this.addOutput("frame", frameOut("Frame"));
  }

  preset(): ProviderPreset {
    return getProvider(this.provider);
  }

  needsKey(): boolean {
    const p = this.preset();
    return p.needsKey && !apiKeyStore.has(p.keyProvider ?? p.id);
  }

  data(): { frame: FrameValue | null } {
    connectionStore.autoRefresh(this.id, this.refreshMinutes);
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
    const start = this.stringLiterals.start?.trim() || undefined;
    const end = this.stringLiterals.end?.trim() || undefined;
    // ISO dates compare correctly as text; a reversed range would otherwise return an opaque provider error.
    if (start && end && start > end) {
      this.cachedResult = null;
      connectionStore.setState(this.id, { status: "error", message: "End is before Start." });
      return { frame: null };
    }
    const url = p.buildUrl(input, key, { start, end, freq: this.stringLiterals.freq?.trim() || undefined });
    if (!requestNetwork(this.id)) return { frame: this.cachedResult };
    const cacheKey = connectionStore.key(this.id, `${this.provider}:${url}`);
    if (cacheKey === this.lastKey) return { frame: this.cachedResult };
    if (this.inflightKey !== cacheKey) {
      this.inflightKey = cacheKey;
      void this.fetchFrame(url, cacheKey).then(() => scheduleConnectionRecalc(this.id));
    }
    return { frame: this.cachedResult };
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

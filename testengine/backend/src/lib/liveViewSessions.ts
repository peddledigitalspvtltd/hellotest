import type { EngineWebEngineProvider } from "../contracts/hellotest.js";

export type LiveViewEntry = {
  id: string;
  provider: EngineWebEngineProvider;
  startedAt: string;
  url: () => Promise<string>;
  screenshot: () => Promise<Buffer | null>;
};

type ActiveEntry = LiveViewEntry & {
  image: Buffer | null;
  capturedAt: number;
  pending: Promise<Buffer | null> | null;
};

/** Multiple viewers share a bounded frame capture so inspection cannot queue
 * competing screenshot commands behind the browser's actual test actions. */
export class LiveViewSessionRegistry {
  private readonly entries = new Map<string, ActiveEntry>();

  constructor(private readonly options: { now?: () => number; frameIntervalMs?: number; captureTimeoutMs?: number } = {}) {}

  register(entry: LiveViewEntry) {
    this.entries.set(entry.id, { ...entry, image: null, capturedAt: Number.NEGATIVE_INFINITY, pending: null });
  }

  unregister(id: string | null) {
    if (id) this.entries.delete(id);
  }

  private selected(provider: EngineWebEngineProvider, engineRunId?: string) {
    if (engineRunId) return this.entries.get(`${engineRunId}:${provider}`) || null;
    return [...this.entries.values()].filter(entry => entry.provider === provider).at(-1) || null;
  }

  status(provider: EngineWebEngineProvider = "playwright", engineRunId?: string) {
    const entry = this.selected(provider, engineRunId);
    return { provider, available: Boolean(entry), session_id: entry?.id || null, started_at: entry?.startedAt || null };
  }

  async capture(provider: EngineWebEngineProvider = "playwright", engineRunId?: string): Promise<Buffer | null> {
    const entry = this.selected(provider, engineRunId);
    if (!entry) return null;
    const now = this.options.now || Date.now;
    if (!entry.pending && now() - entry.capturedAt < (this.options.frameIntervalMs ?? 500)) return entry.image;
    if (!entry.pending) {
      entry.pending = Promise.resolve().then(() => entry.screenshot()).catch(() => null).then(image => {
        if (this.entries.get(entry.id) !== entry) return null;
        entry.image = image;
        entry.capturedAt = now();
        return image;
      }).finally(() => { entry.pending = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([entry.pending, new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), this.options.captureTimeoutMs ?? 2000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
}

export const liveViewSessions = new LiveViewSessionRegistry();

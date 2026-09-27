type CachedResponse = { expiresAt: number; value: unknown };

// Protocol 1 capability releases already call Map.clear(). Preserve that API
// while ensuring those callers also invalidate pending reads and generations.
class ResponseReuseMap extends Map<string, CachedResponse> {
  constructor(private readonly onClear: () => void) { super(); }
  clear() { super.clear(); this.onClear(); }
}

/** Short-lived reuse only. React Query remains responsible for application data. */
export class ClientRequestCache {
  private readonly pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private readonly responses = new ResponseReuseMap(() => {
    this.generation += 1;
    this.pending.clear();
  });

  constructor(
    private readonly ttlMs = 1_500,
    private readonly maxEntries = 120,
    private readonly now: () => number = Date.now
  ) {}

  get revision() { return this.generation; }
  /** @deprecated Compatibility with already deployed protocol 1 UI releases. */
  get compatibilityResponses(): Map<string, CachedResponse> { return this.responses; }

  invalidate() {
    // A read started before a write must not be reused after that write.
    this.responses.clear();
  }

  read(key: string) {
    const cached = this.responses.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= this.now()) {
      this.responses.delete(key);
      return undefined;
    }
    return cached.value;
  }

  remember(key: string, value: unknown, revision: number) {
    if (revision !== this.generation) return;
    this.responses.delete(key);
    this.responses.set(key, { expiresAt: this.now() + this.ttlMs, value });
    while (this.responses.size > this.maxEntries) {
      const oldest = this.responses.keys().next();
      if (oldest.done) break;
      this.responses.delete(oldest.value);
    }
  }

  getPending(key: string) { return this.pending.get(key); }
  setPending(key: string, request: Promise<unknown>) { this.pending.set(key, request); }
  release(key: string, request: Promise<unknown>) {
    if (this.pending.get(key) === request) this.pending.delete(key);
  }
}

import "server-only";

/**
 * Small per-process LRU bounded by total size. Used for immutable blobs
 * (uploaded images are stored under fresh UUID names, never rewritten in
 * place), so a hit never needs revalidating against Firestore.
 */
export class LruCache<V> {
  private entries = new Map<string, { value: V; size: number }>();
  private total = 0;

  constructor(private maxSize: number, private sizeOf: (value: V) => number = () => 1) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V) {
    const size = this.sizeOf(value);
    this.delete(key);
    if (size > this.maxSize) return;
    this.entries.set(key, { value, size });
    this.total += size;
    for (const [oldest, entry] of this.entries) {
      if (this.total <= this.maxSize) break;
      this.entries.delete(oldest);
      this.total -= entry.size;
    }
  }

  delete(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.total -= entry.size;
  }
}

/** Runs `load` once per key at a time; concurrent callers share the promise. */
export function dedupe<V>() {
  const inflight = new Map<string, Promise<V>>();
  return (key: string, load: () => Promise<V>): Promise<V> => {
    const current = inflight.get(key);
    if (current) return current;
    const promise = load().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}

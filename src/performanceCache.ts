export function stableSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input as object)) throw new TypeError("Cannot serialize circular value");
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(normalize);
    const obj = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    Object.keys(obj).sort().forEach((key) => { out[key] = normalize(obj[key]); });
    return out;
  };
  return JSON.stringify(normalize(value));
}

export class LruCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): T | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.values.has(key)) this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}

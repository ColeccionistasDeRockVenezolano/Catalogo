/** Caché acotada: comparte cargas simultáneas y nunca conserva fallos. */
export class ReadCache<T> {
  private entries = new Map<string, { value: Promise<T>; expires: number }>();
  constructor(private readonly maxEntries = 256, private readonly now = () => Date.now()) {}

  has(key: string): boolean {
    return this.getIfFresh(key) !== undefined;
  }

  getIfFresh(key: string): Promise<T> | undefined {
    const entry = this.entries.get(key);
    return entry && entry.expires > this.now() ? entry.value : undefined;
  }

  get(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const entry = { value: Promise.resolve().then(load), expires: Infinity };
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    void entry.value.then(() => {
      if (this.entries.get(key) === entry) entry.expires = this.now() + ttl;
    }, () => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    return entry.value;
  }

  clear(): void { this.entries.clear(); }
  delete(key: string): void { this.entries.delete(key); }
}

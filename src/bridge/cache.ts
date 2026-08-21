const MAX_ENTRIES = 50

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class SearchCache<T> {
  private map = new Map<string, CacheEntry<T>>()

  buildKey(query: string, maxResults: number, timeRangeLabel: string, preferred: string): string {
    return [query, maxResults, timeRangeLabel, preferred].join('\0')
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
    if (this.map.size > MAX_ENTRIES) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
  }
}

import type { SearchOptions, SearchResult } from './common.js'
import { USER_AGENT, approximateTimeRange, uniqueSources } from './common.js'

// Fallback public instances — may go offline or rate-limit at any time.
// Configure your own via Settings > Plugins > Free Web Search > searxngInstances.
export const SEARXNG_DEFAULT_INSTANCES = [
  'https://opnxng.com',
  'https://priv.au',
  'https://searx.be',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
  'https://paulgo.io',
]

const SEARXNG_TIME: Record<string, string> = { day: 'day', week: 'week', month: 'month', year: 'year' }

export async function searchSearxng(
  query: string,
  maxResults: number,
  options?: SearchOptions,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const instances = options?.searxngInstances?.length ? options.searxngInstances : SEARXNG_DEFAULT_INSTANCES
  const errors: string[] = []

  for (const base of instances) {
    try {
      const params = new URLSearchParams({ q: query, format: 'json' })
      if (options?.timeRange && 'days' in options.timeRange) {
        const tr = SEARXNG_TIME[approximateTimeRange(options.timeRange.days)]
        if (tr) params.set('time_range', tr)
      }

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const onAbort = () => ctrl.abort()
      signal?.addEventListener('abort', onAbort)

      try {
        const response = await fetch(`${base}/search?${params}`, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
          signal: ctrl.signal,
        })

        if (!response.ok) {
          errors.push(`${base}: HTTP ${response.status}`)
          continue
        }

        const data = (await response.json().catch(() => null)) as {
          results?: Array<{ url?: string; title?: string; content?: string }>
        } | null
        if (!data || !Array.isArray(data.results)) {
          errors.push(`${base}: invalid JSON`)
          continue
        }

        const sources = data.results
          .filter((r) => r.url)
          .map((r) => ({
            url: r.url!,
            ...(r.title ? { title: String(r.title) } : {}),
            ...(r.content ? { snippet: String(r.content) } : {}),
          }))

        if (sources.length > 0) {
          return { sources: uniqueSources(sources, maxResults), truncated: false }
        }
        errors.push(`${base}: 0 results`)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const detail = errors.length > 0 ? errors.join(', ') : 'no instances configured'
  throw new Error(`all SearXNG instances failed: ${detail.slice(0, 300)}`)
}

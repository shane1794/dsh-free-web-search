export interface Source {
  url: string
  title?: string
  snippet?: string
  publishedAt?: string
}

export interface SearchResult {
  sources: Source[]
  truncated: boolean
  content?: string
  provider?: string
}

export type TimeRange = { days: number } | { after: string }

export interface SearchOptions {
  region?: string
  bingMarket?: string
  searxngInstances?: string[]
  timeRange?: TimeRange
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
export const ACCEPT_LANG = 'en-US,en;q=0.9'

export const TIME_RANGES = ['day', 'week', 'month', 'year'] as const
export type TimeRangePreset = (typeof TIME_RANGES)[number]

const DAYS_BY_RANGE: Record<TimeRangePreset, number> = { day: 1, week: 7, month: 30, year: 365 }

export function parseTimeRange(input: unknown): TimeRange | undefined {
  if (input === undefined || input === null) return undefined

  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.after)) return { after: obj.after }
    if (typeof obj.days === 'number' && Number.isFinite(obj.days) && obj.days > 0) return { days: obj.days }
    return undefined
  }

  const s = String(input).trim().toLowerCase()
  if (s.length === 0) return undefined
  if ((TIME_RANGES as readonly string[]).includes(s)) return { days: DAYS_BY_RANGE[s as TimeRangePreset] }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { after: s }

  const m = s.match(/^(\d+(?:\.\d+)?)\s*(h|hour|hours|d|day|days|w|week|weeks|mo|month|months|y|year|years)$/)
  if (m) {
    const n = parseFloat(m[1]!)
    const unit = m[2]![0]!
    const days =
      unit === 'h' ? n / 24 : unit === 'd' ? n : unit === 'w' ? n * 7 : unit === 'm' ? n * 30 : n * 365
    return { days }
  }

  return undefined
}

export function approximateTimeRange(days: number): TimeRangePreset {
  if (days <= 2) return 'day'
  if (days <= 14) return 'week'
  if (days <= 90) return 'month'
  return 'year'
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

const SNIPPET_NOISE =
  /\b(sign up|sign in|log in|login|subscribe( to| for)?|member[- ]?only|become a member|create (a )?free account|read more|continue reading|story continues|get started|install (the )?app|view on|medium membership|join \w+ for free|get updates from this writer|stories in your inbox|remember me for|unlock this|free to read|become a patron)\b/gi

export function cleanSnippet(text: string | undefined): string | undefined {
  if (!text) return text
  return text
    .replace(SNIPPET_NOISE, ' ')
    .replace(/^\s*(#{1,6}\s*|\[\s*x?\s*\]\s*|-\s*\[\s*x?\s*\]\s*|>\s*)/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Decode a base64url payload as UTF-8. `atob` keeps this free of `Buffer`. */
function fromBase64Url(value: string): string | null {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
  } catch {
    return null
  }
}

/**
 * Bing serves no result URLs. Every href on a SERP is its own click tracker —
 * `https://www.bing.com/ck/a?…&u=a1<base64url of the target>&ntb=1` — and it
 * arrives with HTML entities intact. Handed to a model unchanged, the citation
 * is a `bing.com/ck/a?!&amp;&amp;…` link that answers `204` and leads nowhere.
 *
 * So: decode the entities, then unwrap `u=a1…`. Anything unexpected degrades to
 * the entity-decoded href rather than dropping the result — a tracker link that
 * at least resolves beats no source at all.
 */
export function extractBingUrl(href: string | undefined): string | null {
  if (!href) return null
  const decoded = decodeEntities(href)

  let parsed: URL
  try {
    parsed = new URL(decoded)
  } catch {
    return decoded
  }
  if (!/(^|\.)bing\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/ck/a')) return decoded

  const wrapped = parsed.searchParams.get('u')
  if (wrapped === null || !wrapped.startsWith('a1')) return decoded

  const target = fromBase64Url(wrapped.slice(2))
  return target !== null && /^https?:\/\//i.test(target) ? target : decoded
}

export function extractDdgUrl(rel: string | undefined): string | null {
  if (!rel) return null
  const m = decodeEntities(rel).match(/uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1]!)
    } catch {
      return m[1]!
    }
  }
  if (rel.startsWith('//')) return `https:${rel}`
  return rel
}

export function uniqueSources(sources: Source[], limit: number): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const s of sources) {
    if (s.url && !seen.has(s.url)) {
      seen.add(s.url)
      out.push(s)
    }
    if (out.length >= limit) break
  }
  return out
}

export async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, 'accept-language': ACCEPT_LANG },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`connection error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url.split('?')[0]}`)
  }

  return response.text()
}

const DDG_ANTIBOT_RE = /anomaly|captcha|unusual traffic|robot check/i

export function checkDdgAntiBot(html: string): void {
  if (DDG_ANTIBOT_RE.test(html.slice(0, 4000))) {
    throw new Error('DuckDuckGo is rate-limited (anti-bot challenge, usually temporary)')
  }
}

export async function fetchHtmlWithRetry(url: string, signal?: AbortSignal): Promise<string> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const html = await fetchHtml(url, signal)
      if (html.length > 500) return html
      lastError = new Error(`empty response (${html.length} bytes)`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw lastError ?? new Error('fetch failed')
}

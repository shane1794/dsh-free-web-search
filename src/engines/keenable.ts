import type { SearchResult, TimeRange } from './common.js'
import { uniqueSources } from './common.js'

const KEENABLE_URL = 'https://api.keenable.ai/v1/search'
const KEENABLE_MCP_URL = 'https://api.keenable.ai/mcp'

function formatKeenableRelative(days: number): string {
  if (days <= 0.5) return '12h'
  if (days < 1) return `${Math.round(days * 24)}h`
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

function extractKeenableSources(
  text: string,
  maxResults: number,
): import('./common.js').Source[] {
  const sources: import('./common.js').Source[] = []
  for (const block of String(text).split(/\n(?=Title:)/)) {
    const title = block.match(/^Title: (.+)$/m)?.[1]
    const url = block.match(/^URL: (\S+)$/m)?.[1]
    const published = block.match(/^Published: (.+)$/m)?.[1] ?? block.match(/^Acquired: (.+)$/m)?.[1]
    const snippets = block
      .split(/^Snippets:$/m)[1]
      ?.split('\n')
      .filter((l) => l.trim())
      .slice(0, 3)
      .join(' ')

    if (!url) continue
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippets ? { snippet: snippets.slice(0, 300) } : {}),
      ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}),
    })
  }
  return uniqueSources(sources, maxResults)
}

export async function searchKeenableREST(
  query: string,
  maxResults: number,
  apiKey: string,
  timeRange?: TimeRange,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    const body: Record<string, unknown> = { query, mode: 'realtime' }
    if (timeRange) {
      if ('after' in timeRange) body.published_after = timeRange.after
      else body.published_after = formatKeenableRelative(timeRange.days)
    }

    response = await fetch(KEENABLE_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`Keenable request failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error('Keenable API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Web Search')
    }
    throw new Error(`Keenable API error (HTTP ${response.status}): ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    results?: Array<{
      url?: string
      title?: string
      snippet?: string
      description?: string
      published_at?: string
    }>
  }

  const sources = (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      url: r.url!,
      ...(r.title ? { title: String(r.title) } : {}),
      ...(r.snippet ?? r.description ? { snippet: String(r.snippet ?? r.description).slice(0, 300) } : {}),
      ...(r.published_at ? { publishedAt: String(r.published_at) } : {}),
    }))

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}

export async function searchKeenableMCP(
  query: string,
  maxResults: number,
  timeRange?: TimeRange,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    const arguments_: Record<string, unknown> = { query }
    if (timeRange) {
      if ('after' in timeRange) arguments_.published_after = timeRange.after
      else arguments_.published_after = formatKeenableRelative(timeRange.days)
    }

    response = await fetch(KEENABLE_MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: 'search_web_pages', arguments: arguments_ },
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`Keenable MCP request failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) throw new Error(`Keenable MCP error (HTTP ${response.status})`)

  const data = (await response.json()) as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: Array<{ type: string; text: string }> }
  }
  if (data.error) throw new Error(`Keenable MCP error: ${data.error.message ?? 'unknown'}`)

  const content = data.result?.content ?? []
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  if (data.result?.isError) throw new Error(`Keenable MCP error: ${text.slice(0, 200)}`)

  return { sources: extractKeenableSources(text, maxResults), truncated: false }
}

export async function searchKeenable(
  query: string,
  maxResults: number,
  apiKey: string | undefined,
  timeRange?: TimeRange,
  signal?: AbortSignal,
): Promise<SearchResult> {
  if (apiKey) return searchKeenableREST(query, maxResults, apiKey, timeRange, signal)
  return searchKeenableMCP(query, maxResults, timeRange, signal)
}

import type { SearchResult, TimeRange } from './common.js'
import { isoDaysAgo, uniqueSources } from './common.js'

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp'

export async function searchExa(
  query: string,
  maxResults: number,
  apiKey: string,
  timeRange?: TimeRange,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const body: Record<string, unknown> = {
    query,
    type: 'auto',
    contents: { highlights: { highlightsPerUrl: 1 } },
    numResults: maxResults,
  }

  if (timeRange) {
    if ('after' in timeRange) body.startPublishedDate = timeRange.after
    else body.startPublishedDate = isoDaysAgo(timeRange.days)
  }

  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'deepseek-harness/free-web-search',
    },
    body: JSON.stringify(body),
    ...(signal !== undefined ? { signal } : {}),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) {
      throw new Error('Exa API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Web Search')
    }
    throw new Error(`Exa API error (HTTP ${response.status}): ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as {
    results?: Array<{
      url: string
      title?: string
      highlights?: string[]
      publishedDate?: string
    }>
  }

  const sources = (data.results ?? [])
    .filter((result) => result.url)
    .map((result) => {
      const snippet = result.highlights?.find((h) => h.trim().length > 0)
      return {
        url: result.url,
        ...(result.title ? { title: result.title } : {}),
        ...(snippet ? { snippet } : {}),
        ...(result.publishedDate ? { publishedAt: result.publishedDate } : {}),
      }
    })

  return { sources: uniqueSources(sources, maxResults), truncated: false }
}

export async function searchExaMCP(
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  let response: Response
  try {
    response = await fetch(EXA_MCP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: { name: 'web_search_exa', arguments: { query, numResults: maxResults } },
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error(`Exa MCP request failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) throw new Error(`Exa MCP error (HTTP ${response.status})`)

  const text = await response.text()
  let json: { error?: { message?: string }; result?: { content?: Array<{ type: string; text: string }> } } | null =
    null
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        json = JSON.parse(line.slice(6))
        break
      } catch {}
    }
  }

  if (!json || json.error) {
    throw new Error(`Exa MCP error: ${json?.error?.message ?? 'no data'}`)
  }

  const content = json.result?.content ?? []
  const textBlocks = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')

  const sources = []
  for (const block of textBlocks.split(/\n(?=Title:)/)) {
    const title = block.match(/^Title: (.+)$/m)?.[1]
    const url = block.match(/^URL: (\S+)$/m)?.[1]
    const published = block.match(/^Published: (.+)$/m)?.[1]
    const highlights = block
      .split(/^Highlights:$/m)[1]
      ?.split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('...'))
      .slice(0, 3)
      .join(' ')

    if (!url) continue
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(highlights ? { snippet: highlights.slice(0, 300) } : {}),
      ...(published && /^\d{4}-\d{2}-\d{2}/.test(published) ? { publishedAt: published } : {}),
    })
  }

  return { sources, truncated: false }
}
